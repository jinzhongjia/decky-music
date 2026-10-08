//! 命令参数校验:与原 Python 版同口径(整数允许十进制字符串,布尔必须是真布尔)。
//! 失败一律 `Fail::Invalid`,不回显输入。

use serde_json::Value;

use super::paging::WINDOW_SIZE;
use super::Fail;

/// 单次返回条数上限 = 一个上游窗口,保证一条命令最多两次上游请求。
const MAX_LIMIT: i64 = WINDOW_SIZE;

/// 正整数或十进制字符串;布尔、负数、其他类型都不算。
fn int_like(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64(),
        Value::String(s) if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) => {
            s.parse().ok()
        }
        _ => None,
    }
}

pub fn limit(args: &Value, default: i64) -> Result<i64, Fail> {
    match args.get("limit") {
        None | Some(Value::Null) => Ok(default.min(MAX_LIMIT)),
        Some(v) => match int_like(v) {
            Some(n) if n > 0 => Ok(n.min(MAX_LIMIT)),
            _ => Err(Fail::Invalid),
        },
    }
}

pub fn offset(args: &Value) -> Result<i64, Fail> {
    match args.get("offset") {
        None | Some(Value::Null) => Ok(0),
        Some(v) => match int_like(v) {
            Some(n) if n >= 0 => Ok(n),
            _ => Err(Fail::Invalid),
        },
    }
}

/// 非空字符串(去首尾空白);整数也接受并转成字符串(id 两种写法都有)。
pub fn string(args: &Value, key: &str) -> Result<String, Fail> {
    match args.get(key) {
        Some(Value::Number(n)) if n.is_i64() || n.is_u64() => Ok(n.to_string()),
        Some(Value::String(s)) if !s.trim().is_empty() => Ok(s.trim().to_string()),
        _ => Err(Fail::Invalid),
    }
}

pub fn int(args: &Value, key: &str) -> Result<i64, Fail> {
    args.get(key).and_then(int_like).ok_or(Fail::Invalid)
}

pub fn boolean(args: &Value, key: &str) -> Result<bool, Fail> {
    args.get(key).and_then(Value::as_bool).ok_or(Fail::Invalid)
}

pub fn keyword(args: &Value) -> Result<String, Fail> {
    match args.get("keyword") {
        Some(Value::String(s)) if !s.trim().is_empty() => Ok(s.trim().to_string()),
        _ => Err(Fail::Invalid),
    }
}
