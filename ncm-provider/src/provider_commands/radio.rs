use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::commands::song_brief;

use super::{current_uid, fetch, invalid, map_arr, string_arg, State};

pub async fn radio_fetch(state: &State, id: u64, args: &Value) -> String {
    if string_arg(args, "kind").ok().as_deref() != Some("ncm_fm") {
        return invalid(id);
    }
    let (_, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let q = Query::new().param("kind", "ncm_fm").cookie(&cookie);
    fetch(
        state.client.personal_fm(&q),
        id,
        |b| json!({ "songs": map_arr(&b["data"], song_brief) }),
    )
    .await
}

pub async fn fm_trash(state: &State, id: u64, args: &Value) -> String {
    let Ok(song_id) = string_arg(args, "id") else {
        return invalid(id);
    };
    let (_, cookie) = match current_uid(state, id).await {
        Ok(v) => v,
        Err(e) => return e,
    };
    let q = Query::new().param("id", &song_id).cookie(&cookie);
    fetch(state.client.fm_trash(&q), id, |_| json!({})).await
}
