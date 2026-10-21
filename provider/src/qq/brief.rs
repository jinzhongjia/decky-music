//! 上游模型 → 共享形状(Song / Playlist / Album / Artist,见 src/api.ts)。

use qqmusic_api::models::base::{File, Singer, Song, SongList};
use serde_json::{json, Value};

/// 登录态搜索把命中词包进 `<em ...>`;名称类字段不存在合法尖括号,通用剥标签。
pub fn clean(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

fn first_nonempty<'a>(a: &'a str, b: &'a str) -> &'a str {
    if a.is_empty() {
        b
    } else {
        a
    }
}

pub fn singers(list: &[Singer]) -> String {
    let names: Vec<&str> = list
        .iter()
        .map(|s| first_nonempty(&s.name, &s.title))
        .collect();
    clean(&names.join(" / "))
}

/// QQ 封面无直链,按专辑 / 歌手 mid 拼 CDN 模板(300x300)。
pub fn album_cover(mid: &str) -> String {
    cover("T002", mid)
}

pub fn artist_avatar(mid: &str) -> String {
    cover("T001", mid)
}

fn cover(kind: &str, mid: &str) -> String {
    if mid.is_empty() {
        return String::new();
    }
    format!("https://y.qq.com/music/photo_new/{kind}R300x300M000{mid}.jpg")
}

pub fn song(s: &Song) -> Value {
    json!({
        "mid": s.mid,
        "name": clean(first_nonempty(&s.name, &s.title)),
        "singer": singers(&s.singer),
        "album": clean(first_nonempty(&s.album.name, &s.album.title)),
        "duration": s.interval.max(0), // QQ interval 单位为秒
        "cover": album_cover(&s.album.mid),
        "vip": s.pay.pay_play != 0,
        "media_mid": s.file.media_mid,
        "max_quality": max_quality(&s.file),
    })
}

/// 这首歌最高有哪档:只看文件是否存在,有没有权限要到取链时才知道;各档大小全为 0 时给空串(未知)。
/// 只看取链阶梯里有的档(见 media::LADDER):`size_new[5]` 是伴唱用的 4 声道分轨(O801,#81),
/// `size_new[3]` 是 CDN 上常缺的 OGG 320,都不算。
pub fn max_quality(f: &File) -> &'static str {
    if f.size_flac > 0 {
        "lossless"
    } else if f.size_320mp3 > 0 {
        "high"
    } else if f.size_128mp3 > 0 {
        "standard"
    } else {
        ""
    }
}

pub fn songs(list: &[Song]) -> Vec<Value> {
    list.iter().map(song).collect()
}

/// 歌单卡。id = 全局 tid(详情只认它;自建歌单的 dirid 查详情必空);
/// dirid = 用户目录号(收藏到歌单用;非自建列表为 0)。
pub fn playlist(p: &SongList, play_count: i64) -> Value {
    let id = if p.id != 0 { p.id } else { p.dirid };
    json!({
        "id": if id != 0 { id.to_string() } else { String::new() },
        "dirid": p.dirid,
        "name": clean(&p.title),
        "cover": p.picurl,
        "count": p.songnum.max(0),
        "play_count": if p.listennum != 0 { p.listennum } else { play_count },
    })
}

pub fn album(id: i64, mid: &str, name: &str, cover: &str, artist: &str, count: i64) -> Value {
    let id = if id != 0 {
        id.to_string()
    } else {
        mid.to_string()
    };
    let cover = if cover.is_empty() {
        album_cover(mid)
    } else {
        cover.to_string()
    };
    json!({
        "id": id,
        "name": clean(name),
        "cover": cover,
        "artist": clean(artist),
        "count": count.max(0),
    })
}

pub fn artist(id: i64, mid: &str, name: &str, avatar: &str) -> Value {
    let id = if mid.is_empty() {
        id.to_string()
    } else {
        mid.to_string()
    };
    let avatar = if avatar.is_empty() {
        artist_avatar(mid)
    } else {
        avatar.to_string()
    };
    json!({ "id": id, "name": clean(name), "avatar": avatar })
}
