//! ncm-provider:网易云 provider。ncm-api-rs 作库,包一层 UDS + NDJSON server。
//!
//! bridge 作 server,provider 启动后连入 `--socket <path>`。协议与 qq-provider 对齐:
//! 命令 set_credential / login / search / song_url;登录是长流程,以 login 事件上报。
//! 网易云免费歌匿名即可播(登录仅为 VIP/高音质);cookie 由 bridge 注入,provider 无状态。
//!
//! 本文件只做:连 socket、单写出、命令分发。各命令实现见 commands.rs / login.rs。

use std::sync::Arc;

use serde_json::Value;
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc;

mod commands;
mod content;
mod deadline;
mod device;
mod login;
mod lyric;
mod protocol;
mod provider_commands;
mod state;

use protocol::{log_json, ErrorCode, LogLevel};
use state::{Out, State};

#[tokio::main]
async fn main() {
    if run().await.is_err() {
        eprintln!("provider transport failed");
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let socket = arg("--socket").ok_or("socket argument required")?;
    let stream = UnixStream::connect(&socket).await?;
    let (rd, wr) = stream.into_split();
    let mut reader = BufReader::new(rd);
    let mut frame = Vec::new();
    let state_dir = std::env::var("DECKY_MUSIC_STATE_DIR").ok();
    let state = Arc::new(State::new(state_dir.as_deref()));
    let debug = std::env::var("DECKY_MUSIC_DEBUG").is_ok();
    let out = writer(wr);
    let mut login_handle = None;
    while let Some(line) = protocol::read_frame(&mut reader, &mut frame).await? {
        match protocol::parse_request(&line) {
            Ok(req) => {
                if debug {
                    let _ = out.send(log_json(LogLevel::Debug, "cmd", "request received"));
                }
                receive(&state, &out, req, &mut login_handle);
            }
            Err(_) => {
                let _ = out.send(log_json(
                    LogLevel::Warn,
                    "protocol",
                    "invalid request frame",
                ));
            }
        }
    }
    if let Some(handle) = login_handle {
        handle.abort();
    }
    Ok(())
}

fn writer(mut wr: tokio::net::unix::OwnedWriteHalf) -> Out {
    let (out, mut messages) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        while let Some(line) = messages.recv().await {
            if line.len() > protocol::MAX_FRAME_BYTES
                || wr.write_all(line.as_bytes()).await.is_err()
                || wr.write_all(b"\n").await.is_err()
                || wr.flush().await.is_err()
            {
                break;
            }
        }
    });
    out
}

fn receive(
    state: &Arc<State>,
    out: &Out,
    req: protocol::Request,
    login_handle: &mut Option<tokio::task::JoinHandle<()>>,
) {
    match req.cmd.as_str() {
        "set_credential" => {
            let cred = protocol::parse_args::<protocol::SetCredentialArgs>(&req)
                .map(|a| a.cred)
                .unwrap_or(Value::Null);
            let cookie = cred["cookie"].as_str().map(String::from);
            let message = if cookie.is_some() {
                "injected"
            } else {
                "cleared"
            };
            if let Some(handle) = login_handle.take() {
                handle.abort();
            }
            state.replace_credential(cookie, None);
            let _ = out.send(log_json(LogLevel::Info, "credential", message));
            let _ = out.send(protocol::ok_empty(req.id));
        }
        "login" => {
            if let Some(handle) = login_handle.take() {
                handle.abort();
            }
            let (state, out) = (state.clone(), out.clone());
            let session = state.live_session();
            let _ = out.send(protocol::ok_empty(req.id));
            *login_handle = Some(tokio::spawn(login::login_flow(state, out, session)));
        }
        _ => {
            if req.cmd == "logout" {
                if let Some(handle) = login_handle.take() {
                    handle.abort();
                }
            }
            let (state, out) = (state.clone(), out.clone());
            let end = tokio::time::Instant::now() + deadline::COMMAND_TIMEOUT;
            let session = state.live_session();
            let (id, logout) = (req.id, req.cmd == "logout");
            tokio::spawn(async move {
                let response = execute(state.clone(), out.clone(), req, session.clone(), end).await;
                state.publish_response((!logout).then_some(&session), &out, id, response);
            });
        }
    }
}

async fn execute(
    state: Arc<State>,
    out: Out,
    req: protocol::Request,
    session: Arc<state::Session>,
    end: tokio::time::Instant,
) -> String {
    let id = req.id;
    let result = deadline::command(
        end,
        state::SESSION.scope(session, dispatch(state, out, req)),
    )
    .await;
    result.unwrap_or_else(|_| protocol::err(id, ErrorCode::UpstreamTimeout, "upstream_timeout"))
}

async fn dispatch(state: Arc<State>, out_tx: Out, req: protocol::Request) -> String {
    match req.cmd.as_str() {
        "song_url" => {
            let a = protocol::parse_args::<protocol::SongUrlArgs>(&req).unwrap_or(
                protocol::SongUrlArgs {
                    id: String::new(),
                    quality: String::new(),
                },
            );
            commands::song_url(&state, req.id, &a.id, &a.quality, &out_tx).await
        }
        "lyric" => {
            let song_id = protocol::parse_args::<protocol::IdArgs>(&req)
                .map(|a| a.id)
                .unwrap_or_default();
            lyric::lyric(&state, req.id, &song_id).await
        }
        "discover" => content::discover(&state, req.id).await,
        "daily_songs" => content::daily_songs(&state, req.id).await,
        "playlist_songs" => content::playlist_songs(&state, req.id, &req.args).await,
        "toplists" => content::toplists(&state, req.id).await,
        // NCM 榜单即歌单:曲目命令直接别名(同 {id,limit,offset} 参数)
        "toplist_songs" => content::playlist_songs(&state, req.id, &req.args).await,
        "search_songs" => provider_commands::search_songs(&state, req.id, &req.args).await,
        "search_playlists" => provider_commands::search_playlists(&state, req.id, &req.args).await,
        "search_albums" => provider_commands::search_albums(&state, req.id, &req.args).await,
        "search_artists" => provider_commands::search_artists(&state, req.id, &req.args).await,
        "search_hot" => provider_commands::search_hot(&state, req.id).await,
        "user_assets" => provider_commands::user_assets(&state, req.id).await,
        "liked_ids" => provider_commands::liked_ids(&state, req.id).await,
        "fav_songs" => provider_commands::fav_songs(&state, req.id, &req.args).await,
        "listen_rank" => provider_commands::listen_rank(&state, req.id, &req.args).await,
        "created_playlists" => {
            provider_commands::created_playlists(&state, req.id, &req.args).await
        }
        "fav_playlists" => provider_commands::fav_playlists(&state, req.id, &req.args).await,
        "like_song" => provider_commands::like_song(&state, req.id, &req.args).await,
        "add_to_playlist" => provider_commands::add_to_playlist(&state, req.id, &req.args).await,
        "fav_playlist" => provider_commands::fav_playlist(&state, req.id, &req.args).await,
        "artist_detail" => provider_commands::artist_detail(&state, req.id, &req.args).await,
        "album_detail" => provider_commands::album_detail(&state, req.id, &req.args).await,
        "radio_fetch" => provider_commands::radio_fetch(&state, req.id, &req.args).await,
        "fm_trash" => provider_commands::fm_trash(&state, req.id, &req.args).await,
        "comments" => provider_commands::comments(&state, req.id, &req.args).await,
        "logout" => commands::logout(&state, req.id).await,
        "account" => commands::account(&state, req.id).await,
        _ => protocol::err(req.id, ErrorCode::UnknownCmd, "unknown cmd"),
    }
}

fn arg(flag: &str) -> Option<String> {
    std::env::args().skip_while(|a| a != flag).nth(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unknown_command_never_echoes_input() {
        let state = Arc::new(State::new(None));
        let session = state.session();
        let (out, mut logs) = mpsc::unbounded_channel();
        let req = protocol::parse_request(
            r#"{"id":17,"cmd":"SENTINEL https://synthetic.invalid/?token=secret","args":{}}"#,
        )
        .unwrap();
        let response = execute(
            state,
            out,
            req,
            session,
            tokio::time::Instant::now() + deadline::COMMAND_TIMEOUT,
        )
        .await;
        assert!(!response.contains("SENTINEL"));
        assert!(!response.contains("synthetic.invalid"));
        let response: Value = serde_json::from_str(&response).unwrap();
        assert_eq!(response["error"]["code"], "unknown_cmd");
        assert!(logs.try_recv().is_err());
    }
}
