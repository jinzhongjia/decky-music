//! bridge ↔ ncm-provider 协议 v1。集中请求解析 / 响应·事件构造 / 错误码。
//! wire 格式见 issue #31。日志事件(ev=log)保留独立顶层格式,见 logging.rs。

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug)]
pub struct ProtocolError(pub String);

/// 稳定错误码(ncm-provider 用到的子集)。字符串值即 wire 上的 error.code,前端据此 i18n。
#[derive(Debug, Clone, Copy)]
pub enum ErrorCode {
    UnknownCmd,
    InvalidRequest,
    Timeout,
    NoPlayable,
    ProviderError,
    NotLoggedIn,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::UnknownCmd => "unknown_cmd",
            ErrorCode::InvalidRequest => "invalid_request",
            ErrorCode::Timeout => "timeout",
            ErrorCode::NoPlayable => "no_playable",
            ErrorCode::ProviderError => "provider_error",
            ErrorCode::NotLoggedIn => "not_logged_in",
        }
    }
}

/// bridge → child 请求。args 先收成 Value,再由各命令 parse_args 解成对应 struct。
#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: u64,
    pub cmd: String,
    #[serde(default)]
    pub args: Value,
}

// ---- 各命令的 args struct ----

#[derive(Debug, Deserialize)]
pub struct SetCredentialArgs {
    #[serde(default)]
    pub cred: Value, // {cookie:...} 或 null
}

// ncm 只用 id;bridge 附带的 media_mid 作为未知字段被 serde 忽略(QQ 才需要)。
#[derive(Debug, Deserialize)]
pub struct SongUrlArgs {
    #[serde(default)]
    pub id: String,
}

// 通用 {id} 参数(lyric / playlist_songs 等按 id 取数的命令共用)
#[derive(Debug, Deserialize)]
pub struct IdArgs {
    #[serde(default)]
    pub id: String,
}

pub fn parse_request(line: &str) -> Result<Request, ProtocolError> {
    let req: Request = serde_json::from_str(line).map_err(|e| ProtocolError(e.to_string()))?;
    if req.cmd.is_empty() {
        return Err(ProtocolError("empty cmd".into()));
    }
    Ok(req)
}

pub fn parse_args<T: DeserializeOwned>(req: &Request) -> Result<T, ProtocolError> {
    serde_json::from_value(req.args.clone()).map_err(|e| ProtocolError(e.to_string()))
}

// ---- 响应 / 事件构造(统一 JSON 编码) ----

#[derive(Serialize)]
struct OkResp<T: Serialize> {
    id: u64,
    ok: bool,
    data: T,
}

#[derive(Serialize)]
struct ErrResp<'a> {
    id: u64,
    ok: bool,
    error: ErrorBody<'a>,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    code: &'a str,
    message: &'a str,
}

#[derive(Serialize)]
struct Event<'a, T: Serialize> {
    ev: &'a str,
    #[serde(rename = "type")]
    typ: &'a str,
    data: T,
}

pub fn ok<T: Serialize>(id: u64, data: T) -> String {
    serde_json::to_string(&OkResp { id, ok: true, data }).unwrap_or_else(|_| err_static(id))
}

pub fn ok_empty(id: u64) -> String {
    ok(id, json!({}))
}

pub fn err(id: u64, code: ErrorCode, message: &str) -> String {
    serde_json::to_string(&ErrResp {
        id,
        ok: false,
        error: ErrorBody {
            code: code.as_str(),
            message,
        },
    })
    .unwrap_or_else(|_| err_static(id))
}

/// 事件(child 主动上报,无 id)。ev = 域(login/provider),typ = 域内类型。
pub fn event<T: Serialize>(ev: &str, typ: &str, data: T) -> String {
    serde_json::to_string(&Event { ev, typ, data }).unwrap_or_default()
}

fn err_static(id: u64) -> String {
    format!(
        r#"{{"id":{id},"ok":false,"error":{{"code":"internal_error","message":"encode failed"}}}}"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_request_and_args() {
        let r = parse_request(r#"{"id":5,"cmd":"song_url","args":{"id":"abc"}}"#).unwrap();
        assert_eq!(r.id, 5);
        let a: SongUrlArgs = parse_args(&r).unwrap();
        assert_eq!(a.id, "abc");
    }

    #[test]
    fn parse_request_rejects_missing_cmd() {
        assert!(parse_request(r#"{"id":1,"args":{}}"#).is_err());
    }

    #[test]
    fn song_url_args_ignores_extra_media_mid() {
        let r = parse_request(r#"{"id":6,"cmd":"song_url","args":{"id":"123","media_mid":"x"}}"#)
            .unwrap();
        let a: SongUrlArgs = parse_args(&r).unwrap();
        assert_eq!(a.id, "123");
    }

    #[test]
    fn ok_and_err_shape() {
        let v: Value = serde_json::from_str(&ok(1, json!({"songs":[]}))).unwrap();
        assert_eq!(v, json!({"id":1,"ok":true,"data":{"songs":[]}}));
        let e: Value = serde_json::from_str(&err(6, ErrorCode::NoPlayable, "no_playable")).unwrap();
        assert_eq!(
            e,
            json!({"id":6,"ok":false,"error":{"code":"no_playable","message":"no_playable"}})
        );
    }

    #[test]
    fn event_shape() {
        let v: Value = serde_json::from_str(&event("login", "waiting", json!({}))).unwrap();
        assert_eq!(v, json!({"ev":"login","type":"waiting","data":{}}));
    }
}
