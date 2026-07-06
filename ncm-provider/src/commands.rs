//! 同步命令处理:search / song_url / logout / account(登录长流程在 login.rs)。

use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::logging::log_json;
use crate::state::{with_timeout, Out, State};

// 自造失败返回英文 code,前端 errorText() 负责本地化;库原始错误(e.to_string())原样透传。
const TIMEOUT_CODE: &str = "timeout";
const NO_PLAYABLE_CODE: &str = "no_playable";

pub async fn search(state: &State, keyword: &str) -> String {
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
            json!({ "ok": true, "songs": songs }).to_string()
        }
        Ok(Err(e)) => json!({ "ok": false, "msg": e.to_string() }).to_string(),
        Err(_) => json!({ "ok": false, "msg": TIMEOUT_CODE }).to_string(),
    }
}

fn song_brief(s: &Value) -> Value {
    let singer = s["ar"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x["name"].as_str())
                .collect::<Vec<_>>()
                .join(" / ")
        })
        .unwrap_or_default();
    let fee = s["fee"].as_i64().unwrap_or(0);
    json!({
        "mid": s["id"].as_i64().map(|i| i.to_string()).unwrap_or_default(),
        "name": s["name"].as_str().unwrap_or(""),
        "singer": singer,
        "album": s["al"]["name"].as_str().unwrap_or(""),
        "duration": s["dt"].as_i64().unwrap_or(0) / 1000, // dt 为毫秒 → 秒
        "cover": s["al"]["picUrl"].as_str().unwrap_or(""),
        "vip": fee == 1 || fee == 4, // 1=VIP 4=购买(8=低音质免费,视为非 VIP)
        "media_mid": "",
    })
}

// 音质降级顺序:先试高码率,拿不到(需 VIP/无该档)再降到 standard(128k,免费歌普遍可播)。
const LEVELS: [&str; 2] = ["exhigh", "standard"];

pub async fn song_url(state: &State, id: &str, tx: &Out) -> String {
    let cookie = state.cookie().await;
    for level in LEVELS {
        let mut q = Query::new().param("id", id).param("level", level);
        if let Some(c) = &cookie {
            q = q.cookie(c);
        }
        match with_timeout(state.client.song_url_v1(&q)).await {
            // 不记 URL(含限时 token)
            Ok(Ok(r)) => match r.body["data"][0]["url"].as_str() {
                Some(url) if !url.is_empty() => {
                    return json!({ "ok": true, "url": url }).to_string()
                }
                _ => continue, // 该档无 URL → 降到下一档
            },
            Ok(Err(e)) => return json!({ "ok": false, "msg": e.to_string() }).to_string(),
            Err(_) => return json!({ "ok": false, "msg": TIMEOUT_CODE }).to_string(),
        }
    }
    let _ = tx.send(log_json(
        "warn",
        "song_url",
        &format!("no url id={id} (VIP/无版权)"),
    ));
    json!({ "ok": false, "msg": NO_PLAYABLE_CODE }).to_string()
}

pub async fn logout(state: &State) -> String {
    if let Some(c) = state.cookie().await {
        let _ = with_timeout(state.client.logout(&Query::new().cookie(&c))).await;
        // 尽力而为
    }
    *state.cookie.lock().await = None;
    r#"{"ok":true}"#.to_string()
}

pub async fn account(state: &State) -> String {
    let ck = state.cookie().await;
    let mut q = Query::new();
    if let Some(c) = &ck {
        q = q.cookie(c);
    }
    let status = match with_timeout(state.client.login_status(&q)).await {
        Ok(Ok(r)) => r,
        Ok(Err(e)) => return json!({ "ok": false, "msg": e.to_string() }).to_string(),
        Err(_) => return json!({ "ok": false, "msg": TIMEOUT_CODE }).to_string(),
    };
    let p = &status.body["profile"];
    // VIP 档位 code(前端 vipText() 本地化,不用服务端图标,与 QQ 一致)。vip_info 失败/超时只是不显示,不影响账号。
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
    json!({
        "ok": true,
        "nickname": p["nickname"].as_str().unwrap_or(""),
        "avatar": p["avatarUrl"].as_str().unwrap_or(""),
        "vip": vip,
    })
    .to_string()
}
