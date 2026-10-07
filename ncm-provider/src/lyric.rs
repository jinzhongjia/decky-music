//! 歌词:lyric_new → 归一化到共享结构(见 src/api.ts Lyric)。
//! 有逐字(yrc)则 word_by_word=true 带 words[];yrc 缺失或解析为空时回退逐行(lrc)。
//! 译文:逐字模式优先 ytlrc,逐行模式优先 tlyric(都是逐行 LRC),按行首时间就近对齐;
//! 没有独立译文时才把 LRC 内嵌的「原文 + 译文」同时间戳双行合并。解析细则见 `parse`。

mod parse;
#[cfg(test)]
mod tests;

use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::protocol;
use crate::provider_commands::maybe_cookie;
use crate::state::State;

pub async fn lyric(state: &State, id: u64, song_id: &str) -> String {
    let q = maybe_cookie(Query::new().param("id", song_id), state.cookie().await);
    let body = match crate::provider_commands::call(state.client.lyric_new(&q), id).await {
        Ok(r) => r.body,
        Err(e) => return e,
    };
    protocol::ok(id, normalize(&body))
}

/// lyric_new 响应体 → `{word_by_word, lines}`。
fn normalize(body: &Value) -> Value {
    let raw = |k: &str| body[k]["lyric"].as_str().unwrap_or("");
    let first = |a: &str, b: &str| Some(raw(a)).filter(|s| !s.is_empty()).unwrap_or(raw(b));

    let yrc = parse::parse_yrc(raw("yrc"));
    let word_by_word = !yrc.is_empty();
    let tr_src = if word_by_word {
        first("ytlrc", "tlyric")
    } else {
        first("tlyric", "ytlrc")
    };
    let trans = parse::parse_lrc(tr_src, false);
    let mut lines = if word_by_word {
        yrc
    } else {
        parse::parse_lrc(raw("lrc"), trans.is_empty())
    };
    parse::align_translation(&mut lines, &trans);

    let lines_json: Vec<Value> = lines.iter().map(parse::Line::to_json).collect();
    json!({ "word_by_word": word_by_word, "lines": lines_json })
}
