//! 可播 URL 与歌词。绝不记 URL(含限时 vkey)。

use qqmusic_api::modules::lyric::LyricOptions;
use qqmusic_api::modules::song::{ladder_from, Quality, SongFileType};
use qqmusic_api::Client;
use serde_json::{json, Value};
use wire::{log_json, LogLevel};

use super::{args, CmdResult, Fail};
use crate::lyric::parse;
use crate::Out;

/// QQ 音质阶梯(高 → 低),只放实测拿得到正确双声道文件的档:
/// - 无损只认 FLAC:O801 虽被叫作「OGG 640 无损」,取链服务端对它下发的却是伴唱用的 4 声道分轨
///   (人声 + 伴奏,`vs[9]`),双声道输出只剩人声(#81);没有 FLAC 的歌降到 320k。
/// - 不放 OGG 320(O800):服务端照样给 purl,CDN 上却常是 404(热歌榜 15 首里 7 首),排在 M800 后
///   平时用不到,一用到就是放不出来而不是降到 128k。
const LADDER: [(Quality, SongFileType); 3] = [
    (Quality::Lossless, SongFileType::FLAC),
    (Quality::High, SongFileType::MP3_320),
    (Quality::Standard, SongFileType::MP3_128),
];

/// 要问的档位:从「所选上限」与「列表元数据给的这首最高档」中较低的那档起,往下全保留。
/// `Quality` 按声明顺序比较(Lossless < High < Standard),取较低的档即取较大值;提示缺失 / 无效时只看上限。
pub fn ladder(cap: Quality, hint: Option<Quality>) -> Vec<(Quality, SongFileType)> {
    ladder_from(&LADDER, hint.map_or(cap, |h| cap.max(h)))
}

/// 取可播完整 URL:一次请求问全部要问的档位,取第一个有 purl 的。
/// 上限之上的档不问 —— 选了标准就别偷偷给无损;不存在的档也不问;下面各档永远兜底,无权限也能播低档。
/// ct 由库按设备 guid 派生(同设备稳定、不同安装分散),见 BypassConfig。
pub async fn song_url(c: &Client, out: &Out, a: &Value) -> CmdResult {
    let mid = args::string(a, "id")?;
    let media_mid = a["media_mid"].as_str().filter(|m| !m.is_empty());
    let quality = a["quality"]
        .as_str()
        .and_then(Quality::parse)
        .unwrap_or_default();
    let hint = a["max_quality"].as_str().and_then(Quality::parse);
    let ladder = ladder(quality, hint);
    match c
        .song()
        .playable_url_with_ladder(&mid, media_mid, &ladder)
        .await?
    {
        Some(url) => {
            // 子进程日志正文不落盘,命中档位由 bridge 按响应里的 quality 记(见 playback._resolve_url)
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
