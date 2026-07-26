//! 同步命令处理:song_url / logout / account(登录长流程在 login.rs;搜索在 provider_commands)。
//! 每个命令返回协议 v1 响应 JSON(带 request id);错误统一走 error code。

use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::protocol::{self, ErrorCode};
use crate::protocol::{log_json, LogLevel};
use crate::provider_commands::{call, maybe_cookie};
use crate::state::{with_timeout, Out, State};

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

/// 音质阶梯:(档位名, 网易 level),从高到低。
/// 只列 player 解得动的:lossless/exhigh/standard 分别是 FLAC / 320k MP3 / 128k MP3。
/// 不上 hires/jymaster(母带)—— 多数账号拿不到,白赔一次往返;也不上 sky(环绕声,要 immerseType)。
const LADDER: [(&str, &str); 3] = [
    ("lossless", "lossless"),
    ("high", "exhigh"),
    ("standard", "standard"),
];
pub const DEFAULT_QUALITY: &str = "high";

/// 从所选上限往下的阶梯。上限之上的档不试;下面的档全部保留作兜底 ——
/// 选了无损也必须能播无版权 / 非会员的歌,否则一开就有一半歌放不出来。
fn ladder(quality: &str) -> &'static [(&'static str, &'static str)] {
    let at = LADDER
        .iter()
        .position(|(name, _)| *name == quality)
        .unwrap_or_else(|| {
            LADDER
                .iter()
                .position(|(name, _)| *name == DEFAULT_QUALITY)
                .unwrap_or(0)
        });
    &LADDER[at..]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(q: &str) -> Vec<&'static str> {
        ladder(q).iter().map(|(n, _)| *n).collect()
    }

    /// 选的是上限:上限之上的档不试,下面的档全保留作兜底。
    /// 末端必须是 standard —— 否则该档会有无版权/非会员的歌直接放不出来。
    #[test]
    fn ladder_is_a_cap_with_full_fallback() {
        assert_eq!(names("standard"), ["standard"]);
        assert_eq!(names("high"), ["high", "standard"]);
        assert_eq!(names("lossless"), ["lossless", "high", "standard"]);
        for (q, _) in LADDER {
            assert_eq!(names(q).last(), Some(&"standard"), "quality={q}");
        }
    }

    #[test]
    fn bad_value_falls_back_to_default() {
        for bad in ["", "hires", "jymaster", "sky", "EXHIGH"] {
            assert_eq!(names(bad), names(DEFAULT_QUALITY), "bad={bad}");
        }
    }
}

pub async fn song_url(state: &State, id: u64, song_id: &str, quality: &str, tx: &Out) -> String {
    let base = maybe_cookie(Query::new().param("id", song_id), state.cookie().await);
    for (name, level) in ladder(quality) {
        let q = base.clone().param("level", level);
        match with_timeout(state.client.song_url_v1(&q)).await {
            // 不记 URL(含限时 token)
            Ok(Ok(r)) => match r.body["data"][0]["url"].as_str() {
                Some(url) if !url.is_empty() => {
                    // 记下实际命中的档位:选了无损却降到 320k 时,没这条谁都查不出来
                    let _ = tx.send(log_json(
                        LogLevel::Debug,
                        "song_url",
                        &format!("id={song_id} want={quality} got={name}"),
                    ));
                    return protocol::ok(id, json!({ "url": url, "quality": name }));
                }
                _ => continue, // 该档无 URL → 降到下一档
            },
            Ok(Err(_)) => return protocol::err(id, ErrorCode::ProviderError, "provider_error"),
            Err(_) => return protocol::err(id, ErrorCode::UpstreamTimeout, "upstream_timeout"),
        }
    }
    let _ = tx.send(log_json(
        LogLevel::Warn,
        "song_url",
        &format!("no url id={song_id} (VIP/无版权)"),
    ));
    protocol::err(id, ErrorCode::NoPlayable, "no_playable")
}

pub async fn logout(state: &State, id: u64) -> String {
    if state.credential().await.is_some() {
        let q = maybe_cookie(Query::new(), state.cookie().await);
        let _ = with_timeout(state.client.logout(&q)).await; // 尽力而为
    }
    *state.cookie.lock().await = None;
    protocol::ok_empty(id)
}

pub async fn account(state: &State, id: u64) -> String {
    let ck = state.cookie().await;
    let q = maybe_cookie(Query::new(), ck.clone());
    let status = match call(state.client.login_status(&q), id).await {
        Ok(r) => r,
        Err(e) => return e,
    };
    let p = &status.body["profile"];
    // VIP 档位 code(前端 vipText() 本地化,不用服务端图标)。vip_info 失败/超时只是不显示,不影响账号。
    let mut vip = String::new();
    let vq = maybe_cookie(Query::new(), ck);
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
