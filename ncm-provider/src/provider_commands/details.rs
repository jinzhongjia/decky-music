use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::commands::song_brief;

use super::{fetch, id_string, invalid, map_arr, maybe_cookie, string_arg, State};

pub(super) fn album_brief(v: &Value) -> Value {
    let artist = v["artist"]["name"]
        .as_str()
        .or_else(|| v["artists"].as_array()?.first()?.get("name")?.as_str())
        .unwrap_or("");
    json!({
        "id": id_string(&v["id"]),
        "name": v["name"].as_str().unwrap_or(""),
        "cover": v["picUrl"].as_str().or_else(|| v["cover"].as_str()).unwrap_or(""),
        "artist": artist,
        "count": v["size"].as_i64().or_else(|| v["trackCount"].as_i64()).unwrap_or(0),
    })
}

pub(super) fn artist_brief(v: &Value) -> Value {
    json!({
        "id": id_string(&v["id"]),
        "name": v["name"].as_str().unwrap_or(""),
        "avatar": v["avatar"].as_str()
            .or_else(|| v["avatarUrl"].as_str())
            .or_else(|| v["img1v1Url"].as_str())
            .or_else(|| v["picUrl"].as_str())
            .or_else(|| v["cover"].as_str())
            .unwrap_or(""),
    })
}

pub async fn artist_detail(state: &State, id: u64, args: &Value) -> String {
    let Ok(artist_id) = string_arg(args, "id") else {
        return invalid(id);
    };
    // /artists:歌手信息 + hotSongs 热门 50 首(artist_detail 端点不带歌,详情页会空)
    let q = maybe_cookie(Query::new().param("id", &artist_id), state.cookie().await);
    fetch(state.client.artists(&q), id, |b| {
        json!({
            "artist": artist_brief(&b["artist"]),
            "songs": map_arr(&b["hotSongs"], song_brief),
        })
    })
    .await
}

pub async fn album_detail(state: &State, id: u64, args: &Value) -> String {
    let Ok(album_id) = string_arg(args, "id") else {
        return invalid(id);
    };
    let q = maybe_cookie(Query::new().param("id", &album_id), state.cookie().await);
    fetch(state.client.album(&q), id, |b| {
        json!({
            "album": album_brief(&b["album"]),
            "songs": map_arr(&b["songs"], song_brief),
        })
    })
    .await
}
