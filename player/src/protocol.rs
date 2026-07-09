//! bridge ↔ player 协议 v1。集中请求解析 / 响应·事件构造 / 错误码,业务代码不碰裸 JSON。
//! wire 格式见 issue #31:request{id,cmd,args} / response{id,ok,data|error} / event{ev,type,data}。
//! 日志事件(ev=log)保留独立顶层格式,见 logging.rs。

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug)]
pub struct ProtocolError(pub String);

/// 稳定错误码(player 用到的子集)。字符串值即 wire 上的 error.code,前端据此 i18n。
#[derive(Debug, Clone, Copy)]
pub enum ErrorCode {
    UnknownCmd,
    InvalidRequest,
    MissingField,
    FetchFailed,
    DecodeFailed,
    SeekFailed,
    AudioDeviceFailed,
    AudioThreadGone,
    Superseded,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::UnknownCmd => "unknown_cmd",
            ErrorCode::InvalidRequest => "invalid_request",
            ErrorCode::MissingField => "missing_field",
            ErrorCode::FetchFailed => "fetch_failed",
            ErrorCode::DecodeFailed => "decode_failed",
            ErrorCode::SeekFailed => "seek_failed",
            ErrorCode::AudioDeviceFailed => "audio_device_failed",
            ErrorCode::AudioThreadGone => "audio_thread_gone",
            ErrorCode::Superseded => "superseded",
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
pub struct LoadArgs {
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct SeekArgs {
    #[serde(default)]
    pub sec: f64,
}

#[derive(Debug, Deserialize)]
pub struct VolumeArgs {
    #[serde(default = "default_volume")]
    pub val: f64,
}

fn default_volume() -> f64 {
    1.0
}

pub fn parse_request(line: &str) -> Result<Request, ProtocolError> {
    let req: Request = serde_json::from_str(line).map_err(|e| ProtocolError(e.to_string()))?;
    if req.cmd.is_empty() {
        return Err(ProtocolError("empty cmd".into()));
    }
    Ok(req)
}

/// 把 request.args 解成命令自己的 struct;缺字段/类型错 → MissingField 语义的错误。
pub fn parse_args<T: DeserializeOwned>(req: &Request) -> Result<T, ProtocolError> {
    serde_json::from_value(req.args.clone()).map_err(|e| ProtocolError(e.to_string()))
}

// ---- 响应 / 事件构造(统一 JSON 编码,不手写字符串) ----

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

/// 事件(child 主动上报,无 id)。ev = 域(player),typ = 域内类型。
pub fn event<T: Serialize>(ev: &str, typ: &str, data: T) -> String {
    serde_json::to_string(&Event { ev, typ, data }).unwrap_or_default()
}

// 序列化兜底:极端情况下也回一条合法 internal_error(几乎不会触发)
fn err_static(id: u64) -> String {
    format!(
        r#"{{"id":{id},"ok":false,"error":{{"code":"internal_error","message":"encode failed"}}}}"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_request_ok() {
        let r = parse_request(r#"{"id":1,"cmd":"load","args":{"url":"u"}}"#).unwrap();
        assert_eq!(r.id, 1);
        assert_eq!(r.cmd, "load");
        let a: LoadArgs = parse_args(&r).unwrap();
        assert_eq!(a.url, "u");
    }

    #[test]
    fn parse_request_rejects_missing_cmd() {
        assert!(parse_request(r#"{"id":1,"args":{}}"#).is_err());
        assert!(parse_request(r#"{"id":1,"cmd":"","args":{}}"#).is_err());
    }

    #[test]
    fn parse_args_missing_field_errors() {
        let r = parse_request(r#"{"id":1,"cmd":"load","args":{}}"#).unwrap();
        assert!(parse_args::<LoadArgs>(&r).is_err());
    }

    #[test]
    fn ok_empty_shape() {
        let v: Value = serde_json::from_str(&ok_empty(3)).unwrap();
        assert_eq!(v, json!({"id":3,"ok":true,"data":{}}));
    }

    #[test]
    fn err_shape() {
        let v: Value = serde_json::from_str(&err(4, ErrorCode::FetchFailed, "boom")).unwrap();
        assert_eq!(
            v,
            json!({"id":4,"ok":false,"error":{"code":"fetch_failed","message":"boom"}})
        );
    }

    #[test]
    fn event_shape() {
        let v: Value = serde_json::from_str(&event("player", "ended", json!({}))).unwrap();
        assert_eq!(v, json!({"ev":"player","type":"ended","data":{}}));
    }
}
