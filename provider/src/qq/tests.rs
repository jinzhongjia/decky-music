use serde_json::json;

use super::paging::window;
use super::{args, brief, media, Fail};

#[test]
fn clean_strips_highlight_tags() {
    assert_eq!(brief::clean("<em class=\"x\">晴</em>天"), "晴天");
    assert_eq!(brief::clean("plain"), "plain");
}

#[test]
fn args_follow_python_contract() {
    assert_eq!(args::limit(&json!({}), 20).ok(), Some(20));
    assert_eq!(args::limit(&json!({"limit": "80"}), 20).ok(), Some(50));
    assert!(args::limit(&json!({"limit": true}), 20).is_err());
    assert!(args::limit(&json!({"limit": 0}), 20).is_err());
    assert!(args::offset(&json!({"offset": -1})).is_err());
    assert_eq!(
        args::string(&json!({"id": 42}), "id").ok().as_deref(),
        Some("42")
    );
    assert!(args::string(&json!({"id": "  "}), "id").is_err());
    assert!(args::boolean(&json!({"on": 1}), "on").is_err());
    assert!(matches!(
        args::keyword(&json!({"keyword": ""})),
        Err(Fail::Invalid)
    ));
}

#[tokio::test]
async fn window_crosses_into_second_page_only_when_needed() {
    let fetch = |page: i64, num: i64| async move {
        let start = (page - 1) * num;
        Ok::<_, Fail>(((start..start + num).collect::<Vec<i64>>(), page))
    };
    let (items, first) = window(20, 40, fetch).await.unwrap();
    assert_eq!(first, 1);
    assert_eq!(items, (40..60).collect::<Vec<i64>>());
    let (items, _) = window(5, 0, fetch).await.unwrap();
    assert_eq!(items, vec![0, 1, 2, 3, 4]);
}

#[tokio::test]
async fn window_stops_at_short_first_page() {
    let calls = std::sync::atomic::AtomicUsize::new(0);
    let fetch = |_page: i64, _num: i64| {
        calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        async { Ok::<_, Fail>((vec![1, 2, 3], ())) }
    };
    let (items, ()) = window(20, 45, fetch).await.unwrap();
    assert!(items.is_empty());
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
}

#[test]
fn lyric_uses_shared_rules_and_fixture() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/lyric_lrc_cases.json")).unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let out = media::normalize(
            case["lrc"].as_str().unwrap_or_default(),
            case["trans"].as_str().unwrap_or_default(),
        );
        assert_eq!(out["word_by_word"], false, "{}", case["name"]);
        assert_eq!(out["lines"], case["lines"], "{}", case["name"]);
    }
}
