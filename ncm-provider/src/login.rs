//! QR login is event-driven; its acknowledged command does not wait for scanning.
use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::protocol::{self, log_json, LogLevel};
use crate::provider_commands::maybe_cookie;
use crate::state::{with_timeout, Out, Session, State};

fn emit(tx: &Out, typ: &str, data: Value) {
    let _ = tx.send(protocol::event("login", typ, data));
}

pub async fn login_flow(state: Arc<State>, tx: Out, session: Arc<Session>) {
    let result = create_qr(&state).await;
    if !state.is_current(&session) {
        return;
    }
    let (key, qr) = match result {
        Ok(value) => value,
        Err(error) => return login_fail(&tx, error),
    };
    emit(&tx, "qr", json!({ "qr": qr, "mimetype": "image/svg+xml" }));
    poll_login(&state, &tx, &session, &key).await;
}

async fn create_qr(state: &State) -> Result<(String, String), &'static str> {
    let key_q = maybe_cookie(Query::new(), state.device_pins());
    let response = with_timeout(state.client.login_qr_key(&key_q))
        .await
        .map_err(|_| "qr_key timeout")?
        .map_err(|_| "qr key failed")?;
    let key = response.body["unikey"]
        .as_str()
        .filter(|key| !key.is_empty())
        .ok_or("empty unikey")?
        .to_owned();
    let create_q = maybe_cookie(Query::new().param("key", &key), state.device_pins());
    let response = with_timeout(state.client.login_qr_create(&create_q))
        .await
        .map_err(|_| "qr_create timeout")?
        .map_err(|_| "qr create failed")?;
    let url = response.body["data"]["qrurl"]
        .as_str()
        .filter(|url| !url.is_empty())
        .ok_or("qr create failed")?;
    let qr = make_qr(url).map_err(|_| "qr render failed")?;
    Ok((key, qr))
}

async fn poll_login(state: &State, tx: &Out, session: &Arc<Session>, key: &str) {
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        if !state.is_current(session) {
            return;
        }
        let q = maybe_cookie(Query::new().param("key", key), state.device_pins());
        let response = with_timeout(state.client.login_qr_check(&q)).await;
        if !state.is_current(session) {
            return;
        }
        let response = match response {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => return login_fail(tx, "qr check failed"),
            Err(_) => return login_fail(tx, "qr_check timeout"),
        };
        match response.body["code"].as_i64().unwrap_or(0) {
            803 => {
                let cookie = response
                    .cookie
                    .iter()
                    .filter_map(|c| c.split(';').next())
                    .collect::<Vec<_>>()
                    .join("; ");
                state.replace_credential_with(Some(cookie.clone()), Some(session), || {
                    emit(tx, "done", json!({ "cred": { "cookie": cookie } }));
                });
                return;
            }
            800 => return emit(tx, "timeout", json!({})),
            802 => emit(tx, "scanned", json!({})),
            _ => emit(tx, "waiting", json!({})),
        }
    }
}

fn login_fail(tx: &Out, error: &'static str) {
    let _ = tx.send(log_json(LogLevel::Error, "login", error));
    emit(
        tx,
        "error",
        json!({ "code": "login_failed", "message": "login_failed" }),
    );
}

fn make_qr(url: &str) -> Result<String, qrcode::types::QrError> {
    let code = qrcode::QrCode::new(url.as_bytes())?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(200, 200)
        .build();
    Ok(base64::engine::general_purpose::STANDARD.encode(svg))
}
