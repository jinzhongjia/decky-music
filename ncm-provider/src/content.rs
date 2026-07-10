//! 内容页数据(P5b):发现页推荐歌单 / 每日推荐 / 歌单曲目。
//! 归一化到共享形状(Playlist / Song,见 src/api.ts);song_brief 复用 commands.rs。

use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::commands::song_brief;
use crate::protocol::{self, ErrorCode};
use crate::provider_commands::{fetch, map_arr};
use crate::state::{with_timeout, State};

/// 发现页:个性化推荐歌单(匿名可用;登录后更个性化)
pub async fn discover(state: &State, id: u64) -> String {
    let mut q = Query::new().param("limit", "12");
    if let Some(c) = state.cookie().await {
        q = q.cookie(&c);
    }
    fetch(
        state.client.personalized(&q),
        id,
        |b| json!({ "playlists": map_arr(&b["result"], playlist_brief) }),
    )
    .await
}

/// 每日推荐 30 首(需登录;无 cookie 直接返 not_logged_in,不打无谓请求)
pub async fn daily_songs(state: &State, id: u64) -> String {
    let Some(c) = state.cookie().await else {
        return protocol::err(id, ErrorCode::NotLoggedIn, "not_logged_in");
    };
    let q = Query::new().cookie(&c);
    match with_timeout(state.client.recommend_songs(&q)).await {
        // 301 = cookie 失效
        Ok(Ok(r)) if r.body["code"].as_i64() == Some(301) => {
            protocol::err(id, ErrorCode::NotLoggedIn, "not_logged_in")
        }
        Ok(Ok(r)) => protocol::ok(
            id,
            json!({ "songs": map_arr(&r.body["data"]["dailySongs"], song_brief) }),
        ),
        Ok(Err(_)) => protocol::err(id, ErrorCode::ProviderError, "provider_error"),
        Err(_) => protocol::err(id, ErrorCode::Timeout, "timeout"),
    }
}

/// 歌单曲目(与 QQ 同名命令,bridge 透传共用)。前 200,分页 P6。
pub async fn playlist_songs(state: &State, id: u64, playlist_id: &str) -> String {
    let mut q = Query::new().param("id", playlist_id).param("limit", "200");
    if let Some(c) = state.cookie().await {
        q = q.cookie(&c);
    }
    fetch(
        state.client.playlist_track_all(&q),
        id,
        |b| json!({ "songs": map_arr(&b["songs"], song_brief) }),
    )
    .await
}

pub(crate) fn playlist_brief(v: &Value) -> Value {
    json!({
        "id": v["id"].as_i64().map(|i| i.to_string()).unwrap_or_default(),
        "name": v["name"].as_str().unwrap_or(""),
        "cover": v["picUrl"].as_str().or_else(|| v["coverImgUrl"].as_str()).unwrap_or(""),
        "count": v["trackCount"].as_i64().unwrap_or(0),
        "play_count": v["playCount"].as_i64().unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playlist_brief_maps_fields() {
        let v = json!({"id": 123, "name": "歌单", "picUrl": "http://p", "playCount": 42});
        assert_eq!(
            playlist_brief(&v),
            json!({"id": "123", "name": "歌单", "cover": "http://p", "count": 0, "play_count": 42})
        );
    }
}
