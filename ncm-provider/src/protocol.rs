//! bridge ↔ ncm-provider 协议 v1。通用部分(请求解析 / 响应·事件·日志构造 / 错误码)在
//! `wire` crate,与 player 共用;这里只留 ncm-provider 自己的命令 args struct。

pub use wire::*;

use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct SetCredentialArgs {
    #[serde(default)]
    pub cred: Value, // {cookie:...} 或 null
}

// 通用 {id} 参数。song_url 多余的 media_mid 会被 serde 忽略(QQ 才需要)。
#[derive(Debug, Deserialize)]
pub struct IdArgs {
    #[serde(default)]
    pub id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_args_parse_and_ignore_extra_media_mid() {
        let r = parse_request(r#"{"id":6,"cmd":"song_url","args":{"id":"123","media_mid":"x"}}"#)
            .unwrap();
        let a: IdArgs = parse_args(&r).unwrap();
        assert_eq!(a.id, "123");
    }
}
