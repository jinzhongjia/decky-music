use super::*;
use std::cell::Cell;

struct FakeUpstream {
    lists: Vec<Value>,
    // 网易云第一页在 WINDOW 之外额外附带的「我喜欢的音乐」(不占偏移)
    liked: Option<Value>,
    requests: Cell<usize>,
    bytes: Cell<usize>,
}

impl FakeUpstream {
    fn new(count: usize) -> Self {
        Self {
            lists: (0..count)
                .map(|id| {
                    json!({
                        "id": id, "name": format!("playlist {id}"), "trackCount": id % 31,
                        "creator": { "userId": if id % 3 == 0 { 42 } else { 7 } },
                        "coverImgUrl": "https://synthetic.invalid/cover", "playCount": id,
                    })
                })
                .collect(),
            liked: None,
            requests: Cell::new(0),
            bytes: Cell::new(0),
        }
    }

    fn with_liked(count: usize) -> Self {
        let liked = json!({
            "id": 1_000_000, "name": "liked", "specialType": LIKED_SPECIAL_TYPE,
            "creator": { "userId": 42 }, "trackCount": 2906, "playCount": 0,
        });
        Self {
            liked: Some(liked),
            ..Self::new(count)
        }
    }

    async fn fetch(&self, offset: usize) -> Result<Window, String> {
        tokio::task::yield_now().await;
        let end = (offset + WINDOW).min(self.lists.len());
        let extra = self.liked.iter().filter(|_| offset == 0);
        let page: Vec<&Value> = extra.chain(&self.lists[offset.min(end)..end]).collect();
        let body = json!({ "playlist": page, "more": end < self.lists.len() });
        self.requests.set(self.requests.get() + 1);
        self.bytes
            .set(self.bytes.get() + serde_json::to_vec(&body).unwrap().len());
        Window::from_body(&body, "42").map_err(|_| "provider_error".to_owned())
    }

    fn expected(&self, created: bool, offset: usize, limit: usize) -> Vec<Value> {
        self.liked
            .iter()
            .chain(&self.lists)
            .filter(|p| (p["creator"]["userId"] == 42) == created)
            .skip(offset)
            .take(limit)
            .map(playlist_brief)
            .collect()
    }
}

#[tokio::test]
async fn classified_offsets_reuse_windows_and_enumerate_beyond_one_thousand() {
    let upstream = FakeUpstream::new(1257);
    let mut cache = PlaylistCache::default();
    let started = std::time::Instant::now();
    for offset in [0, 50, 100] {
        let result = cache
            .page(true, offset, 50, |at| upstream.fetch(at))
            .await
            .unwrap();
        assert_eq!(result, upstream.expected(true, offset, 50));
    }
    let local_paging_us = started.elapsed().as_micros();
    assert_eq!(upstream.requests.get(), 5);
    let metrics = (upstream.requests.get(), upstream.bytes.get());
    for (created, offset) in [
        (false, 0),
        (false, 100),
        (true, 400),
        (false, 800),
        (true, 419),
        (false, 900),
        (true, 17),
    ] {
        assert_eq!(
            cache
                .page(created, offset, 50, |at| upstream.fetch(at))
                .await
                .unwrap(),
            upstream.expected(created, offset, 50)
        );
    }
    assert_eq!(upstream.requests.get(), 13);
    let legacy_bytes: usize = (0..3)
        .map(|_| {
            serde_json::to_vec(&json!({
                "playlist": &upstream.lists[..1000], "more": true,
            }))
            .unwrap()
            .len()
        })
        .sum();
    println!("synthetic 1257 mixed playlists, created offsets 0/50/100: window_requests={} window_bytes={} repeated_1000_requests=3 repeated_1000_bytes={legacy_bytes} local_paging_us={local_paging_us} (no upstream network latency modeled)", metrics.0, metrics.1);
}

#[tokio::test]
async fn ttl_account_login_and_mutation_invalidate_observable_pages() {
    let mut upstream = FakeUpstream::new(203);
    let state = State::new(None);
    state.replace_credential(Some("synthetic".into()), None);
    let mut cache = PlaylistCache::default();
    let mut now = Instant::now();
    for transition in 0..7 {
        match transition {
            1 => now += TTL,
            2 => {
                state.replace_credential(Some("synthetic_other".into()), None);
            }
            3 => {
                state.replace_credential(None, None);
            }
            4 => {
                state.replace_credential(Some("synthetic_login".into()), None);
            }
            5 | 6 => {
                let _mutation = state.library_mutation();
            }
            _ => {}
        }
        upstream.lists[0]["name"] = json!(format!("revision {transition}"));
        cache.prepare(
            &state.session(),
            state.library_revision.load(Ordering::Relaxed),
            "42",
            now,
        );
        let result = cache
            .page(true, 0, 1, |at| upstream.fetch(at))
            .await
            .unwrap();
        assert_eq!(result[0]["name"], format!("revision {transition}"));
        assert_eq!(upstream.requests.get(), transition + 1);
    }
}

#[tokio::test]
async fn capacity_eviction_keeps_large_offsets_and_reverse_navigation_correct() {
    let upstream = FakeUpstream::new(10003);
    let mut cache = PlaylistCache::default();
    for (created, offset) in [(true, 3200), (false, 6600), (true, 0), (false, 19)] {
        assert_eq!(
            cache
                .page(created, offset, 50, |at| upstream.fetch(at))
                .await
                .unwrap(),
            upstream.expected(created, offset, 50)
        );
        assert!(cache.windows.len() <= MAX_WINDOWS);
        assert!(cache.bytes <= MAX_BYTES);
    }
}

#[tokio::test]
async fn oversized_metadata_is_returned_but_not_retained() {
    let mut upstream = FakeUpstream::new(1);
    upstream.lists[0]["name"] = json!("x".repeat(MAX_BYTES + 1));
    let mut cache = PlaylistCache::default();
    for _ in 0..2 {
        assert_eq!(
            cache
                .page(true, 0, 1, |at| upstream.fetch(at))
                .await
                .unwrap(),
            upstream.expected(true, 0, 1)
        );
    }
    assert_eq!(upstream.requests.get(), 2);
    assert!(cache.windows.is_empty());
}

#[tokio::test]
async fn canceled_mutation_invalidates_pages_fetched_during_mutation() {
    let state = State::new(None);
    let mut upstream = FakeUpstream::new(1);
    let mut cache = PlaylistCache::default();
    let mutation = state.library_mutation();
    cache.prepare(
        &state.session(),
        state.library_revision.load(Ordering::Relaxed),
        "42",
        Instant::now(),
    );
    cache
        .page(true, 0, 1, |at| upstream.fetch(at))
        .await
        .unwrap();
    drop(mutation);
    upstream.lists[0]["name"] = json!("after cancellation");
    cache.prepare(
        &state.session(),
        state.library_revision.load(Ordering::Relaxed),
        "42",
        Instant::now(),
    );
    assert_eq!(
        cache
            .page(true, 0, 1, |at| upstream.fetch(at))
            .await
            .unwrap()[0]["name"],
        "after cancellation"
    );
    assert_eq!(upstream.requests.get(), 2);
}

#[tokio::test]
async fn concurrent_classified_requests_share_the_same_windows() {
    let upstream = FakeUpstream::new(203);
    let cache = tokio::sync::Mutex::new(PlaylistCache::default());
    let request = |created| {
        let (cache, upstream) = (&cache, &upstream);
        async move {
            cache
                .lock()
                .await
                .page(created, 0, 30, |at| upstream.fetch(at))
                .await
                .unwrap()
        }
    };
    let (created, favorite) = tokio::join!(request(true), request(false));
    assert_eq!(created, upstream.expected(true, 0, 30));
    assert_eq!(favorite, upstream.expected(false, 0, 30));
    assert_eq!(upstream.requests.get(), 1);
}

/// 歌单满一窗口的账号:第一页是「我喜欢的音乐」+ WINDOW 条普通歌单(实测 101 条),
/// 它归入自建,翻页不重复也不遗漏(修复前整页判为异常，自建 / 收藏都报「音乐源出错」)。
#[tokio::test]
async fn extra_liked_playlist_on_the_first_page_keeps_paging_aligned() {
    let upstream = FakeUpstream::with_liked(257);
    let mut cache = PlaylistCache::default();
    for (created, offset) in [(true, 0), (true, 50), (false, 0), (false, 100), (true, 80)] {
        assert_eq!(
            cache
                .page(created, offset, 50, |at| upstream.fetch(at))
                .await
                .unwrap(),
            upstream.expected(created, offset, 50)
        );
    }
    let first = cache.page(true, 0, 1, |at| upstream.fetch(at)).await;
    assert_eq!(first.unwrap()[0]["name"], "liked");
    assert_eq!(upstream.requests.get(), 3);
}

#[test]
fn only_more_regular_playlists_than_a_window_is_an_invalid_page() {
    let regular = |id: usize| json!({ "id": id, "creator": { "userId": 42 } });
    let liked = json!({ "id": 0, "specialType": LIKED_SPECIAL_TYPE, "creator": { "userId": 42 } });
    let with_liked: Vec<Value> = std::iter::once(liked)
        .chain((1..=WINDOW).map(regular))
        .collect();
    assert!(Window::from_body(&json!({ "playlist": with_liked, "more": true }), "42").is_ok());
    let overflow: Vec<Value> = (1..=WINDOW + 1).map(regular).collect();
    assert!(Window::from_body(&json!({ "playlist": overflow, "more": true }), "42").is_err());
}
