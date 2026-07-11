use ncm_api_rs::Query;
use serde_json::{json, Value};

use super::{
    bool_arg, current_uid, fetch, id_string, invalid, map_arr, maybe_cookie, optional_i64,
    optional_string, string_arg, State,
};

pub(super) fn comment_brief(v: &Value) -> Value {
    json!({
        "id": id_string(&v["commentId"]),
        "user": v["user"]["nickname"].as_str().unwrap_or(""),
        "avatar": v["user"]["avatarUrl"].as_str().unwrap_or(""),
        "content": v["content"].as_str().unwrap_or(""),
        "likes": v["likedCount"].as_i64().unwrap_or(0),
        "time": id_string(&v["time"]),
    })
}

pub async fn comments(state: &State, id: u64, args: &Value) -> String {
    let Ok(resource_id) = string_arg(args, "id") else {
        return invalid(id);
    };
    let Ok(typ) = optional_string(args, "type", "0") else {
        return invalid(id);
    };
    let Ok(limit) = optional_i64(args, "limit", 20).map(|v| v.to_string()) else {
        return invalid(id);
    };
    let Ok(offset) = optional_i64(args, "offset", 0).map(|v| v.to_string()) else {
        return invalid(id);
    };
    let q = maybe_cookie(
        Query::new()
            .param("id", &resource_id)
            .param("limit", &limit)
            .param("offset", &offset),
        state.cookie().await,
    );
    let pick = |b: &Value| {
        let list = if b["comments"].is_array() {
            &b["comments"]
        } else {
            &b["hotComments"]
        };
        json!({ "comments": map_arr(list, comment_brief) })
    };
    match typ.as_str() {
        "0" | "song" | "music" => fetch(state.client.comment_music(&q), id, pick).await,
        "2" | "playlist" => fetch(state.client.comment_playlist(&q), id, pick).await,
        "3" | "album" => fetch(state.client.comment_album(&q), id, pick).await,
        _ => invalid(id),
    }
}

pub async fn comment_like(state: &State, id: u64, args: &Value) -> String {
    let Ok(resource_id) = string_arg(args, "id") else {
        return invalid(id);
    };
    let Ok(comment_id) = string_arg(args, "comment_id") else {
        return invalid(id);
    };
    let Ok(on) = bool_arg(args, "on") else {
        return invalid(id);
    };
    let Ok(typ) = optional_string(args, "type", "0") else {
        return invalid(id);
    };
    let (_, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let q = Query::new()
        .param("id", &resource_id)
        .param("cid", &comment_id)
        .param("type", &typ)
        .param("t", if on { "1" } else { "0" })
        .cookie(&cookie);
    fetch(state.client.comment_like(&q), id, |_| json!({})).await
}
