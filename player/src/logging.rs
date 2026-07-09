//! 结构化日志事件工具。见 AGENTS.md「Logging rules」。
//! bridge 收 `{"ev":"log",...}` 后落 decky.logger(origin=socket)。日志一律英文、不含密钥/URL。

/// 协议 v1 允许的日志级别。
#[derive(Clone, Copy)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    fn as_str(self) -> &'static str {
        match self {
            LogLevel::Debug => "debug",
            LogLevel::Info => "info",
            LogLevel::Warn => "warn",
            LogLevel::Error => "error",
        }
    }
}

/// 构造一条日志事件的 NDJSON。place 是短标签(如 "load")。
pub fn log_json(level: LogLevel, place: &str, msg: &str) -> String {
    let level = level.as_str();
    let m = serde_json::to_string(msg).unwrap_or_else(|_| "\"\"".to_string());
    format!(r#"{{"ev":"log","level":"{level}","where":"{place}","msg":{m}}}"#)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_level_strings_match_protocol() {
        let cases = [
            (LogLevel::Debug, "debug"),
            (LogLevel::Info, "info"),
            (LogLevel::Warn, "warn"),
            (LogLevel::Error, "error"),
        ];

        for (level, value) in cases {
            assert_eq!(level.as_str(), value);
        }
    }
}
