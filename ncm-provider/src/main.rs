//! ncm-provider:网易云 provider。ncm-api-rs 作库,包一层 UDS + NDJSON server。
//!
//! bridge 作 server,provider 启动后连入 `--socket <path>`。协议与 qq-provider 对齐:
//! 命令 set_credential / login / search / song_url;登录是长流程,以 login 事件上报。
//! 网易云免费歌匿名即可播(登录仅为 VIP/高音质);cookie 由 bridge 注入,provider 无状态。
//!
//! 本文件只做:连 socket、单写出、命令分发。各命令实现见 commands.rs / login.rs。

use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc;

mod commands;
mod logging;
mod login;
mod state;

use logging::log_json;
use state::{Cmd, State};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let socket = arg("--socket").expect("--socket <path> required");
    let stream = UnixStream::connect(&socket).await?;
    let (rd, mut wr) = stream.into_split();
    let mut lines = BufReader::new(rd).lines();

    let state = Arc::new(State::new());
    let debug = std::env::var("DECKY_MUSIC_DEBUG").is_ok(); // release 下不发 debug

    // 单一写出:命令响应 + 事件汇到这里串行写回,避免并发写乱帧
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        while let Some(line) = out_rx.recv().await {
            if wr.write_all(line.as_bytes()).await.is_err()
                || wr.write_all(b"\n").await.is_err()
                || wr.flush().await.is_err()
            {
                break;
            }
        }
    });

    // 在跑的登录轮询;新登录来时 abort 掉,避免双循环并发 emit(只在此单线程命令循环里碰)
    let mut login_handle: Option<tokio::task::JoinHandle<()>> = None;

    // NDJSON:每条一行 {json}\n
    while let Some(line) = lines.next_line().await? {
        let cmd: Cmd = match serde_json::from_str(&line) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if debug {
            let _ = out_tx.send(log_json("debug", "cmd", &cmd.cmd));
        }
        match cmd.cmd.as_str() {
            "set_credential" => {
                let ck = cmd
                    .cred
                    .as_ref()
                    .and_then(|c| c["cookie"].as_str())
                    .map(String::from);
                let msg = if ck.is_some() { "injected" } else { "cleared" };
                *state.cookie.lock().await = ck;
                let _ = out_tx.send(log_json("info", "credential", msg));
                let _ = out_tx.send(r#"{"ok":true}"#.to_string());
            }
            "login" => {
                // 长流程:后台跑,QR 与状态经 login 事件上报;命令本身即刻返 ok
                if let Some(h) = login_handle.take() {
                    h.abort(); // 顶掉上一个未结束的登录轮询
                }
                let (st, tx) = (state.clone(), out_tx.clone());
                login_handle = Some(tokio::spawn(async move { login::login_flow(st, tx).await }));
                let _ = out_tx.send(r#"{"ok":true}"#.to_string());
            }
            "search" => {
                let _ = out_tx
                    .send(commands::search(&state, cmd.keyword.as_deref().unwrap_or("")).await);
            }
            "song_url" => {
                let _ = out_tx.send(
                    commands::song_url(&state, cmd.id.as_deref().unwrap_or(""), &out_tx).await,
                );
            }
            "logout" => {
                let _ = out_tx.send(commands::logout(&state).await);
            }
            "account" => {
                let _ = out_tx.send(commands::account(&state).await);
            }
            _ => {
                let _ = out_tx.send(r#"{"ok":false,"msg":"unknown cmd"}"#.to_string());
            }
        }
    }
    Ok(())
}

fn arg(flag: &str) -> Option<String> {
    let mut args = std::env::args();
    while let Some(a) = args.next() {
        if a == flag {
            return args.next();
        }
    }
    None
}
