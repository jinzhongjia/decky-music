//! 同步命令处理:song_url / logout / account(登录长流程在 login.rs;搜索在 provider_commands)。
//! 每个命令返回协议 v1 响应 JSON(带 request id);错误统一走 error code。

use std::collections::HashMap;

use ncm_api_rs::Query;
use serde_json::{json, Value};

use crate::ncm::protocol::{self, ErrorCode};
use crate::ncm::protocol::{log_json, LogLevel};
use crate::ncm::provider_commands::{call, maybe_cookie};
use crate::ncm::state::{with_timeout, Out, State};

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
        "max_quality": max_quality(&s["privilege"]),
    })
}

/// 歌单 / 歌曲详情把 privilege 放在与 songs 平行的 `privileges` 数组里:按 id 并回各首歌,
/// 否则这两类列表拿不到可播档位(搜索、专辑、歌手、日推、FM、排行则内嵌在歌曲对象里)。
pub(crate) fn song_briefs(body: &Value) -> Vec<Value> {
    let privileges: HashMap<i64, &Value> = body["privileges"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| Some((p["id"].as_i64()?, p)))
        .collect();
    let songs = body["songs"].as_array().into_iter().flatten();
    songs
        .map(|s| {
            let mut brief = song_brief(s);
            if brief["max_quality"] == "" {
                if let Some(p) = s["id"].as_i64().and_then(|id| privileges.get(&id)) {
                    brief["max_quality"] = json!(max_quality(p));
                }
            }
            brief
        })
        .collect()
}

/// 网易云 level → 共享档位。服务端从低到高:standard < higher < exhigh < lossless < hires < jyeffect
/// < sky < dolby < jymaster;player 只放到 FLAC,lossless 及以上都算 lossless。none = 这个账号放不了。
pub(crate) fn tier_of_level(level: &str) -> Option<&'static str> {
    match level {
        "none" => Some("none"),
        "standard" | "higher" => Some("standard"),
        "exhigh" => Some("high"),
        "lossless" | "hires" | "jyeffect" | "sky" | "dolby" | "jymaster" => Some("lossless"),
        _ => None, // 以后新增的档位按未知处理,不猜
    }
}

/// 列表元数据里这首歌的可播档位(privilege.plLevel,按拉列表时的账号算);缺失给空串 = 未知。
fn max_quality(privilege: &Value) -> &'static str {
    privilege["plLevel"]
        .as_str()
        .and_then(tier_of_level)
        .unwrap_or("")
}

/// 首档没拿到 URL 后要不要往下试。服务端在一次请求里已降到账号能放的最高档,所以元数据说放不了
/// (none)就到此为止;未知或与元数据不符(如换了账号)时才逐档兜底。
fn keeps_trying_lower(hint: &str) -> bool {
    hint != "none"
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

/// 从所选上限往下的阶梯。上限之上的档不试;下面的档保留作兜底(见 keeps_trying_lower)。
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

/// 按上限请求一次 song_url_v1:服务端会在同一次请求里降到账号能放的最高档,返回的 level 才是实际档位。
/// hint 为列表元数据给的可播档位(见 song_brief),只决定拿不到 URL 时还要不要往下试。
pub async fn song_url(
    state: &State,
    id: u64,
    song_id: &str,
    quality: &str,
    hint: &str,
    tx: &Out,
) -> String {
    let base = maybe_cookie(Query::new().param("id", song_id), state.cookie().await);
    for (name, level) in ladder(quality) {
        let q = base.clone().param("level", level);
        match with_timeout(state.client.song_url_v1(&q)).await {
            // 不记 URL(含限时 token)
            Ok(Ok(r)) => match r.body["data"][0]["url"].as_str() {
                Some(url) if !url.is_empty() => {
                    let got = r.body["data"][0]["level"]
                        .as_str()
                        .and_then(tier_of_level)
                        .filter(|t| *t != "none")
                        .unwrap_or(*name);
                    let _ = tx.send(log_json(
                        LogLevel::Debug,
                        "song_url",
                        &format!("resolved quality={got}"),
                    ));
                    return protocol::ok(id, json!({ "url": url, "quality": got }));
                }
                _ if keeps_trying_lower(hint) => continue, // 该档无 URL → 降到下一档
                _ => break,
            },
            Ok(Err(_)) => return protocol::err(id, ErrorCode::ProviderError, "provider_error"),
            Err(_) => return protocol::err(id, ErrorCode::UpstreamTimeout, "upstream_timeout"),
        }
    }
    let _ = tx.send(log_json(LogLevel::Warn, "song_url", "no playable quality"));
    protocol::err(id, ErrorCode::NoPlayable, "no_playable")
}

pub async fn logout(state: &State, id: u64) -> String {
    let session = state.session();
    let cookie = state.cookie().await;
    if !state.replace_credential(None, Some(&session)) {
        return protocol::err(id, ErrorCode::Superseded, "superseded");
    }
    if session.credential.is_some() {
        let q = maybe_cookie(Query::new(), cookie);
        let _ = with_timeout(state.client.logout(&q)).await;
    }
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

    #[test]
    fn levels_map_to_shared_tiers() {
        for (level, tier) in [
            ("none", Some("none")),
            ("standard", Some("standard")),
            ("higher", Some("standard")),
            ("exhigh", Some("high")),
            ("lossless", Some("lossless")),
            ("hires", Some("lossless")),
            ("sky", Some("lossless")),
            ("jymaster", Some("lossless")),
            ("vivid", None),
            ("", None),
        ] {
            assert_eq!(tier_of_level(level), tier, "level={level}");
        }
    }

    /// 可播档位来自 privilege:内嵌的直接用,平行 privileges 数组按 id 配对,缺失为未知。
    #[test]
    fn song_briefs_take_play_level_from_embedded_or_parallel_privileges() {
        let embedded = song_brief(&json!({"id": 1, "privilege": {"plLevel": "exhigh"}}));
        assert_eq!(embedded["max_quality"], "high");
        assert_eq!(song_brief(&json!({"id": 1}))["max_quality"], "");
        let body = json!({
            "songs": [{"id": 1}, {"id": 2}, {"id": 3}],
            "privileges": [{"id": 2, "plLevel": "jymaster"}, {"id": 1, "plLevel": "none"}],
        });
        let tiers: Vec<Value> = song_briefs(&body)
            .iter()
            .map(|b| b["max_quality"].clone())
            .collect();
        assert_eq!(tiers, [json!("none"), json!("lossless"), json!("")]);
    }

    /// 元数据说放不了就不再逐档白试;未知 / 可播却没拿到时照旧往下兜底。
    #[test]
    fn only_known_unplayable_stops_the_ladder() {
        assert!(!keeps_trying_lower("none"));
        for hint in ["", "lossless", "high", "standard", "bogus"] {
            assert!(keeps_trying_lower(hint), "hint={hint}");
        }
    }
}
