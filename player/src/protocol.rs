//! bridge ↔ player 协议 v1。通用部分(请求解析 / 响应·事件·日志构造 / 错误码)在 `wire`
//! crate,与 ncm-provider 共用;这里只留 player 自己的命令 args struct。

pub use wire::*;

use serde::Deserialize;

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

/// `meta` 命令:bridge 下发当前曲目元数据 + 可否上下曲,供 player 的 MPRIS 层展示/控制。
/// `clear=true` 表示无当前曲(停止/清空队列),其余字段忽略。
#[derive(Debug, Default, Deserialize)]
pub struct MetaArgs {
    #[serde(default)]
    pub clear: bool,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub art_url: String,
    #[serde(default)]
    pub track_id: String,
    #[serde(default)]
    pub length_ms: f64,
    #[serde(default)]
    pub can_next: bool,
    #[serde(default)]
    pub can_prev: bool,
    #[serde(default)]
    pub play_mode: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_meta_args_defaults_and_fields() {
        let r = parse_request(
            r#"{"id":1,"cmd":"meta","args":{"title":"T","artist":"A","length_ms":1000,"can_next":true}}"#,
        )
        .unwrap();
        let a: MetaArgs = parse_args(&r).unwrap();
        assert_eq!(a.title, "T");
        assert_eq!(a.artist, "A");
        assert_eq!(a.length_ms, 1000.0);
        assert!(a.can_next);
        assert!(!a.can_prev); // 缺省 false
        assert!(!a.clear);
        assert_eq!(a.art_url, ""); // 缺省空串

        let r = parse_request(r#"{"id":2,"cmd":"meta","args":{"clear":true}}"#).unwrap();
        let a: MetaArgs = parse_args(&r).unwrap();
        assert!(a.clear);
    }
}
