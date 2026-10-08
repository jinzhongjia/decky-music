//! 设备档案、扫码登录、凭证刷新与账号信息。凭证 / cookie 一律不进日志。

use std::path::PathBuf;
use std::time::Duration;

use base64::Engine;
use qqmusic_api::error::{ApiErrorKind, LoginErrorKind};
use qqmusic_api::models::login::{QrCodeLoginEvent, QrLoginType};
use qqmusic_api::{Client, Credential, Error};
use serde_json::{json, Value};
use wire::{log_json, LogLevel};

use super::{AuthGen, CmdResult, Fail};
use crate::Out;

/// 启动时把设备身份落盘并收紧权限(伪造的 IMEI / android_id,按 settings.json 同口径 0600)。
/// 库以「文件不存在」为生成信号,只能生成后再 chmod;失败不挡住启动。
pub async fn ensure_device(client: Client, path: PathBuf) {
    if client.device().await.is_err() {
        return;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
}

fn emit(out: &Out, typ: &str, data: Value) {
    let _ = out.send(wire::provider_event("qq", "login", typ, data));
}

/// 具体登录失败映射到稳定错误码(前端 i18n);其余通用 login_failed。
fn login_error_code(e: &Error) -> &'static str {
    let Error::Api(api) = e else {
        return "login_failed";
    };
    match api.kind {
        ApiErrorKind::Login(LoginErrorKind::DeviceLimit) => "login_device_limit",
        ApiErrorKind::Login(LoginErrorKind::AccountRestricted) => "login_account_restricted",
        ApiErrorKind::Login(LoginErrorKind::RateLimit) => "login_rate_limit",
        _ => "login_failed",
    }
}

/// 扫码登录:login_type "qq"(手机 QQ)/ "wx"(微信)。成功时 emit done {cred}。
/// QQ 即使免费歌也要登录态才能取 vkey,登录是基本播放的前置。
pub async fn login_flow(client: Client, out: Out, auth: AuthGen, generation: u64, kind: String) {
    if let Err(e) = poll_login(&client, &out, &auth, generation, &kind).await {
        if auth.is(generation) {
            let code = login_error_code(&e);
            let _ = out.send(log_json(LogLevel::Error, "login", code));
            emit(&out, "error", json!({ "code": code, "message": code }));
        }
    }
}

async fn poll_login(
    c: &Client,
    out: &Out,
    auth: &AuthGen,
    gen: u64,
    kind: &str,
) -> Result<(), Error> {
    let qr_type = if kind == "wx" {
        QrLoginType::Wx
    } else {
        QrLoginType::Qq
    };
    let qr = c.login().get_qrcode(qr_type).await?;
    if !auth.is(gen) {
        return Ok(());
    }
    let data = base64::engine::general_purpose::STANDARD.encode(&qr.data);
    emit(out, "qr", json!({ "qr": data, "mimetype": qr.mimetype }));
    loop {
        let result = c.login().check_qrcode(&qr).await?;
        if !auth.is(gen) {
            return Ok(());
        }
        let (typ, wait) = match result.event {
            QrCodeLoginEvent::Done => {
                finish(c, out, result.credential);
                return Ok(());
            }
            QrCodeLoginEvent::Timeout => ("timeout", None),
            QrCodeLoginEvent::Refuse => ("refuse", None),
            QrCodeLoginEvent::Conf => ("scanned", Some(800)),
            QrCodeLoginEvent::Scan => ("waiting", Some(1500)),
        };
        emit(out, typ, json!({}));
        let Some(wait) = wait.map(Duration::from_millis) else {
            return Ok(());
        };
        tokio::time::sleep(wait).await;
        if !auth.is(gen) {
            return Ok(());
        }
    }
}

fn finish(c: &Client, out: &Out, credential: Option<Credential>) {
    let Some(cred) = credential else {
        emit(
            out,
            "error",
            json!({ "code": "login_failed", "message": "login_failed" }),
        );
        return;
    };
    c.set_credential(cred.clone());
    let cred = serde_json::to_value(&cred).unwrap_or(Value::Null);
    emit(out, "done", json!({ "cred": cred }));
}

/// 凭证过期则用 refresh_key 换新;成功返回新凭证(与 login done 同形状,bridge 存后可原样回注)。
/// 刷新失败不抛,保留原凭证 —— 最坏回到原来的「需重新登录」。
pub async fn refresh_if_expired(c: &Client, out: &Out, auth: &AuthGen, gen: u64) -> Value {
    let cred = c.credential();
    if cred.musickey.is_empty() || !cred.is_expired() || !auth.is(gen) {
        return Value::Null;
    }
    let refreshed = c.login().refresh_credential(Some(cred)).await;
    if !auth.is(gen) {
        return Value::Null;
    }
    match refreshed {
        Ok(new) => {
            c.set_credential(new.clone());
            let _ = out.send(log_json(
                LogLevel::Info,
                "credential",
                "refreshed expired credential",
            ));
            serde_json::to_value(&new).unwrap_or(Value::Null)
        }
        Err(_) => {
            let _ = out.send(log_json(LogLevel::Warn, "credential", "refresh failed"));
            Value::Null
        }
    }
}

/// 服务端登出尽力而为:本地态已先清,失败不影响。
pub async fn server_logout(c: Client, old: Credential) {
    if old.is_valid() {
        let _ = tokio::time::timeout(Duration::from_secs(10), c.login().logout(Some(old))).await;
    }
}

/// 当前登录账号:昵称 + 头像 + VIP 档位 code(前端 vipText() 本地化,不用服务端图标)。
pub async fn account(c: &Client) -> CmdResult {
    let cred = c.credential();
    if cred.encrypt_uin.is_empty() {
        return Err(Fail::NotLoggedIn);
    }
    let home = c
        .user()
        .get_homepage(&cred.encrypt_uin, None)
        .send()
        .await?;
    let vip = c.user().get_vip_info(None).send().await?;
    let id = &vip.identity;
    let annual = id.huge_year_flag != 0 || id.year_flag != 0;
    let tier = if vip.svip != 0 {
        if annual {
            "svip_annual"
        } else {
            "svip"
        }
    } else if id.huge_vip != 0 {
        if id.huge_year_flag != 0 {
            "luxury_annual"
        } else {
            "luxury"
        }
    } else if id.vip != 0 {
        if id.year_flag != 0 {
            "green_annual"
        } else {
            "green"
        }
    } else {
        ""
    };
    let base = &home.base_info;
    Ok(json!({ "nickname": base.name, "avatar": base.avatar, "vip": tier }))
}
