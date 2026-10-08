use serde_json::{json, Value};

use super::normalize;
use super::parse::{align_translation, parse_lrc, parse_yrc, Line};

fn times(l: &[Line]) -> Vec<i64> {
    l.iter().map(|x| x.t_ms).collect()
}

fn texts(l: &[Line]) -> Vec<&str> {
    l.iter().map(|x| x.text.as_str()).collect()
}

fn trs(l: &[Line]) -> Vec<&str> {
    l.iter().map(|x| x.tr.as_str()).collect()
}

fn body(pairs: &[(&str, &str)]) -> Value {
    let mut b = json!({});
    for (k, v) in pairs {
        b[*k] = json!({ "lyric": v });
    }
    b
}

#[test]
fn lrc_times_and_skip_meta() {
    let l = parse_lrc(
        "[ti:x]\n[00:01.00]hello\n[00:02.5]world\n[00:03.345]!",
        false,
    );
    assert_eq!(times(&l), [1000, 2500, 3345]);
    assert_eq!(l[0].text, "hello");
}

#[test]
fn lrc_multi_tag_line() {
    let l = parse_lrc("[00:01.00][00:05.00]repeat", false);
    assert_eq!(times(&l), [1000, 5000]);
}

#[test]
fn lrc_time_tag_variants() {
    // 无小数、冒号分隔厘秒(NCM 部分歌曲整首如此)、超过三位小数;非法标签整行跳过
    let l = parse_lrc("[00:12]a\n[00:13:96]b\n[00:14.3456]c\n[0x:15.00]bad", false);
    assert_eq!(times(&l), [12000, 13960, 14345]);
    assert_eq!(texts(&l), ["a", "b", "c"]);
}

#[test]
fn lrc_bom_and_crlf() {
    let l = parse_lrc("\u{feff}[00:01.00]first\r\n[00:02.00]second\r\n", false);
    assert_eq!(texts(&l), ["first", "second"]);
}

#[test]
fn lrc_interlude_markers_set_end_and_are_dropped() {
    let l = parse_lrc("[00:01.00]a\n[00:03.00]\n[00:05.00]//\n[00:20.00]b", false);
    assert_eq!(texts(&l), ["a", "b"]);
    assert_eq!(l[0].end_ms, Some(3000));
    assert_eq!(l[1].end_ms, None); // 末行结束时间未知
}

#[test]
fn lrc_end_is_next_distinct_time() {
    let l = parse_lrc("[00:01.00]a\n[00:01.00]b\n[00:04.00]c", false);
    assert_eq!((l[0].end_ms, l[1].end_ms), (Some(4000), Some(4000)));
}

#[test]
fn lrc_merges_embedded_translation() {
    let raw = "[00:01.00]Hello\n[00:01.00]你好\n[00:03.00]Bye\n[00:03.00]再见";
    let l = parse_lrc(raw, true);
    assert_eq!(texts(&l), ["Hello", "Bye"]);
    assert_eq!(trs(&l), ["你好", "再见"]);
    assert_eq!(l[0].end_ms, Some(3000));
}

#[test]
fn lrc_does_not_merge_credits_or_duplicates() {
    let raw = "[00:00.00]作词：甲\n[00:00.00]作曲：乙\n[00:05.00]la\n[00:05.00]la";
    let l = parse_lrc(raw, true);
    assert_eq!(texts(&l), ["作词：甲", "作曲：乙", "la", "la"]);
    assert!(l.iter().all(|x| x.tr.is_empty()));
}

#[test]
fn yrc_words_and_text() {
    let l = parse_yrc("[1000,500](1000,200,0)Ha(1200,300,0)llo");
    assert_eq!(l.len(), 1);
    assert_eq!(l[0].t_ms, 1000);
    assert_eq!(l[0].end_ms, Some(1500));
    assert_eq!(l[0].text, "Hallo");
    assert_eq!(l[0].words.len(), 2);
    assert_eq!((l[0].words[1].t_ms, l[0].words[1].dur_ms), (1200, 300));
}

#[test]
fn yrc_skips_json_meta() {
    let l = parse_yrc("{\"t\":0,\"c\":[]}\n[0,100](0,100,0)x");
    assert_eq!(texts(&l), ["x"]);
}

#[test]
fn yrc_keeps_ascii_parentheses_in_text() {
    let l = parse_yrc("[1000,2000](1000,300,0)Oh (1300,400,0)(love (1700,300,0)me)");
    assert_eq!(l[0].text, "Oh (love me)");
    let words: Vec<&str> = l[0].words.iter().map(|w| w.text.as_str()).collect();
    assert_eq!(words, ["Oh ", "(love ", "me)"]);
}

#[test]
fn yrc_drops_empty_trailing_word() {
    // 真实 YRC 行尾常带一个无文本的结束标签
    let l = parse_yrc("[3620,3870](3620,550,0)房(4170,230,0)间(7020,470,0) ");
    assert_eq!(l[0].words.len(), 2);
    assert_eq!(l[0].end_ms, Some(7490));
}

#[test]
fn yrc_skips_placeholder_lines() {
    let l = parse_yrc("[0,100](0,100,0)//\n[200,100](200,100,0)x");
    assert_eq!(texts(&l), ["x"]);
}

#[test]
fn align_tolerates_precision_drift() {
    let mut l = parse_yrc("[12345,1000](12345,1000,0)hello");
    align_translation(&mut l, &parse_lrc("[00:12.34]你好", false));
    assert_eq!(l[0].tr, "你好");
}

#[test]
fn align_prefers_nearest_line() {
    // 两行主歌词都在容差内,译文只给更近的那行
    let mut l = parse_lrc("[00:01.00]a\n[00:01.20]b", false);
    align_translation(&mut l, &parse_lrc("[00:01.20]乙", false));
    assert_eq!(trs(&l), ["", "乙"]);
}

#[test]
fn align_skips_placeholder_and_out_of_range() {
    let mut l = parse_lrc("[00:01.00]hello\n[00:02.00]world\n[00:05.00]far", false);
    let trans = parse_lrc("[00:01.00]你好\n[00:02.00]//\n[00:05.50]远", false);
    align_translation(&mut l, &trans);
    assert_eq!(trs(&l), ["你好", "", ""]);
}

#[test]
fn normalize_word_by_word_with_tlyric_fallback() {
    let out = normalize(&body(&[
        ("yrc", "[12345,1000](12345,1000,0)hello"),
        ("lrc", "[00:12.34]hello"),
        ("tlyric", "[00:12.34]你好"),
    ]));
    assert_eq!(out["word_by_word"], true);
    assert_eq!(out["lines"][0]["tr"], "你好");
    assert_eq!(out["lines"][0]["end_ms"], 13345);
}

#[test]
fn normalize_falls_back_to_lrc_when_yrc_has_no_lines() {
    let out = normalize(&body(&[("yrc", "{\"t\":0}"), ("lrc", "[00:01.00]a")]));
    assert_eq!(out["word_by_word"], false);
    assert_eq!(out["lines"][0]["text"], "a");
    assert!(out["lines"][0].get("words").is_none());
    assert!(out["lines"][0].get("end_ms").is_none());
}

#[test]
fn normalize_merges_embedded_only_without_external_translation() {
    let lrc = "[00:01.00]Hello\n[00:01.00]你好";
    let merged = normalize(&body(&[("lrc", lrc)]));
    assert_eq!(merged["lines"].as_array().map(Vec::len), Some(1));
    assert_eq!(merged["lines"][0]["tr"], "你好");
    let kept = normalize(&body(&[("lrc", lrc), ("tlyric", "[00:01.00]哈喽")]));
    assert_eq!(kept["lines"].as_array().map(Vec::len), Some(2));
    assert_eq!(kept["lines"][0]["tr"], "哈喽");
}

/// 与 qq 后端的 tests.rs 共用同一份用例,保证两个音源的逐行 LRC 解析一致。
#[test]
fn shared_lrc_cases_match_fixture() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../tests/fixtures/lyric_lrc_cases.json"
    ))
    .expect("fixture is valid JSON");
    let cases = fixture["cases"].as_array().expect("cases array");
    assert!(!cases.is_empty());
    for case in cases {
        let lrc = case["lrc"].as_str().unwrap_or_default();
        let trans = case["trans"].as_str().unwrap_or_default();
        let out = normalize(&body(&[("lrc", lrc), ("tlyric", trans)]));
        assert_eq!(out["word_by_word"], false, "{}", case["name"]);
        assert_eq!(out["lines"], case["lines"], "{}", case["name"]);
    }
}

#[test]
fn yrc_invalid_duration_has_no_end() {
    let l = parse_yrc("[1000,x](1000,200,0)a");
    assert_eq!(texts(&l), ["a"]);
    assert_eq!(l[0].end_ms, None);
}

#[test]
fn yrc_out_of_range_times() {
    // 行头超出安全整数跳过整行;行尾超出时只丢 end_ms;超大值不会溢出 panic
    let l = parse_yrc(
        "[99999999999999999999,1](1,1,0)skip\n[9007199254740991,10](1,1,0)a\n[1000,500](1000,500,0)b",
    );
    assert_eq!(texts(&l), ["b", "a"]);
    assert_eq!((l[0].end_ms, l[1].end_ms), (Some(1500), None));
}

#[test]
fn yrc_word_tag_shapes() {
    // 两段标签可用;四段不是时间标签,按正文保留
    let l = parse_yrc("[1000,500](1000,200)a(1200,300,0,9)b");
    let words: Vec<&str> = l[0].words.iter().map(|w| w.text.as_str()).collect();
    assert_eq!(words, ["a(1200,300,0,9)b"]);
}

#[test]
fn yrc_drops_leading_text_and_sorts_lines() {
    let l = parse_yrc("[2000,100]junk(2000,100,0)b\n[1000,100](1000,100,0)a");
    assert_eq!(texts(&l), ["a", "b"]);
}

#[test]
fn align_keeps_existing_translation() {
    let mut l = parse_lrc("[00:01.00]Hello\n[00:01.00]你好", true);
    align_translation(&mut l, &parse_lrc("[00:01.00]哈喽", false));
    assert_eq!(trs(&l), ["你好"]);
}

#[test]
fn normalize_picks_translation_source_by_mode() {
    let tr = [
        ("ytlrc", "[00:01.00]逐字译"),
        ("tlyric", "[00:01.00]逐行译"),
    ];
    let yrc = normalize(&body(&[("yrc", "[1000,500](1000,500,0)a"), tr[0], tr[1]]));
    assert_eq!(yrc["lines"][0]["tr"], "逐字译");
    let lrc = normalize(&body(&[("lrc", "[00:01.00]a"), tr[0], tr[1]]));
    assert_eq!(lrc["lines"][0]["tr"], "逐行译");
}

#[test]
fn normalize_empty_body() {
    assert_eq!(
        normalize(&json!({})),
        json!({ "word_by_word": false, "lines": [] })
    );
}

#[test]
fn parsers_never_panic_on_truncated_input() {
    // 在每个字符边界截断(含多字节字符、半截标签、未闭合括号),只要求不 panic
    let samples = [
        "\u{feff}[00:01:23]你好(世界)\n[00:0",
        "[3620,3870](3620,550,0)房(4170,230,0)间(7020,4",
        "[1,2](1,2,0)a(b(c,d)\n{\"t\":0}",
        "[99999999999:99999999999.9999]x\n[9223372036854775807,9223372036854775807](9223372036854775807,1,0)y",
    ];
    for s in samples {
        for i in s.char_indices().map(|(i, _)| i).chain([s.len()]) {
            parse_lrc(&s[..i], true);
            parse_yrc(&s[..i]);
        }
    }
}
