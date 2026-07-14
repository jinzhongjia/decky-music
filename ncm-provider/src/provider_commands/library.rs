use ncm_api_rs::{CryptoType, Query, RequestOption};
use serde_json::{json, Value};

use crate::commands::song_brief;
use crate::content::playlist_brief;
use crate::protocol;

use super::{
    bool_arg, call, current_uid, fetch, id_string, invalid, map_arr, paging, string_arg, State,
};

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
    let sub = match call(
        state.client.user_subcount(&Query::new().cookie(&cookie)),
        id,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => return e,
    };
    let liked_q = Query::new().param("uid", &uid).cookie(&cookie);
    let liked = match call(state.client.likelist(&liked_q), id).await {
        Ok(r) => r,
        Err(e) => return e,
    };
    let fav_songs = liked.body["ids"].as_array().map(|a| a.len()).unwrap_or(0);
    protocol::ok(id, user_assets_data(uid, &sub.body, fav_songs))
}

pub async fn liked_ids(state: &State, id: u64) -> String {
    // 红心种子:likelist 全量 id(bridge 启动/登录后灌 liked_ids,跨会话点亮)
    let (uid, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let q = Query::new().param("uid", &uid).cookie(&cookie);
    fetch(state.client.likelist(&q), id, |b| {
        let ids = b["ids"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(id_string)
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        json!({ "ids": ids })
    })
    .await
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
    let liked = match call(state.client.likelist(&q), id).await {
        Ok(r) => r,
        Err(e) => return e,
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
    let r = call(state.client.user_playlist(&q), id).await?;
    Ok((
        uid,
        r.body["playlist"].as_array().cloned().unwrap_or_default(),
    ))
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
        .filter(|p| id_string(&p["creator"]["userId"]) == uid)
        .skip(offset)
        .take(limit)
        .map(playlist_brief)
        .collect::<Vec<_>>();
    protocol::ok(id, json!({ "playlists": playlists }))
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
        .filter(|p| id_string(&p["creator"]["userId"]) != uid)
        .skip(offset)
        .take(limit)
        .map(playlist_brief)
        .collect::<Vec<_>>();
    protocol::ok(id, json!({ "playlists": playlists }))
}

pub async fn like_song(state: &State, id: u64, args: &Value) -> String {
    let Ok(song_id) = string_arg(args, "id") else {
        return invalid(id);
    };
    let Ok(on) = bool_arg(args, "on") else {
        return invalid(id);
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
    let Ok(playlist_id) = string_arg(args, "playlist_id") else {
        return invalid(id);
    };
    let Ok(song_id) = string_arg(args, "song_id") else {
        return invalid(id);
    };
    let (_, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    // 经典收藏路径 /playlist/manipulate/tracks,按 Node 参考实现走 weapi(绕过库封装:
    // 库的 playlist_tracks 写死 eapi 且该端点 eapi 发送即失败;playlist_track_add 新端点
    // 又返 401 无权限——均真机实测)。歌已存在(502)库层特判为成功,天然幂等。
    let data = json!({
        "op": "add",
        "pid": playlist_id,
        "trackIds": json!([song_id]).to_string(),
        "imme": "true",
    });
    let opt = RequestOption {
        crypto: CryptoType::Weapi,
        cookie: Some(cookie),
        ..Default::default()
    };
    match call(
        state
            .client
            .request("/api/playlist/manipulate/tracks", data, opt),
        id,
    )
    .await
    {
        Ok(_) => protocol::ok(id, json!({})),
        Err(e) => e,
    }
}
