//! Provider command handlers for NCM. Boundary parsing stays here so bad args
//! return invalid_request before any upstream call.

use std::future::Future;

use ncm_api_rs::{ApiResponse, NcmError, Query};
use serde_json::Value;

use crate::protocol::{self, ErrorCode};
use crate::state::{with_timeout, State};

mod comments;
mod details;
mod library;
mod radio;
mod search;

pub use comments::{comment_like, comments};
pub use details::{album_detail, artist_detail};
pub use library::{
    add_to_playlist, cloud_songs, created_playlists, fav_playlists, fav_songs, like_song,
    listen_rank, user_assets,
};
pub use radio::{fm_trash, radio_fetch};
pub use search::{banner, search_albums, search_artists, search_hot, search_playlists, search_songs};

const DEFAULT_LIMIT: i64 = 30;
const DEFAULT_OFFSET: i64 = 0;
const MAX_LIMIT: i64 = 50;

/// 上游调用统一三态:成功给响应,库错误 → provider_error,超时 → timeout。
/// Err 即协议错误响应串,String 返回的命令 match 后直接 return,Result 命令用 `?`。
pub(crate) async fn call<F: Future<Output = Result<ApiResponse, NcmError>>>(
    fut: F,
    id: u64,
) -> Result<ApiResponse, String> {
    match with_timeout(fut).await {
        Ok(Ok(r)) => Ok(r),
        // message 携带上游错误简述(业务码+msg,无凭证)供 bridge 落日志诊断;UI 仍按 code 本地化
        Ok(Err(e)) => Err(protocol::err(
            id,
            ErrorCode::ProviderError,
            &format!("provider_error: {e}"),
        )),
        Err(_) => Err(protocol::err(id, ErrorCode::Timeout, "timeout")),
    }
}

pub(crate) async fn fetch<F: Future<Output = Result<ApiResponse, NcmError>>>(
    fut: F,
    id: u64,
    pick: impl FnOnce(&Value) -> Value,
) -> String {
    match call(fut, id).await {
        Ok(r) => protocol::ok(id, pick(&r.body)),
        Err(e) => e,
    }
}

fn invalid(id: u64) -> String {
    protocol::err(id, ErrorCode::InvalidRequest, "invalid_request")
}

fn string_arg(args: &Value, name: &str) -> Result<String, ()> {
    args.get(name)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or(())
}

fn bool_arg(args: &Value, name: &str) -> Result<bool, ()> {
    args.get(name).and_then(Value::as_bool).ok_or(())
}

fn optional_i64(args: &Value, name: &str, default: i64) -> Result<i64, ()> {
    match args.get(name) {
        Some(v) => v.as_i64().filter(|n| *n >= 0).ok_or(()),
        None => Ok(default),
    }
}

fn optional_limit(args: &Value, default: i64) -> Result<i64, ()> {
    match args.get("limit") {
        Some(v) => v
            .as_i64()
            .filter(|n| *n > 0)
            .map(|n| n.min(MAX_LIMIT))
            .ok_or(()),
        None => Ok(default.min(MAX_LIMIT)),
    }
}

fn paging(args: &Value) -> Result<(usize, usize), ()> {
    let limit = optional_limit(args, DEFAULT_LIMIT)? as usize;
    let offset = optional_i64(args, "offset", DEFAULT_OFFSET)? as usize;
    Ok((limit, offset))
}

fn optional_string(args: &Value, name: &str, default: &str) -> Result<String, ()> {
    match args.get(name) {
        Some(v) => v
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .ok_or(()),
        None => Ok(default.to_string()),
    }
}

fn paged_query(args: &Value, type_id: &str) -> Result<Query, ()> {
    let keyword = string_arg(args, "keyword")?;
    let limit = optional_limit(args, DEFAULT_LIMIT)?.to_string();
    let offset = optional_i64(args, "offset", DEFAULT_OFFSET)?.to_string();
    Ok(Query::new()
        .param("keywords", &keyword)
        .param("type", type_id)
        .param("limit", &limit)
        .param("offset", &offset))
}

fn maybe_cookie(mut q: Query, cookie: Option<String>) -> Query {
    if let Some(c) = cookie {
        q = q.cookie(&c);
    }
    q
}

async fn current_uid(state: &State, id: u64) -> Result<(String, String), String> {
    let Some(cookie) = state.cookie().await else {
        return Err(protocol::err(id, ErrorCode::NotLoggedIn, "not_logged_in"));
    };
    // uid 按会话缓存(set_credential 时清空):免去每个资产/电台命令先打一发 login_status
    if let Some(uid) = state.uid.lock().await.clone() {
        return Ok((uid, cookie));
    }
    let status = call(state.client.login_status(&Query::new().cookie(&cookie)), id).await?;
    let uid = id_string(&status.body["profile"]["userId"]);
    if uid.is_empty() {
        return Err(protocol::err(id, ErrorCode::NotLoggedIn, "not_logged_in"));
    }
    *state.uid.lock().await = Some(uid.clone());
    Ok((uid, cookie))
}

fn id_string(v: &Value) -> String {
    v.as_i64()
        .map(|i| i.to_string())
        .or_else(|| v.as_str().filter(|s| !s.is_empty()).map(str::to_owned))
        .unwrap_or_default()
}

pub(crate) fn map_arr(v: &Value, f: fn(&Value) -> Value) -> Vec<Value> {
    v.as_array()
        .map(|a| a.iter().map(f).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn search_args_require_keyword_and_numeric_paging() {
        assert!(paged_query(&json!({}), "1").is_err());
        assert!(paged_query(&json!({"keyword":"x","limit":"30"}), "1").is_err());
        assert!(paged_query(&json!({"keyword":"x","offset":-1}), "1").is_err());
        let q = paged_query(&json!({"keyword":"x","limit":2,"offset":3}), "1000").unwrap();
        assert_eq!(q.get_or("keywords", ""), "x");
        assert_eq!(q.get_or("type", ""), "1000");
        assert_eq!(q.get_or("limit", ""), "2");
        assert_eq!(q.get_or("offset", ""), "3");
    }

    #[test]
    fn list_paging_is_numeric_positive_and_clamped() {
        assert!(paging(&json!({"limit":"30"})).is_err());
        assert!(paging(&json!({"limit":0})).is_err());
        assert!(paging(&json!({"offset":-1})).is_err());
        assert_eq!(paging(&json!({"limit":99,"offset":3})).unwrap(), (50, 3));
    }

    #[test]
    fn action_args_require_bool_not_truthy_string() {
        assert_eq!(string_arg(&json!({"id":"7"}), "id").unwrap(), "7");
        assert!(string_arg(&json!({"id":""}), "id").is_err());
        assert!(bool_arg(&json!({"on":"true"}), "on").is_err());
        assert_eq!(bool_arg(&json!({"on":true}), "on").unwrap(), true);
    }

    #[test]
    fn mappers_normalize_shared_shapes() {
        let song = crate::commands::song_brief(&json!({
            "id": 1,
            "name": "s",
            "artists": [{"name":"a"}],
            "album": {"name":"al", "picUrl":"p"},
            "duration": 32000,
            "fee": 4
        }));
        assert_eq!(
            song,
            json!({
                "mid":"1", "name":"s", "singer":"a", "album":"al", "duration":32,
                "cover":"p", "vip":true, "media_mid":""
            })
        );

        assert_eq!(
            details::album_brief(
                &json!({"id":2,"name":"al","picUrl":"p","artist":{"name":"ar"},"size":9})
            ),
            json!({"id":"2","name":"al","cover":"p","artist":"ar","count":9})
        );
        assert_eq!(
            details::artist_brief(&json!({"id":3,"name":"ar","img1v1Url":"a"})),
            json!({"id":"3","name":"ar","avatar":"a"})
        );
        assert_eq!(
            comments::comment_brief(
                &json!({"commentId":4,"user":{"nickname":"u","avatarUrl":"av"},"content":"c","likedCount":5,"time":6})
            ),
            json!({"id":"4","user":"u","avatar":"av","content":"c","likes":5,"time":"6"})
        );
        assert_eq!(
            search::hot_keyword(&json!({"searchWord":"k","iconType":1})),
            json!({"keyword":"k","label":"hot"})
        );
        assert_eq!(
            search::hot_keyword(&json!({"searchWord":"k","iconType":5})),
            json!({"keyword":"k","label":"new"})
        );
        assert_eq!(
            search::hot_keyword(&json!({"searchWord":"k"})),
            json!({"keyword":"k","label":"none"})
        );
        // 搜索专辑/歌手命中高亮 <em>(可带属性)剥除
        assert_eq!(
            search::album_brief_clean(&json!({
                "id":5,"name":"<em class=\"s-fc7\">海</em>屿你","picUrl":"p",
                "artist":{"name":"<em>白</em>允"},"size":1
            })),
            json!({"id":"5","name":"海屿你","cover":"p","artist":"白允","count":1})
        );
        assert_eq!(
            library::user_assets_data(
                "42".to_string(),
                &json!({"createdPlaylistCount":2,"subPlaylistCount":3,"cloudCount":4}),
                9
            ),
            json!({"uid":"42","fav_songs":9,"listen_rank":0,"created_playlists":2,"fav_playlists":3,"cloud":4})
        );
    }

    #[test]
    fn invalid_request_shape_is_stable() {
        let v: Value = serde_json::from_str(&invalid(9)).unwrap();
        assert_eq!(
            v,
            json!({"id":9,"ok":false,"error":{"code":"invalid_request","message":"invalid_request"}})
        );
    }
}
