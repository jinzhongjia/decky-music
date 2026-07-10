use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::commands::song_brief;
use crate::content::playlist_brief;

use super::{fetch, id_string, invalid, map_arr, maybe_cookie, paged_query, State};

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

fn banner_brief(v: &Value) -> Value {
    let target_id = id_string(&v["targetId"]);
    json!({
        "id": id_string(&v["bannerId"]),
        "title": v["typeTitle"].as_str().or_else(|| v["title"].as_str()).unwrap_or(""),
        "cover": v["pic"].as_str().or_else(|| v["imageUrl"].as_str()).unwrap_or(""),
        "target_type": id_string(&v["targetType"]),
        "target_id": target_id,
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

pub async fn search_hot(state: &State, id: u64) -> String {
    fetch(
        state.client.search_hot_detail(&Query::new()),
        id,
        |b| json!({ "keywords": map_arr(&b["data"], hot_keyword) }),
    )
    .await
}

pub async fn banner(state: &State, id: u64) -> String {
    fetch(
        state.client.banner(&Query::new()),
        id,
        |b| json!({ "banners": map_arr(&b["banners"], banner_brief) }),
    )
    .await
}
