//! 个人资产读取与收藏动作(需登录)。红心 / 加歌单前先查歌曲数字 id。

use qqmusic_api::modules::song::SongQuery;
use qqmusic_api::{Client, Credential};
use serde_json::{json, Value};

use super::paging::window;
use super::{args, brief, CmdResult, Fail};

const COMMANDS: [&str; 8] = [
    "user_assets",
    "liked_ids",
    "fav_songs",
    "created_playlists",
    "fav_playlists",
    "like_song",
    "fav_playlist",
    "add_to_playlist",
];
/// 红心种子一发拉全量的上限(每页 50 是本插件钳制,非接口限制)。
const LIKED_SEED_LIMIT: i64 = 500;

pub fn handles(cmd: &str) -> bool {
    COMMANDS.contains(&cmd)
}

pub async fn run(c: &Client, cmd: &str, a: &Value) -> CmdResult {
    let cred = logged_in(c)?;
    match cmd {
        "user_assets" => user_assets(c, &cred).await,
        "liked_ids" => liked_ids(c, &cred).await,
        "fav_songs" => fav_songs(c, &cred, args::limit(a, 20)?, args::offset(a)?).await,
        "created_playlists" => created(c, &cred, args::limit(a, 20)?, args::offset(a)?).await,
        "fav_playlists" => fav_lists(c, &cred, args::limit(a, 20)?, args::offset(a)?).await,
        "like_song" => like_song(c, &args::string(a, "id")?, args::boolean(a, "on")?).await,
        "fav_playlist" => fav_playlist(c, args::int(a, "id")?, args::boolean(a, "on")?).await,
        "add_to_playlist" => {
            let dirid = args::int(a, "playlist_id")?;
            add_to_playlist(c, dirid, &args::string(a, "song_id")?).await
        }
        _ => Err(Fail::Unknown),
    }
}

/// 本地预检:没有 encrypt_uin / musicid 就别打上游。
fn logged_in(c: &Client) -> Result<Credential, Fail> {
    let cred = c.credential();
    if cred.encrypt_uin.is_empty() || cred.musicid == 0 {
        return Err(Fail::NotLoggedIn);
    }
    Ok(cred)
}

async fn user_assets(c: &Client, cred: &Credential) -> CmdResult {
    let user = c.user();
    let fav = user
        .get_fav_song(&cred.encrypt_uin, 1, 1, None)
        .send()
        .await?;
    let created = user.get_created_songlist(cred.musicid, None).send().await?;
    let lists = user
        .get_fav_songlist(&cred.encrypt_uin, 1, 1, None)
        .send()
        .await?;
    Ok(json!({
        "fav_songs": fav.total.max(0),
        "created_playlists": created.total.max(0),
        "fav_playlists": lists.total.max(0),
    }))
}

/// 红心种子:返回 mid 列表,与 like_song / 当前曲 id 同一体系。
async fn liked_ids(c: &Client, cred: &Credential) -> CmdResult {
    let r = c
        .user()
        .get_fav_song(&cred.encrypt_uin, 1, LIKED_SEED_LIMIT, None)
        .send()
        .await?;
    let ids: Vec<&str> = r
        .songs
        .iter()
        .map(|s| s.mid.as_str())
        .filter(|m| !m.is_empty())
        .collect();
    Ok(json!({ "ids": ids }))
}

async fn fav_songs(c: &Client, cred: &Credential, limit: i64, offset: i64) -> CmdResult {
    let fetch = |page, num| {
        let request = c.user().get_fav_song(&cred.encrypt_uin, page, num, None);
        async move { Ok((brief::songs(&request.send().await?.songs), ())) }
    };
    let (songs, ()) = window(limit, offset, fetch).await?;
    Ok(json!({ "songs": songs }))
}

/// 自建歌单接口一次返回全部,本地切片。
async fn created(c: &Client, cred: &Credential, limit: i64, offset: i64) -> CmdResult {
    let r = c
        .user()
        .get_created_songlist(cred.musicid, None)
        .send()
        .await?;
    let lists: Vec<Value> = r
        .playlists
        .iter()
        .skip(offset as usize)
        .take(limit as usize)
        .map(|p| brief::playlist(&p.songlist, p.play_cnt))
        .collect();
    Ok(json!({ "playlists": lists }))
}

async fn fav_lists(c: &Client, cred: &Credential, limit: i64, offset: i64) -> CmdResult {
    let fetch = |page, num| {
        let request = c
            .user()
            .get_fav_songlist(&cred.encrypt_uin, page, num, None);
        async move {
            let r = request.send().await?;
            Ok((
                r.playlists
                    .iter()
                    .map(|p| brief::playlist(&p.songlist, 0))
                    .collect(),
                (),
            ))
        }
    };
    let (lists, ()) = window(limit, offset, fetch).await?;
    Ok(json!({ "playlists": lists }))
}

/// 收藏目录键用 songType=0;元数据里的 type=1 只表示「普通歌曲」,传它删除会静默无效。
async fn song_key(c: &Client, mid: &str) -> Result<Option<(i64, i64)>, Fail> {
    let request = c.song().query_song([SongQuery::new(mid, 0)])?;
    let r = request.send().await?;
    Ok(r.tracks
        .first()
        .map(|s| (s.id, 0))
        .filter(|(id, _)| *id != 0))
}

async fn like_song(c: &Client, mid: &str, on: bool) -> CmdResult {
    let Some(key) = song_key(c, mid).await? else {
        return Ok(json!({ "success": false }));
    };
    let list = c.songlist();
    let success = if on {
        list.like_song(&[key], None).await?
    } else {
        list.unlike_song(&[key], None).await?
    };
    Ok(json!({ "success": success }))
}

async fn add_to_playlist(c: &Client, dirid: i64, mid: &str) -> CmdResult {
    let Some(key) = song_key(c, mid).await? else {
        return Ok(json!({ "success": false }));
    };
    let success = c.songlist().add_songs(dirid, &[key], 0, None).await?;
    Ok(json!({ "success": success }))
}

/// 收藏 / 取消收藏他人公开歌单;id 是全局 tid,不是自建歌单的 dirid。上游天然幂等。
async fn fav_playlist(c: &Client, id: i64, on: bool) -> CmdResult {
    let user = c.user();
    let success = if on {
        user.fav_songlist(id, None).await?
    } else {
        user.unfav_songlist(id, None).await?
    };
    Ok(json!({ "success": success }))
}
