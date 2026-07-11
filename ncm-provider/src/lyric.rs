//! 歌词:lyric_new → 归一化到共享结构(见 src/api.ts Lyric)。
//! 有逐字(yrc)则 word_by_word=true 带 words[];否则回退逐行(lrc)。
//! 翻译(ytlrc 优先,否则 tlyric,均为逐行 LRC)按行首时间对齐到主歌词。

use std::collections::HashMap;

use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::protocol;
use crate::state::State;

struct Word {
    t_ms: i64,
    dur_ms: i64,
    text: String,
}

struct Line {
    t_ms: i64,
    text: String,
    tr: String,
    words: Vec<Word>,
}

impl Line {
    fn to_json(&self) -> Value {
        let mut o = json!({ "t_ms": self.t_ms, "text": self.text, "tr": self.tr });
        if !self.words.is_empty() {
            o["words"] = Value::Array(
                self.words
                    .iter()
                    .map(|w| json!({ "t_ms": w.t_ms, "dur_ms": w.dur_ms, "text": w.text }))
                    .collect(),
            );
        }
        o
    }
}

pub async fn lyric(state: &State, id: u64, song_id: &str) -> String {
    let mut q = Query::new().param("id", song_id);
    if let Some(c) = state.cookie().await {
        q = q.cookie(&c);
    }
    let body = match crate::provider_commands::call(state.client.lyric_new(&q), id).await {
        Ok(r) => r.body,
        Err(e) => return e,
    };

    let yrc = body["yrc"]["lyric"].as_str().unwrap_or("");
    let (word_by_word, mut lines) = if !yrc.is_empty() {
        (true, parse_yrc(yrc))
    } else {
        (
            false,
            parse_lrc(body["lrc"]["lyric"].as_str().unwrap_or("")),
        )
    };

    // 翻译:逐字模式对应 ytlrc,逐行对应 tlyric;都是逐行 LRC → 按行首时间对齐
    let tr_src = {
        let y = body["ytlrc"]["lyric"].as_str().unwrap_or("");
        if !y.is_empty() {
            y
        } else {
            body["tlyric"]["lyric"].as_str().unwrap_or("")
        }
    };
    if !tr_src.is_empty() {
        let tr: HashMap<i64, String> = parse_lrc(tr_src)
            .into_iter()
            .map(|l| (l.t_ms, l.text))
            .collect();
        for line in lines.iter_mut() {
            if let Some(t) = tr.get(&line.t_ms) {
                line.tr = t.clone();
            }
        }
    }

    let lines_json: Vec<Value> = lines.iter().map(Line::to_json).collect();
    protocol::ok(
        id,
        json!({ "word_by_word": word_by_word, "lines": lines_json }),
    )
}

/// `[mm:ss(.fff)?]` → 毫秒;非数字标签(如 `ti:`/`ar:`)返回 None → 该行跳过。
fn parse_time_tag(tag: &str) -> Option<i64> {
    let (mm, rest) = tag.split_once(':')?;
    let (ss, frac) = rest.split_once('.').unwrap_or((rest, ""));
    let mut ms = mm.parse::<i64>().ok()? * 60000 + ss.parse::<i64>().ok()? * 1000;
    if !frac.is_empty() {
        let three: String = frac.chars().chain("000".chars()).take(3).collect(); // .5→500 .34→340
        ms += three.parse::<i64>().ok()?;
    }
    Some(ms)
}

/// 逐行 LRC → Line(无 words)。一行多时间标签则拆多行;无标签/空正文跳过。
fn parse_lrc(text: &str) -> Vec<Line> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let mut rest = raw;
        let mut times = Vec::new();
        while rest.starts_with('[') {
            let Some(end) = rest.find(']') else { break };
            match parse_time_tag(&rest[1..end]) {
                Some(ms) => {
                    times.push(ms);
                    rest = &rest[end + 1..];
                }
                None => break,
            }
        }
        let body = rest.trim();
        if times.is_empty() || body.is_empty() {
            continue;
        }
        for t in times {
            out.push(Line {
                t_ms: t,
                text: body.to_string(),
                tr: String::new(),
                words: Vec::new(),
            });
        }
    }
    out.sort_by_key(|l| l.t_ms);
    out
}

/// 逐字 YRC → Line(带 words)。行头 `[start,dur]`,每字 `(start,dur,0)text`。
/// 跳过以 `{` 开头的 JSON 元信息行。
fn parse_yrc(text: &str) -> Vec<Line> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if !line.starts_with('[') {
            continue; // 含 JSON 元信息行({...})
        }
        let Some(end) = line.find(']') else { continue };
        let Some((start, _)) = line[1..end].split_once(',') else {
            continue;
        };
        let Ok(start) = start.trim().parse::<i64>() else {
            continue;
        };
        let words = parse_yrc_words(&line[end + 1..]);
        if words.is_empty() {
            continue;
        }
        let text: String = words.iter().map(|w| w.text.as_str()).collect();
        out.push(Line {
            t_ms: start,
            text,
            tr: String::new(),
            words,
        });
    }
    out.sort_by_key(|l| l.t_ms);
    out
}

/// 解析一行 YRC 正文里的 `(start,dur,extra)text` 序列(字文本不含 `(`,以此分界)。
fn parse_yrc_words(s: &str) -> Vec<Word> {
    let mut words = Vec::new();
    let mut rest = s;
    while let Some(open) = rest.find('(') {
        let Some(rel) = rest[open..].find(')') else {
            break;
        };
        let close = open + rel;
        let mut it = rest[open + 1..close].split(',');
        let t = it.next().and_then(|x| x.trim().parse::<i64>().ok());
        let d = it.next().and_then(|x| x.trim().parse::<i64>().ok());
        let after = &rest[close + 1..];
        let next = after.find('(').unwrap_or(after.len());
        if let (Some(t_ms), Some(dur_ms)) = (t, d) {
            words.push(Word {
                t_ms,
                dur_ms,
                text: after[..next].to_string(),
            });
        }
        rest = &after[next..];
    }
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lrc_times_and_skip_meta() {
        let l = parse_lrc("[ti:x]\n[00:01.00]hello\n[00:02.5]world\n[00:03.345]!");
        assert_eq!(
            l.iter().map(|x| x.t_ms).collect::<Vec<_>>(),
            [1000, 2500, 3345]
        );
        assert_eq!(l[0].text, "hello");
    }

    #[test]
    fn lrc_multi_tag_line() {
        let l = parse_lrc("[00:01.00][00:05.00]repeat");
        assert_eq!(l.iter().map(|x| x.t_ms).collect::<Vec<_>>(), [1000, 5000]);
    }

    #[test]
    fn yrc_words_and_text() {
        let l = parse_yrc("[1000,500](1000,200,0)Ha(1200,300,0)llo");
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].t_ms, 1000);
        assert_eq!(l[0].text, "Hallo");
        assert_eq!(l[0].words.len(), 2);
        assert_eq!((l[0].words[1].t_ms, l[0].words[1].dur_ms), (1200, 300));
    }

    #[test]
    fn yrc_skips_json_meta() {
        let l = parse_yrc("{\"t\":0,\"c\":[]}\n[0,100](0,100,0)x");
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].text, "x");
    }
}
