//! 上游模型 → 共享形状(Song / Playlist / Album / Artist,见 src/api.ts)。

use qqmusic_api::models::base::{Singer, Song, SongList};
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
    })
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
