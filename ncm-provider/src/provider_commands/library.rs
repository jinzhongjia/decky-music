use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::commands::song_brief;
use crate::content::playlist_brief;
use crate::protocol::{self, ErrorCode};
use crate::state::with_timeout;

use super::{
    bool_arg, current_uid, fetch, id_eq, id_string, invalid, map_arr, paging, slice_values,
    string_arg, State,
};

fn cloud_song(v: &Value) -> Value {
    if v["simpleSong"].is_object() {
        song_brief(&v["simpleSong"])
    } else {
        song_brief(v)
    }
}

pub(super) fn user_assets_data(uid: String, sub: &Value, fav_songs: usize) -> Value {
    json!({
        "uid": uid,
        "fav_songs": fav_songs,
        "listen_rank": 0,
        "created_playlists": sub["createdPlaylistCount"].as_i64().unwrap_or(0),
        "fav_playlists": sub["subPlaylistCount"].as_i64().unwrap_or(0),
        "cloud": sub["cloudCount"].as_i64().unwrap_or(0),
    })
}

pub async fn user_assets(state: &State, id: u64) -> String {
    let (uid, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let sub = match with_timeout(state.client.user_subcount(&Query::new().cookie(&cookie))).await {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => return protocol::err(id, ErrorCode::ProviderError, "provider_error"),
        Err(_) => return protocol::err(id, ErrorCode::Timeout, "timeout"),
    };
    let liked = match with_timeout(
        state
            .client
            .likelist(&Query::new().param("uid", &uid).cookie(&cookie)),
    )
    .await
    {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => return protocol::err(id, ErrorCode::ProviderError, "provider_error"),
        Err(_) => return protocol::err(id, ErrorCode::Timeout, "timeout"),
    };
    let fav_songs = liked.body["ids"].as_array().map(|a| a.len()).unwrap_or(0);
    protocol::ok(id, user_assets_data(uid, &sub.body, fav_songs))
}

pub async fn fav_songs(state: &State, id: u64, args: &Value) -> String {
    let Ok((limit, offset)) = paging(args) else {
        return invalid(id);
    };
    let (uid, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let q = Query::new().param("uid", &uid).cookie(&cookie);
    let liked = match with_timeout(state.client.likelist(&q)).await {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => return protocol::err(id, ErrorCode::ProviderError, "provider_error"),
        Err(_) => return protocol::err(id, ErrorCode::Timeout, "timeout"),
    };
    let ids = liked.body["ids"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(id_string)
                .filter(|s| !s.is_empty())
                .skip(offset)
                .take(limit)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if ids.is_empty() {
        return protocol::ok(id, json!({ "songs": [] }));
    }
    let ids = ids.join(",");
    let q = Query::new().param("ids", &ids).cookie(&cookie);
    fetch(
        state.client.song_detail(&q),
        id,
        |b| json!({ "songs": map_arr(&b["songs"], song_brief) }),
    )
    .await
}

pub async fn listen_rank(state: &State, id: u64, args: &Value) -> String {
    let Ok((limit, offset)) = paging(args) else {
        return invalid(id);
    };
    let (uid, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let q = Query::new()
        .param("uid", &uid)
        .param("type", "1")
        .cookie(&cookie);
    fetch(state.client.user_record(&q), id, |b| {
        let list = if b["weekData"].is_array() {
            &b["weekData"]
        } else {
            &b["allData"]
        };
        let songs = list
            .as_array()
            .map(|a| {
                a.iter()
                    .skip(offset)
                    .take(limit)
                    .map(|x| song_brief(&x["song"]))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        json!({ "songs": songs })
    })
    .await
}

async fn user_playlists(state: &State, id: u64) -> Result<(String, Vec<Value>), String> {
    let (uid, cookie) = current_uid(state, id).await?;
    let q = Query::new()
        .param("uid", &uid)
        .param("limit", "1000")
        .cookie(&cookie);
    match with_timeout(state.client.user_playlist(&q)).await {
        Ok(Ok(r)) => Ok((
            uid,
            r.body["playlist"].as_array().cloned().unwrap_or_default(),
        )),
        Ok(Err(_)) => Err(protocol::err(
            id,
            ErrorCode::ProviderError,
            "provider_error",
        )),
        Err(_) => Err(protocol::err(id, ErrorCode::Timeout, "timeout")),
    }
}

pub async fn created_playlists(state: &State, id: u64, args: &Value) -> String {
    let Ok((limit, offset)) = paging(args) else {
        return invalid(id);
    };
    let (uid, lists) = match user_playlists(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let playlists = lists
        .iter()
        .filter(|p| id_eq(&p["creator"]["userId"], &uid))
        .map(playlist_brief)
        .collect::<Vec<_>>();
    protocol::ok(
        id,
        json!({ "playlists": slice_values(playlists, limit, offset) }),
    )
}

pub async fn fav_playlists(state: &State, id: u64, args: &Value) -> String {
    let Ok((limit, offset)) = paging(args) else {
        return invalid(id);
    };
    let (uid, lists) = match user_playlists(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let playlists = lists
        .iter()
        .filter(|p| !id_eq(&p["creator"]["userId"], &uid))
        .map(playlist_brief)
        .collect::<Vec<_>>();
    protocol::ok(
        id,
        json!({ "playlists": slice_values(playlists, limit, offset) }),
    )
}

pub async fn cloud_songs(state: &State, id: u64, args: &Value) -> String {
    let Ok((limit, offset)) = paging(args) else {
        return invalid(id);
    };
    let (_, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let q = Query::new()
        .param("limit", &limit.to_string())
        .param("offset", &offset.to_string())
        .cookie(&cookie);
    fetch(
        state.client.user_cloud(&q),
        id,
        |b| json!({ "songs": map_arr(&b["data"], cloud_song) }),
    )
    .await
}

pub async fn like_song(state: &State, id: u64, args: &Value) -> String {
    let song_id = match string_arg(args, "id") {
        Ok(v) => v,
        Err(_) => return invalid(id),
    };
    let on = match bool_arg(args, "on") {
        Ok(v) => v,
        Err(_) => return invalid(id),
    };
    let (uid, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let q = Query::new()
        .param("id", &song_id)
        .param("uid", &uid)
        .param("like", if on { "true" } else { "false" })
        .cookie(&cookie);
    fetch(state.client.song_like(&q), id, |_| json!({})).await
}

pub async fn add_to_playlist(state: &State, id: u64, args: &Value) -> String {
    let playlist_id = match string_arg(args, "playlist_id") {
        Ok(v) => v,
        Err(_) => return invalid(id),
    };
    let song_id = match string_arg(args, "song_id") {
        Ok(v) => v,
        Err(_) => return invalid(id),
    };
    let (_, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let q = Query::new()
        .param("pid", &playlist_id)
        .param("ids", &song_id)
        .cookie(&cookie);
    fetch(state.client.playlist_track_add(&q), id, |_| json!({})).await
}
