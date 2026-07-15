use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::commands::song_brief;
use crate::content::playlist_brief;

use super::{fetch, invalid, map_arr, maybe_cookie, paged_query, State};

pub(super) fn hot_keyword(v: &Value) -> Value {
    let icon_type = v["iconType"].as_i64().unwrap_or(0);
    let label = match icon_type {
        5 => "new",
        1.. => "hot",
        _ => "none",
    };
    json!({
        "keyword": v["searchWord"].as_str().or_else(|| v["first"].as_str()).unwrap_or(""),
        "label": label,
    })
}

pub async fn search_songs(state: &State, id: u64, args: &Value) -> String {
    let Ok(q) = paged_query(args, "1") else {
        return invalid(id);
    };
    let q = maybe_cookie(q, state.cookie().await);
    fetch(
        state.client.cloudsearch(&q),
        id,
        |b| json!({ "songs": map_arr(&b["result"]["songs"], song_brief) }),
    )
    .await
}

pub async fn search_playlists(state: &State, id: u64, args: &Value) -> String {
    let Ok(q) = paged_query(args, "1000") else {
        return invalid(id);
    };
    let q = maybe_cookie(q, state.cookie().await);
    fetch(
        state.client.cloudsearch(&q),
        id,
        |b| json!({ "playlists": map_arr(&b["result"]["playlists"], playlist_brief) }),
    )
    .await
}

// cloudsearch 的专辑/歌手响应把命中词包进 <em ...> 高亮标记(可带属性;单曲无),
// 按字面渲染很脏。名称里不存在合法 '<',通用剥标签即可。
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..i]);
        match rest[i..].find('>') {
            Some(j) => rest = &rest[i + j + 1..],
            None => {
                out.push_str(&rest[i..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn strip_em(mut brief: Value) -> Value {
    for key in ["name", "artist"] {
        if let Some(s) = brief[key].as_str() {
            brief[key] = Value::String(strip_tags(s));
        }
    }
    brief
}

pub(super) fn album_brief_clean(v: &Value) -> Value {
    strip_em(super::details::album_brief(v))
}

pub(super) fn artist_brief_clean(v: &Value) -> Value {
    strip_em(super::details::artist_brief(v))
}

pub async fn search_albums(state: &State, id: u64, args: &Value) -> String {
    let Ok(q) = paged_query(args, "10") else {
        return invalid(id);
    };
    let q = maybe_cookie(q, state.cookie().await);
    fetch(
        state.client.cloudsearch(&q),
        id,
        |b| json!({ "albums": map_arr(&b["result"]["albums"], album_brief_clean) }),
    )
    .await
}

pub async fn search_artists(state: &State, id: u64, args: &Value) -> String {
    let Ok(q) = paged_query(args, "100") else {
        return invalid(id);
    };
    let q = maybe_cookie(q, state.cookie().await);
    fetch(
        state.client.cloudsearch(&q),
        id,
        |b| json!({ "artists": map_arr(&b["result"]["artists"], artist_brief_clean) }),
    )
    .await
}

pub async fn search_hot(state: &State, id: u64) -> String {
    fetch(
        state.client.search_hot_detail(&Query::new()),
        id,
        |b| json!({ "keywords": map_arr(&b["data"], hot_keyword) }),
    )
    .await
}
