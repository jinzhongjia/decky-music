//! player:拿 URL → HTTP 拉流 → 解码 → 推 PipeWire;上报进度/结束。
//!
//! 两个入口:
//! - `player --play <url>`:P0 出声 spike。独立跑,不接 bridge。同步拉整首 → rodio 播放。
//! - `player --socket <path>`:正式模式。bridge 作 server,player 连入,收 NDJSON 命令、发事件。
//!
//! 现状:play 是能出声的最小实现;socket 侧仍是通信骨架,rodio seek/volume/流式留后续。

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if let Some(url) = arg("--play") {
        return play_spike(&url);
    }
    let socket = arg("--socket").expect("--socket <path> or --play <url> required");
    // blocking reqwest 不能在 tokio 运行时里跑,所以 play 走同步、socket 才建运行时
    tokio::runtime::Runtime::new()?.block_on(socket_loop(&socket))
}

/// P0 出声 spike:拉一段固定 mp3 → rodio 默认设备播放,阻塞到放完。
fn play_spike(url: &str) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Cursor;
    // ponytail: P0 只求出声 —— 整首下到内存 + 同步阻塞。流式边下边播 / seek / volume 留后续。
    eprintln!("[player] fetching {url}");
    let bytes = reqwest::blocking::Client::builder()
        .build()?
        .get(url)
        .send()?
        .error_for_status()?
        .bytes()?;
    eprintln!("[player] fetched {} bytes, opening default audio device", bytes.len());
    // 命门:开不了默认设备 → 错误直接冒出来(rodio → cpal → libasound → pipewire-alsa)
    let (_stream, handle) = rodio::OutputStream::try_default()?;
    let sink = rodio::Sink::try_new(&handle)?;
    sink.append(rodio::Decoder::new(Cursor::new(bytes))?); // symphonia 解码
    eprintln!("[player] playing… (Ctrl+C to stop)");
    sink.sleep_until_end();
    eprintln!("[player] done");
    Ok(())
}

#[derive(Deserialize)]
struct Cmd {
    cmd: String,
    #[allow(dead_code)]
    url: Option<String>,
    #[allow(dead_code)]
    sec: Option<f64>,
    #[allow(dead_code)]
    val: Option<f64>,
}

async fn socket_loop(socket: &str) -> Result<(), Box<dyn std::error::Error>> {
    let stream = UnixStream::connect(socket).await?;
    let (rd, mut wr) = stream.into_split();
    let mut lines = BufReader::new(rd).lines();

    // NDJSON:每条一行 {json}\n,UTF-8,单条 ≤ 1 MiB
    while let Some(line) = lines.next_line().await? {
        let cmd: Cmd = match serde_json::from_str(&line) {
            Ok(c) => c,
            Err(_) => continue,
        };
        // ponytail: 命令派发骨架。load/pause/resume/seek/volume 的实际 rodio 逻辑留后续。
        let resp = match cmd.cmd.as_str() {
            "load" | "pause" | "resume" | "seek" | "volume" => r#"{"ok":true}"#,
            _ => r#"{"ok":false,"msg":"unknown cmd"}"#,
        };
        wr.write_all(resp.as_bytes()).await?;
        wr.write_all(b"\n").await?;
        wr.flush().await?;
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
