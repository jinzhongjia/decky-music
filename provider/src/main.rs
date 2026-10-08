//! provider:统一的音源进程,同时承载 QQ 音乐(QQMusicApi-rs)与网易云(ncm-api-rs)。
//!
//! bridge 作 server,provider 启动后连入 `--socket <path>` 并常驻。每条请求顶层带
//! `provider: "qq" | "ncm"`,这里按它路由到对应后端;切换音源只是换路由,不再换进程。
//! 两个后端各自持有凭证与登录任务,事件带音源标签上报,bridge 只收当前音源的事件。
//!
//! 本文件只做:连 socket、单写出、按音源分发。

use tokio::io::{AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc;
use wire::{log_json, ErrorCode, LogLevel};

mod lyric;
mod ncm;
mod qq;

/// 单写出通道:响应、事件、日志都汇到这里,由一个任务按行写 socket,避免并发写乱帧。
pub type Out = mpsc::UnboundedSender<String>;

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
    let debug = std::env::var("DECKY_MUSIC_DEBUG").is_ok();
    let out = writer(wr);
    let mut ncm = ncm::Ncm::new(state_dir.as_deref());
    let mut qq = qq::Qq::new(state_dir.as_deref(), debug);
    while let Some(line) = wire::read_frame(&mut reader, &mut frame).await? {
        let Ok(req) = wire::parse_request(&line) else {
            let _ = out.send(log_json(
                LogLevel::Warn,
                "protocol",
                "invalid request frame",
            ));
            continue;
        };
        if debug {
            let _ = out.send(log_json(LogLevel::Debug, "cmd", "request received"));
        }
        route(&mut ncm, &mut qq, &out, req);
    }
    Ok(())
}

/// 按请求的音源标签分发;缺失或未知音源一律 invalid_request,不回显输入。
fn route(ncm: &mut ncm::Ncm, qq: &mut qq::Qq, out: &Out, req: wire::Request) {
    match req.provider.as_deref() {
        Some("ncm") => ncm.receive(out, req),
        Some("qq") => qq.receive(out, req),
        _ => {
            let _ = out.send(wire::err(
                req.id,
                ErrorCode::InvalidRequest,
                "invalid_request",
            ));
        }
    }
}

fn writer(mut wr: tokio::net::unix::OwnedWriteHalf) -> Out {
    let (out, mut messages) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        while let Some(line) = messages.recv().await {
            if line.len() > wire::MAX_FRAME_BYTES
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

fn arg(flag: &str) -> Option<String> {
    std::env::args().skip_while(|a| a != flag).nth(1)
}
