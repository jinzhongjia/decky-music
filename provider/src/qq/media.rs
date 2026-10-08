//! 可播 URL 与歌词。绝不记 URL(含限时 vkey)。

use qqmusic_api::modules::lyric::LyricOptions;
use qqmusic_api::modules::song::Quality;
use qqmusic_api::Client;
use serde_json::{json, Value};
use wire::{log_json, LogLevel};

use super::{args, CmdResult, Fail};
use crate::lyric::parse;
use crate::Out;

/// 取可播完整 URL:一次请求问全部档位(从所选上限往下),取第一个有 purl 的。
/// 上限之上的档不问 —— 选了标准就别偷偷给无损;下面各档永远兜底,无版权 / 非会员也能播。
/// ct 由库按设备 guid 派生(同设备稳定、不同安装分散),见 BypassConfig。
pub async fn song_url(c: &Client, out: &Out, a: &Value) -> CmdResult {
    let mid = args::string(a, "id")?;
    let media_mid = a["media_mid"].as_str().filter(|m| !m.is_empty());
    let quality = a["quality"]
        .as_str()
        .and_then(Quality::parse)
        .unwrap_or_default();
    match c.song().playable_url(&mid, media_mid, quality).await? {
        Some(url) => {
            // 命中档位进日志:选了无损实际降到 320k 时,不留痕没人查得出来
            let msg = format!("playable url resolved ({})", url.quality.as_str());
            let _ = out.send(log_json(LogLevel::Debug, "song_url", &msg));
            Ok(json!({ "url": url.url, "quality": url.quality.as_str() }))
        }
        None => {
            let _ = out.send(log_json(LogLevel::Warn, "song_url", "no playable url"));
            Err(Fail::NoPlayable)
        }
    }
}

/// 逐行 LRC(含译文)→ 共享结构。QQ 逐字(QRC)待接,先 word_by_word=false。
pub async fn lyric(c: &Client, a: &Value) -> CmdResult {
    let mid = args::string(a, "id")?;
    let options = LyricOptions {
        trans: true,
        ..LyricOptions::default()
    };
    let r = c
        .lyric()
        .get_lyric_with(mid.as_str(), options)
        .send()
        .await?;
    Ok(normalize(&r.lyric, &r.trans))
}

/// 规则与 NCM 共用 `crate::lyric::parse`:没有独立译文时才合并内嵌的「原文 + 译文」。
pub fn normalize(lyric: &str, trans: &str) -> Value {
    let trans = parse::parse_lrc(trans, false);
    let mut lines = parse::parse_lrc(lyric, trans.is_empty());
    parse::align_translation(&mut lines, &trans);
    let lines: Vec<Value> = lines.iter().map(parse::Line::to_json).collect();
    json!({ "word_by_word": false, "lines": lines })
}
