//! 结构化日志事件工具。见 AGENTS.md「Logging rules」。
//! bridge 收 `{"ev":"log",...}` 后落 decky.logger(origin=socket)。日志一律英文、不含密钥/URL。

/// 构造一条日志事件的 NDJSON。level ∈ debug|info|warn|error;place 是短标签(如 "load")。
pub fn log_json(level: &str, place: &str, msg: &str) -> String {
    let m = serde_json::to_string(msg).unwrap_or_else(|_| "\"\"".to_string());
    format!(r#"{{"ev":"log","level":"{level}","where":"{place}","msg":{m}}}"#)
}
