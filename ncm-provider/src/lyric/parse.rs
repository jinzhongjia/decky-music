//! LRC / YRC 文本解析与翻译对齐(纯函数,无 IO)。规则与 `qq-provider/qq/lyric.py` 保持一致:
//! - 时间标签只认行首连续的 `[mm:ss]` / `[mm:ss.f…]` / `[mm:ss:f…]`(小数取前三位作毫秒);
//! - 空正文与占位行(`//`、纯标点)是间奏标记:不输出,只用来给上一行定 `end_ms`;
//! - 译文按行首时间就近对齐(容差 `ALIGN_TOLERANCE_MS`),占位译文视为「此行无翻译」;
//! - 同时间戳的「原文 + 译文」双行可合并为一行(含冒号的制作人员 / 对唱行不合并)。

use serde_json::{json, Value};

/// 译文行首与主歌词行首的最大允许偏差(毫秒):tlyric 是厘秒精度,YRC 是毫秒精度。
pub(super) const ALIGN_TOLERANCE_MS: i64 = 300;

/// 占位字符:QQ / NCM 用 `//` 表示空行间隔或「此行无翻译」,也有整行 `......` 的。
const PLACEHOLDER_CHARS: &str = "/\\_-—~～·•….。";

pub(super) struct Word {
    pub t_ms: i64,
    pub dur_ms: i64,
    pub text: String,
}

pub(super) struct Line {
    pub t_ms: i64,
    /// 行结束时间:YRC 取行头时长,LRC 取下一个时间点;未知(LRC 末行)为 None。
    pub end_ms: Option<i64>,
    pub text: String,
    pub tr: String,
    pub words: Vec<Word>,
}

impl Line {
    pub fn to_json(&self) -> Value {
        let mut o = json!({ "t_ms": self.t_ms, "text": self.text, "tr": self.tr });
        if let Some(end) = self.end_ms {
            o["end_ms"] = json!(end);
        }
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

/// 空串或全是空白 / 占位标点 → 无实际内容。
fn is_placeholder(s: &str) -> bool {
    s.chars()
        .all(|c| c.is_whitespace() || PLACEHOLDER_CHARS.contains(c))
}

fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

fn num(s: &str) -> Option<i64> {
    let s = s.trim();
    if is_digits(s) {
        s.parse().ok()
    } else {
        None
    }
}

/// `mm:ss` / `mm:ss.f…` / `mm:ss:f…` → 毫秒(.5→500 .34→340 .3456→345);
/// 非数字标签(如 `ti:` / `ar:`)返回 None。
fn parse_time_tag(tag: &str) -> Option<i64> {
    let (mm, rest) = tag.split_once(':')?;
    let (ss, frac) = rest.split_once(['.', ':']).unwrap_or((rest, ""));
    if !is_digits(mm) || !is_digits(ss) || !(frac.is_empty() || is_digits(frac)) {
        return None;
    }
    let ms: String = frac.chars().chain("000".chars()).take(3).collect();
    Some(
        mm.parse::<i64>().ok()? * 60_000
            + ss.parse::<i64>().ok()? * 1000
            + ms.parse::<i64>().ok()?,
    )
}

/// LRC → (时间, 正文),按时间稳定排序(同时间戳保持原文在前);一行多标签拆多条。
/// 正文为空或是占位时记为空串,作为间奏标记保留。
fn lrc_entries(text: &str) -> Vec<(i64, String)> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let mut rest = raw.trim_start_matches('\u{feff}').trim_start();
        let mut times = Vec::new();
        while let Some(inner) = rest.strip_prefix('[') {
            let Some(close) = inner.find(']') else { break };
            let Some(ms) = parse_time_tag(&inner[..close]) else {
                break;
            };
            times.push(ms);
            rest = &inner[close + 1..];
        }
        let body = rest.trim();
        let body = if is_placeholder(body) { "" } else { body };
        out.extend(times.into_iter().map(|t| (t, body.to_string())));
    }
    out.sort_by_key(|e| e.0);
    out
}

fn has_colon(s: &str) -> bool {
    s.contains([':', '：'])
}

/// 同时间戳的第二行并为上一行的译文;含冒号的(「作词:xx」「男:」)与重复行不合并。
fn merge_embedded(prev: Option<&mut Line>, t_ms: i64, text: &str) -> bool {
    let Some(prev) = prev else { return false };
    let ok = prev.t_ms == t_ms
        && prev.tr.is_empty()
        && prev.text != text
        && !has_colon(&prev.text)
        && !has_colon(text);
    if ok {
        prev.tr = text.to_string();
    }
    ok
}

/// 逐行 LRC → Line(无 words)。`merge_embedded`:把同时间戳「原文 + 译文」合并(仅在没有
/// 独立译文时开启,避免把真正的同刻歌词吞成译文)。
pub(super) fn parse_lrc(text: &str, merge_embedded_tr: bool) -> Vec<Line> {
    let entries = lrc_entries(text);
    let mut out: Vec<Line> = Vec::new();
    for (i, (t, body)) in entries.iter().enumerate() {
        if body.is_empty() || (merge_embedded_tr && merge_embedded(out.last_mut(), *t, body)) {
            continue;
        }
        let end_ms = entries[i + 1..].iter().map(|e| e.0).find(|&n| n > *t);
        out.push(Line {
            t_ms: *t,
            end_ms,
            text: body.clone(),
            tr: String::new(),
            words: Vec::new(),
        });
    }
    out
}

/// `[start,dur]rest` → (start, dur, rest);dur 非法时为 None。
fn yrc_header(line: &str) -> Option<(i64, Option<i64>, &str)> {
    let (head, rest) = line.strip_prefix('[')?.split_once(']')?;
    let (start, dur) = head.split_once(',')?;
    Some((num(start)?, num(dur), rest))
}

/// 逐字 YRC → Line(带 words)。跳过 `{` 开头的 JSON 元信息行与无正文行。
pub(super) fn parse_yrc(text: &str) -> Vec<Line> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim_start_matches('\u{feff}').trim();
        let Some((start, dur, rest)) = yrc_header(line) else {
            continue;
        };
        let words = parse_yrc_words(rest);
        let text: String = words.iter().map(|w| w.text.as_str()).collect();
        if is_placeholder(&text) {
            continue;
        }
        out.push(Line {
            t_ms: start,
            end_ms: dur.map(|d| start + d),
            text,
            tr: String::new(),
            words,
        });
    }
    out.sort_by_key(|l| l.t_ms);
    out
}

/// `(start,dur[,x])` 打头 → (start, dur, 之后的文本);各段须为纯数字,否则不是时间标签。
fn word_tag(s: &str) -> Option<(i64, i64, &str)> {
    let (inner, after) = s.strip_prefix('(')?.split_once(')')?;
    let mut it = inner.split(',');
    let (t, d) = (num(it.next()?)?, num(it.next()?)?);
    if let Some(x) = it.next() {
        num(x)?;
    }
    if it.next().is_some() {
        return None;
    }
    Some((t, d, after))
}

/// 把累积文本落成上一个时间标签的字;第一个标签前的文本与空文本丢弃。
fn flush_word(words: &mut Vec<Word>, cur: Option<(i64, i64)>, text: &mut String) {
    let text = std::mem::take(text);
    if let (Some((t_ms, dur_ms)), false) = (cur, text.is_empty()) {
        words.push(Word { t_ms, dur_ms, text });
    }
}

/// 一行 YRC 正文里的 `(start,dur,0)text` 序列;只认纯数字时间标签,正文里的半角括号原样保留。
fn parse_yrc_words(s: &str) -> Vec<Word> {
    let mut words = Vec::new();
    let mut cur = None;
    let mut text = String::new();
    let mut rest = s;
    while let Some(open) = rest.find('(') {
        text.push_str(&rest[..open]);
        match word_tag(&rest[open..]) {
            Some((t, d, after)) => {
                flush_word(&mut words, cur.replace((t, d)), &mut text);
                rest = after;
            }
            None => {
                text.push('(');
                rest = &rest[open + 1..];
            }
        }
    }
    text.push_str(rest);
    flush_word(&mut words, cur, &mut text);
    words
}

/// 是否有比当前配对(偏差 `d`)更近的相邻候选。
fn closer(next: Option<i64>, anchor: i64, d: i64) -> bool {
    next.is_some_and(|n| (n - anchor).abs() < d.abs())
}

/// 逐行译文按行首时间就近对齐到主歌词(两边均已按时间排序;双指针 + 容差)。
/// 相邻行更近时把这一对让给它,避免密集行错配;已有译文的行不覆盖。
/// `trans` 来自 `parse_lrc`,占位译文已在那里当作间奏标记丢弃。
pub(super) fn align_translation(lines: &mut [Line], trans: &[Line]) {
    let (mut i, mut j) = (0, 0);
    while i < lines.len() && j < trans.len() {
        let d = lines[i].t_ms - trans[j].t_ms;
        if d.abs() > ALIGN_TOLERANCE_MS {
            if d < 0 {
                i += 1;
            } else {
                j += 1;
            }
        } else if closer(lines.get(i + 1).map(|l| l.t_ms), trans[j].t_ms, d) {
            i += 1;
        } else if closer(trans.get(j + 1).map(|l| l.t_ms), lines[i].t_ms, d) {
            j += 1;
        } else {
            if lines[i].tr.is_empty() {
                lines[i].tr = trans[j].text.clone();
            }
            i += 1;
            j += 1;
        }
    }
}
