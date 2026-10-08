//! 网易云后端:ncm-api-rs 作库。网易云免费歌匿名即可播(登录仅为 VIP/高音质);
//! cookie 由 bridge 注入,后端无状态。登录是长流程,以带 `ncm` 标签的 login 事件上报。

use std::sync::Arc;

use serde_json::Value;

mod commands;
mod content;
mod deadline;
mod device;
mod login;
mod lyric;
mod protocol;
mod provider_commands;
mod state;

use crate::Out;
use protocol::{log_json, ErrorCode, LogLevel};
use state::State;

/// 网易云后端:状态 + 在跑的扫码登录。由 main 的读循环独占,按请求路由进来。
pub struct Ncm {
    state: Arc<State>,
    login: Option<tokio::task::JoinHandle<()>>,
}

impl Ncm {
    pub fn new(state_dir: Option<&str>) -> Self {
        Self {
            state: Arc::new(State::new(state_dir)),
            login: None,
        }
    }

    fn abort_login(&mut self) {
        if let Some(handle) = self.login.take() {
            handle.abort();
        }
    }

    /// 读循环内同步调用:认证类命令就地改状态,其余命令后台执行,慢上游不堵读循环。
    pub fn receive(&mut self, out: &Out, req: protocol::Request) {
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
                self.abort_login();
                self.state.replace_credential(cookie, None);
                let _ = out.send(log_json(LogLevel::Info, "credential", message));
                let _ = out.send(protocol::ok_empty(req.id));
            }
            "login" => {
                self.abort_login();
                let (state, out) = (self.state.clone(), out.clone());
                let session = state.live_session();
                let _ = out.send(protocol::ok_empty(req.id));
                self.login = Some(tokio::spawn(login::login_flow(state, out, session)));
            }
            // 切走音源时 bridge 发:回收在跑的扫码轮询(原来靠杀进程)。
            "cancel_login" => {
                self.abort_login();
                let _ = out.send(protocol::ok_empty(req.id));
            }
            _ => {
                if req.cmd == "logout" {
                    self.abort_login();
                }
                let (state, out) = (self.state.clone(), out.clone());
                let end = tokio::time::Instant::now() + deadline::COMMAND_TIMEOUT;
                let session = state.live_session();
                let (id, logout) = (req.id, req.cmd == "logout");
                tokio::spawn(async move {
                    let response =
                        execute(state.clone(), out.clone(), req, session.clone(), end).await;
                    state.publish_response((!logout).then_some(&session), &out, id, response);
                });
            }
        }
    }
}

impl Drop for Ncm {
    fn drop(&mut self) {
        self.abort_login();
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

#[cfg(test)]
mod tests;
