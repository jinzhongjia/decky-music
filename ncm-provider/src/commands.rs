//! 同步命令处理:search / song_url / logout / account(登录长流程在 login.rs)。
//! 每个命令返回协议 v1 响应 JSON(带 request id);错误统一走 error code。

use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::logging::log_json;
use crate::protocol::{self, ErrorCode};
use crate::state::{with_timeout, Out, State};

pub async fn search(state: &State, id: u64, keyword: &str) -> String {
    let mut q = Query::new()
        .param("keywords", keyword)
        .param("type", "1")
        .param("limit", "30");
    if let Some(c) = state.cookie().await {
        q = q.cookie(&c);
    }
    match with_timeout(state.client.cloudsearch(&q)).await {
        Ok(Ok(r)) => {
            let songs: Vec<Value> = r.body["result"]["songs"]
                .as_array()
                .map(|arr| arr.iter().map(song_brief).collect())
                .unwrap_or_default();
            protocol::ok(id, json!({ "songs": songs }))
        }
        // 库原始错误不透 UI(协议 v1);search 无 out 通道,不落日志(与改造前一致)
        Ok(Err(_)) => protocol::err(id, ErrorCode::ProviderError, "provider_error"),
        Err(_) => protocol::err(id, ErrorCode::Timeout, "timeout"),
    }
}

pub(crate) fn song_brief(s: &Value) -> Value {
    let artists = s["ar"].as_array().or_else(|| s["artists"].as_array());
    let singer = artists
        .map(|a| {
            a.iter()
                .filter_map(|x| x["name"].as_str())
                .collect::<Vec<_>>()
                .join(" / ")
        })
        .unwrap_or_default();
    let album = if s["al"].is_object() {
        &s["al"]
    } else {
        &s["album"]
    };
    let fee = s["fee"].as_i64().unwrap_or(0);
    json!({
        "mid": s["id"].as_i64().map(|i| i.to_string()).unwrap_or_default(),
        "name": s["name"].as_str().unwrap_or(""),
        "singer": singer,
        "album": album["name"].as_str().unwrap_or(""),
        "duration": s["dt"].as_i64().or_else(|| s["duration"].as_i64()).unwrap_or(0) / 1000,
        "cover": album["picUrl"].as_str().unwrap_or(""),
        "vip": fee == 1 || fee == 4,
        "media_mid": "",
    })
}

// 音质降级顺序:先试高码率,拿不到(需 VIP/无该档)再降到 standard(128k,免费歌普遍可播)。
const LEVELS: [&str; 2] = ["exhigh", "standard"];

pub async fn song_url(state: &State, id: u64, song_id: &str, tx: &Out) -> String {
    let cookie = state.cookie().await;
    for level in LEVELS {
        let mut q = Query::new().param("id", song_id).param("level", level);
        if let Some(c) = &cookie {
            q = q.cookie(c);
        }
        match with_timeout(state.client.song_url_v1(&q)).await {
            // 不记 URL(含限时 token)
            Ok(Ok(r)) => match r.body["data"][0]["url"].as_str() {
                Some(url) if !url.is_empty() => return protocol::ok(id, json!({ "url": url })),
                _ => continue, // 该档无 URL → 降到下一档
            },
            Ok(Err(_)) => return protocol::err(id, ErrorCode::ProviderError, "provider_error"),
            Err(_) => return protocol::err(id, ErrorCode::Timeout, "timeout"),
        }
    }
    let _ = tx.send(log_json(
        "warn",
        "song_url",
        &format!("no url id={song_id} (VIP/无版权)"),
    ));
    protocol::err(id, ErrorCode::NoPlayable, "no_playable")
}

pub async fn logout(state: &State, id: u64) -> String {
    if let Some(c) = state.cookie().await {
        let _ = with_timeout(state.client.logout(&Query::new().cookie(&c))).await;
        // 尽力而为
    }
    *state.cookie.lock().await = None;
    protocol::ok_empty(id)
}

pub async fn account(state: &State, id: u64) -> String {
    let ck = state.cookie().await;
    let mut q = Query::new();
    if let Some(c) = &ck {
        q = q.cookie(c);
    }
    let status = match with_timeout(state.client.login_status(&q)).await {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => return protocol::err(id, ErrorCode::ProviderError, "provider_error"),
        Err(_) => return protocol::err(id, ErrorCode::Timeout, "timeout"),
    };
    let p = &status.body["profile"];
    // VIP 档位 code(前端 vipText() 本地化,不用服务端图标)。vip_info 失败/超时只是不显示,不影响账号。
    let mut vip = String::new();
    let mut vq = Query::new();
    if let Some(c) = &ck {
        vq = vq.cookie(c);
    }
    if let Ok(Ok(v)) = with_timeout(state.client.vip_info(&vq)).await {
        let d = &v.body["data"];
        if d["redVipLevel"].as_i64().unwrap_or(0) > 0 {
            let annual = d["redVipAnnualCount"].as_i64().unwrap_or(0) > 0;
            vip = if annual { "ncm_annual" } else { "ncm" }.to_string();
        }
    }
    protocol::ok(
        id,
        json!({
            "nickname": p["nickname"].as_str().unwrap_or(""),
            "avatar": p["avatarUrl"].as_str().unwrap_or(""),
            "vip": vip,
        }),
    )
}
