use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::commands::song_brief;

use super::{current_uid, fetch, invalid, map_arr, string_arg, State};

pub async fn radio_fetch(state: &State, id: u64, args: &Value) -> String {
    let kind = match string_arg(args, "kind") {
        Ok(v) if v == "ncm_fm" => v,
        _ => return invalid(id),
    };
    let (_, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let q = Query::new().param("kind", &kind).cookie(&cookie);
    fetch(
        state.client.personal_fm(&q),
        id,
        |b| json!({ "songs": map_arr(&b["data"], song_brief) }),
    )
    .await
}

pub async fn fm_trash(state: &State, id: u64, args: &Value) -> String {
    let song_id = match string_arg(args, "id") {
        Ok(v) => v,
        Err(_) => return invalid(id),
    };
    let (_, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let q = Query::new().param("id", &song_id).cookie(&cookie);
    fetch(state.client.fm_trash(&q), id, |_| json!({})).await
}
