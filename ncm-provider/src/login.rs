//! 扫码登录长流程:取 unikey → 生成二维码 → 本地渲染 SVG → 轮询扫码状态。
//! QR 与状态经 login 事件上报;成功时 emit("done", cred)。

use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::logging::log_json;
use crate::state::{with_timeout, Out, State};

pub fn emit(tx: &Out, status: &str, extra: Value) {
    let mut obj = json!({ "ev": "login", "status": status });
    if let Value::Object(m) = extra {
        for (k, v) in m {
            obj[k] = v;
        }
    }
    let _ = tx.send(obj.to_string());
}

pub async fn login_flow(state: Arc<State>, tx: Out) {
    // 1. 取 unikey
    let key = match with_timeout(state.client.login_qr_key(&Query::new())).await {
        Ok(Ok(r)) => r.body["unikey"].as_str().unwrap_or("").to_string(),
        Ok(Err(e)) => return login_fail(&tx, &e.to_string()),
        Err(_) => return login_fail(&tx, "qr_key timeout"),
    };
    if key.is_empty() {
        return login_fail(&tx, "empty unikey");
    }
    // 2. 生成二维码 URL(库只给 qrurl,不出图)
    let qrurl = match with_timeout(
        state
            .client
            .login_qr_create(&Query::new().param("key", &key)),
    )
    .await
    {
        Ok(Ok(r)) => r.body["data"]["qrurl"].as_str().unwrap_or("").to_string(),
        Ok(Err(e)) => return login_fail(&tx, &e.to_string()),
        Err(_) => return login_fail(&tx, "qr_create timeout"),
    };
    // 3. 本地渲染二维码 → base64 SVG → 发给 UI
    match make_qr(&qrurl) {
        Ok(b64) => emit(
            &tx,
            "qrcode",
            json!({ "qr": b64, "mimetype": "image/svg+xml" }),
        ),
        Err(e) => return login_fail(&tx, &format!("qr render: {e}")),
    }
    // 4. 轮询扫码状态:800 过期 / 801 待扫 / 802 已扫 / 803 成功
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let r = match with_timeout(
            state
                .client
                .login_qr_check(&Query::new().param("key", &key)),
        )
        .await
        {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => return login_fail(&tx, &e.to_string()),
            Err(_) => return login_fail(&tx, "qr_check timeout"),
        };
        match r.body["code"].as_i64().unwrap_or(0) {
            803 => {
                // Set-Cookie 列表 → "name=value; name=value"(create_client / Query.cookie 用)
                let cookie = r
                    .cookie
                    .iter()
                    .filter_map(|c| c.split(';').next())
                    .collect::<Vec<_>>()
                    .join("; ");
                *state.cookie.lock().await = Some(cookie.clone());
                emit(&tx, "done", json!({ "cred": { "cookie": cookie } }));
                return;
            }
            800 => return emit(&tx, "timeout", json!({})),
            802 => emit(&tx, "scanned", json!({})),
            _ => emit(&tx, "waiting", json!({})),
        }
    }
}

fn login_fail(tx: &Out, err: &str) {
    let _ = tx.send(log_json("error", "login", err));
    emit(tx, "timeout", json!({})); // 对 UI 统一报可重试
}

fn make_qr(url: &str) -> Result<String, Box<dyn std::error::Error>> {
    let code = qrcode::QrCode::new(url.as_bytes())?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(200, 200)
        .build();
    Ok(base64::engine::general_purpose::STANDARD.encode(svg))
}
