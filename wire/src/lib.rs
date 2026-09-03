//! bridge ↔ child 协议 v1 的 Rust 侧实现,player 与 ncm-provider 共用。
//! wire 格式见 issue #31:request{id,cmd,args} / response{id,ok,data|error} /
//! event{ev,type,data} / log{ev:"log",level,where,msg}。
//!
//! 各二进制自己的命令 args struct 留在各自的 `protocol` 模块里(它把本 crate 整个再导出),
//! 业务代码照旧写 `protocol::ok(...)` / `protocol::ErrorCode::X`,不碰裸 JSON。

use std::error::Error;
use std::{fmt, io};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::{AsyncBufRead, AsyncBufReadExt};

#[derive(Debug)]
pub struct ProtocolError(pub String);

/// UDS + NDJSON frame payload ceiling. The newline delimiter is not counted.
pub const MAX_FRAME_BYTES: usize = 1 << 20;

#[derive(Debug)]
pub enum FrameReadError {
    Io(io::Error),
    TooLarge,
    InvalidUtf8,
}

impl fmt::Display for FrameReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "frame I/O error: {error}"),
            Self::TooLarge => write!(f, "frame exceeds {MAX_FRAME_BYTES} byte limit"),
            Self::InvalidUtf8 => write!(f, "frame is not UTF-8"),
        }
    }
}

impl Error for FrameReadError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::TooLarge | Self::InvalidUtf8 => None,
        }
    }
}

impl From<io::Error> for FrameReadError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Read one bounded NDJSON frame. An EOF after a nonempty final frame is accepted for parity with
/// `asyncio.StreamReader.readline`; callers close the connection on malformed/oversized frames.
pub async fn read_frame<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    frame: &mut Vec<u8>,
) -> Result<Option<String>, FrameReadError> {
    frame.clear();
    let mut received = false;
    loop {
        let chunk = reader.fill_buf().await?;
        if chunk.is_empty() {
            break;
        }
        let take = chunk
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(chunk.len(), |index| index + 1);
        let ended = chunk[take - 1] == b'\n';
        if frame.len() + take > MAX_FRAME_BYTES + usize::from(ended) {
            return Err(FrameReadError::TooLarge);
        }
        received = true;
        frame.extend_from_slice(&chunk[..take]);
        reader.consume(take);
        if ended {
            frame.pop();
            break;
        }
    }
    if !received {
        return Ok(None);
    }
    String::from_utf8(frame.clone())
        .map(Some)
        .map_err(|_| FrameReadError::InvalidUtf8)
}

/// 稳定错误码(两端并集)。序列化即 wire 上的 error.code,前端据此 i18n。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    // 通用
    UnknownCmd,
    InvalidRequest,
    MissingField,
    // player
    FetchFailed,
    FetchTimeout,
    DecodeFailed,
    SeekFailed,
    AudioDeviceFailed,
    AudioThreadGone,
    Superseded,
    // provider
    /// provider 单次上游请求超时。常是瞬时抖动(打游戏抢带宽等),不等于整条链路不可用,
    /// 故与 bridge 自己产出的通道级 `timeout`(子进程整体不响应,30s 上限)分开:
    /// 后者立即熔断,本码按连续 2 次才熔断。通道级 timeout 只由 bridge 产出,Rust 侧不发。
    UpstreamTimeout,
    NoPlayable,
    ProviderError,
    NotLoggedIn,
}

/// 协议 v1 允许的日志级别。序列化即 wire 上的 level。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// bridge → child 请求。args 先收成 Value,再由各命令 parse_args 解成对应 struct。
#[derive(Debug, Deserialize)]
pub struct Request {
    pub id: u64,
    pub cmd: String,
    #[serde(default)]
    pub args: serde_json::Value,
}

pub fn parse_request(line: &str) -> Result<Request, ProtocolError> {
    let req: Request = serde_json::from_str(line).map_err(|e| ProtocolError(e.to_string()))?;
    if req.cmd.is_empty() {
        return Err(ProtocolError("empty cmd".into()));
    }
    Ok(req)
}

/// 把 request.args 解成命令自己的 struct;缺字段/类型错 → 错误(调用方映射成 missing_field)。
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
    code: ErrorCode,
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
        error: ErrorBody { code, message },
    })
    .unwrap_or_else(|_| err_static(id))
}

/// 事件(child 主动上报,无 id)。ev = 域(player/login/provider),typ = 域内类型。
pub fn event<T: Serialize>(ev: &str, typ: &str, data: T) -> String {
    serde_json::to_string(&Event { ev, typ, data }).unwrap_or_default()
}

/// 一条日志事件的 NDJSON(独立顶层格式)。见 AGENTS.md「Logging rules」。
/// place 是短标签(如 "load")。日志一律英文、不含密钥/URL/cookie。
pub fn log_json(level: LogLevel, place: &str, msg: &str) -> String {
    json!({ "ev": "log", "level": level, "where": place, "msg": msg }).to_string()
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
    use serde_json::Value;
    use tokio::io::{AsyncWriteExt, BufReader};

    #[derive(Debug, Deserialize)]
    struct LoadArgs {
        url: String,
    }

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
    fn parse_args_ignores_extra_fields() {
        let r =
            parse_request(r#"{"id":6,"cmd":"load","args":{"url":"u","media_mid":"x"}}"#).unwrap();
        let a: LoadArgs = parse_args(&r).unwrap();
        assert_eq!(a.url, "u");
    }

    #[test]
    fn ok_empty_shape() {
        let v: Value = serde_json::from_str(&ok_empty(3)).unwrap();
        assert_eq!(v, json!({"id":3,"ok":true,"data":{}}));
    }

    #[test]
    fn ok_shape() {
        let v: Value = serde_json::from_str(&ok(1, json!({"songs":[]}))).unwrap();
        assert_eq!(v, json!({"id":1,"ok":true,"data":{"songs":[]}}));
    }

    /// 错误码的 wire 串是前端 i18n 的键,serde 的 snake_case 派生必须与协议一致。
    #[test]
    fn err_shape_and_code_strings() {
        let v: Value = serde_json::from_str(&err(4, ErrorCode::FetchFailed, "boom")).unwrap();
        assert_eq!(
            v,
            json!({"id":4,"ok":false,"error":{"code":"fetch_failed","message":"boom"}})
        );
        for (code, want) in [
            (ErrorCode::UnknownCmd, "unknown_cmd"),
            (ErrorCode::AudioDeviceFailed, "audio_device_failed"),
            (ErrorCode::NoPlayable, "no_playable"),
            (ErrorCode::UpstreamTimeout, "upstream_timeout"),
            (ErrorCode::NotLoggedIn, "not_logged_in"),
        ] {
            let v: Value = serde_json::from_str(&err(1, code, "m")).unwrap();
            assert_eq!(v["error"]["code"], want);
        }
    }

    #[test]
    fn event_shape() {
        let v: Value = serde_json::from_str(&event("player", "ended", json!({}))).unwrap();
        assert_eq!(v, json!({"ev":"player","type":"ended","data":{}}));
    }

    #[test]
    fn log_json_escapes_and_labels() {
        let v: Value = serde_json::from_str(&log_json(LogLevel::Warn, "a\"b", "m\nsg")).unwrap();
        assert_eq!(
            v,
            json!({"ev":"log","level":"warn","where":"a\"b","msg":"m\nsg"})
        );
    }

    #[tokio::test]
    async fn read_frame_accepts_a_max_sized_payload() {
        let (mut writer, reader) = tokio::io::duplex(MAX_FRAME_BYTES + 1);
        writer
            .write_all(&vec![b'x'; MAX_FRAME_BYTES])
            .await
            .unwrap();
        drop(writer);
        let mut reader = BufReader::new(reader);
        let mut frame = Vec::new();

        assert_eq!(
            read_frame(&mut reader, &mut frame).await.unwrap(),
            Some("x".repeat(MAX_FRAME_BYTES))
        );
    }

    #[tokio::test]
    async fn read_frame_reuses_the_buffer_for_sequential_messages() {
        let (mut writer, reader) = tokio::io::duplex(64);
        writer.write_all(b"{\"id\":1}\n{\"id\":2}\n").await.unwrap();
        drop(writer);
        let mut reader = BufReader::new(reader);
        let mut frame = Vec::new();

        assert_eq!(
            read_frame(&mut reader, &mut frame).await.unwrap(),
            Some("{\"id\":1}".into())
        );
        assert_eq!(
            read_frame(&mut reader, &mut frame).await.unwrap(),
            Some("{\"id\":2}".into())
        );
    }

    #[tokio::test]
    async fn read_frame_rejects_an_oversized_payload() {
        let (mut writer, reader) = tokio::io::duplex(MAX_FRAME_BYTES + 2);
        writer
            .write_all(&vec![b'x'; MAX_FRAME_BYTES + 1])
            .await
            .unwrap();
        drop(writer);
        let mut reader = BufReader::new(reader);
        let mut frame = Vec::new();

        assert!(matches!(
            read_frame(&mut reader, &mut frame).await,
            Err(FrameReadError::TooLarge)
        ));
    }
}
