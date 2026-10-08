//! 公开目录:搜索、热搜、榜单、歌单 / 专辑 / 歌手详情、推荐页、电台。

use qqmusic_api::modules::search::{SearchOptions, SearchType};
use qqmusic_api::modules::singer::{OrderType, TabType};
use qqmusic_api::modules::songlist::SonglistDetailOptions;
use qqmusic_api::Client;
use serde_json::{json, Value};

use super::paging::window;
use super::{args, brief, CmdResult, Fail};

const COMMANDS: [&str; 12] = [
    "search_songs",
    "search_playlists",
    "search_albums",
    "search_artists",
    "search_hot",
    "toplists",
    "toplist_songs",
    "artist_detail",
    "album_detail",
    "radio_fetch",
    "recommend",
    "playlist_songs",
];

pub fn handles(cmd: &str) -> bool {
    COMMANDS.contains(&cmd)
}

pub async fn run(c: &Client, cmd: &str, a: &Value) -> CmdResult {
    match cmd {
        "search_hot" => hot_keywords(c, args::limit(a, 20)?).await,
        "search_songs" | "search_playlists" | "search_albums" => search(c, cmd, a).await,
        "search_artists" => search_artists(c, a).await,
        "toplists" => toplists(c).await,
        "toplist_songs" => toplist_songs(c, a).await,
        "artist_detail" => artist_detail(c, a).await,
        "album_detail" => album_detail(c, a).await,
        "radio_fetch" => radio(c, &args::string(a, "kind")?).await,
        "recommend" => recommend(c).await,
        "playlist_songs" => playlist_songs(c, a).await,
        _ => Err(Fail::Unknown),
    }
}

fn typed_search(kind: SearchType, page: i64, num: i64) -> SearchOptions {
    SearchOptions {
        search_type: kind,
        num,
        page,
        highlight: false,
        ..SearchOptions::default()
    }
}

/// 歌曲 / 歌单 / 专辑:全程按类型分页搜索(首页若走综合搜索,与后续页排序源不同会错位)。
async fn search(c: &Client, cmd: &str, a: &Value) -> CmdResult {
    let (keyword, limit, offset) = (args::keyword(a)?, args::limit(a, 20)?, args::offset(a)?);
    let kind = match cmd {
        "search_songs" => SearchType::Song,
        "search_playlists" => SearchType::SongList,
        _ => SearchType::Album,
    };
    let fetch = |page, num| {
        let request = c
            .search()
            .search_by_type_with(&keyword, typed_search(kind, page, num));
        async move {
            let r = request.send().await?;
            let items: Vec<Value> = match kind {
                SearchType::Song => r.song.iter().map(|s| brief::song(&s.song)).collect(),
                SearchType::SongList => r
                    .songlist
                    .iter()
                    .map(|p| brief::playlist(&p.songlist, 0))
                    .collect(),
                _ => r.album.iter().map(album_hit).collect(),
            };
            Ok((items, ()))
        }
    };
    let (items, ()) = window(limit, offset, fetch).await?;
    let key = match kind {
        SearchType::Song => "songs",
        SearchType::SongList => "playlists",
        _ => "albums",
    };
    Ok(json!({ key: items }))
}

fn album_hit(a: &qqmusic_api::models::search::AlbumSearch) -> Value {
    let artist = brief::singers(&a.singer_list);
    let artist = if artist.is_empty() {
        a.singer.clone()
    } else {
        artist
    };
    let name = if a.album.name.is_empty() {
        &a.album.title
    } else {
        &a.album.name
    };
    brief::album(a.album.id, &a.album.mid, name, &a.pic, &artist, 0)
}

/// ponytail: 按类型搜歌手在 Python 上游恒空,沿用综合搜索的歌手直达区(高相关、少量、
/// 不翻页,offset>0 直接到尾)。确认按类型分页可用后换回。
async fn search_artists(c: &Client, a: &Value) -> CmdResult {
    let (keyword, limit, offset) = (args::keyword(a)?, args::limit(a, 20)?, args::offset(a)?);
    if offset > 0 {
        return Ok(json!({ "artists": [] }));
    }
    let r = c.search().general_search(&keyword, 1, limit).send().await?;
    let artists: Vec<Value> = r
        .singer
        .items
        .iter()
        .take(limit as usize)
        .map(|s| {
            let name = if s.singer.name.is_empty() {
                &s.singer.title
            } else {
                &s.singer.name
            };
            brief::artist(s.singer.id, &s.singer.mid, name, &s.pic)
        })
        .collect();
    Ok(json!({ "artists": artists }))
}

/// 热搜词,对齐 NCM search_hot 的 {keyword, label}(label: hot|none)。
async fn hot_keywords(c: &Client, limit: i64) -> CmdResult {
    let r = c.search().get_hotkey().send().await?;
    let keywords: Vec<Value> = r
        .vec_hotkey
        .iter()
        .take(limit as usize)
        .filter(|k| !k.query.is_empty())
        .map(|k| json!({ "keyword": k.query, "label": if k.need_top != 0 { "hot" } else { "none" } }))
        .collect();
    Ok(json!({ "keywords": keywords }))
}

/// 榜单:分类打平成 Playlist 形状卡片。
async fn toplists(c: &Client) -> CmdResult {
    let r = c.top().get_category().send().await?;
    let cards: Vec<Value> = r
        .group
        .iter()
        .flat_map(|g| g.toplist.iter())
        .map(|t| {
            let cover = if t.head_pic_url.is_empty() {
                &t.front_pic_url
            } else {
                &t.head_pic_url
            };
            json!({
                "id": t.id.to_string(),
                "name": t.name,
                "cover": cover,
                "count": t.total_num.max(0),
                "play_count": t.listen_num.max(0),
            })
        })
        .collect();
    Ok(json!({ "toplists": cards }))
}

async fn toplist_songs(c: &Client, a: &Value) -> CmdResult {
    let (id, limit, offset) = (args::int(a, "id")?, args::limit(a, 50)?, args::offset(a)?);
    let fetch = |page, num| {
        let request = c.top().get_detail(id, num, page, false);
        async move { Ok((brief::songs(&request.send().await?.songs), ())) }
    };
    let (songs, ()) = window(limit, offset, fetch).await?;
    Ok(json!({ "songs": songs }))
}

async fn playlist_songs(c: &Client, a: &Value) -> CmdResult {
    let (id, limit, offset) = (args::int(a, "id")?, args::limit(a, 50)?, args::offset(a)?);
    let fetch = |page, num| {
        let options = SonglistDetailOptions {
            num,
            page,
            onlysong: true,
            ..SonglistDetailOptions::default()
        };
        let request = c.songlist().get_detail_with(id, options);
        async move { Ok((brief::songs(&request.send().await?.songs), ())) }
    };
    let (songs, ()) = window(limit, offset, fetch).await?;
    Ok(json!({ "songs": songs }))
}

async fn artist_detail(c: &Client, a: &Value) -> CmdResult {
    let (mid, limit, offset) = (
        args::string(a, "id")?,
        args::limit(a, 20)?,
        args::offset(a)?,
    );
    let info = c.singer().get_info(&mid).send().await?;
    let fetch = |page, num| {
        let request =
            c.singer()
                .get_tab_detail(&mid, TabType::Song, page, num, OrderType::Latest, None);
        async move { Ok((brief::songs(&request.send().await?.song_tab.songs), ())) }
    };
    let (songs, ()) = window(limit, offset, fetch).await?;
    let s = &info.singer;
    Ok(json!({
        "artist": brief::artist(s.id, &s.mid, &s.name, &s.singer_pic),
        "songs": songs,
    }))
}

async fn album_detail(c: &Client, a: &Value) -> CmdResult {
    let (id, limit, offset) = (
        args::string(a, "id")?,
        args::limit(a, 50)?,
        args::offset(a)?,
    );
    let detail = c.album().get_detail(id.as_str()).send().await?;
    let fetch = |page, num| {
        let request = c.album().get_song(id.as_str(), num, page);
        async move {
            let r = request.send().await?;
            Ok((brief::songs(&r.song_list), r.total_num))
        }
    };
    let (songs, total) = window(limit, offset, fetch).await?;
    let al = &detail.album.album;
    let name = if al.name.is_empty() {
        &al.title
    } else {
        &al.name
    };
    let artist = brief::singers(&detail.singers);
    Ok(json!({
        "album": brief::album(al.id, &al.mid, name, "", &artist, total),
        "songs": songs,
    }))
}

/// 电台:猜你喜欢(需登录态)/ 雷达推荐。
async fn radio(c: &Client, kind: &str) -> CmdResult {
    let songs = match kind {
        "qq_guess" => c.recommend().get_guess_recommend(None).send().await?.songs,
        "qq_radar" => c.recommend().get_radar_recommend(1).send().await?.songs,
        _ => return Err(Fail::Invalid),
    };
    Ok(json!({ "songs": brief::songs(&songs) }))
}

/// 推荐页:推荐歌单 + 新歌首发(接口给 70+,页面一节 12 个够)。
async fn recommend(c: &Client) -> CmdResult {
    let lists = c.recommend().get_recommend_songlist(1, 12).send().await?;
    let news = c.recommend().get_recommend_newsong(5).send().await?;
    let playlists: Vec<Value> = lists
        .songlists
        .iter()
        .map(|x| {
            json!({
                "id": x.id.to_string(),
                "name": x.title,
                "cover": x.picurl,
                "count": x.songnum.max(0),
                "play_count": x.listennum.max(0),
            })
        })
        .collect();
    let newsongs: Vec<Value> = news.songs.iter().take(12).map(brief::song).collect();
    Ok(json!({ "playlists": playlists, "newsongs": newsongs }))
}
