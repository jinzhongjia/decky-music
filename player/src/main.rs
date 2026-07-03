//! player:拿 URL → HTTP 拉流 → 解码 → 推 PipeWire;上报进度/结束。
//!
//! bridge 作 server,player 启动后连入 `--socket <path>`,收 NDJSON 命令、发 NDJSON 事件。
//!
//! 现状:通信骨架。真正的 rodio 拉流/解码/seek/volume 留到后续。

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let socket = parse_socket_arg().expect("--socket <path> required");
    let stream = UnixStream::connect(&socket).await?;
    let (rd, mut wr) = stream.into_split();
    let mut lines = BufReader::new(rd).lines();

    // NDJSON:每条一行 {json}\n,UTF-8,单条 ≤ 1 MiB
    while let Some(line) = lines.next_line().await? {
        let cmd: Cmd = match serde_json::from_str(&line) {
            Ok(c) => c,
            Err(_) => continue,
        };
        // ponytail: 命令派发骨架。load/pause/resume/seek/volume 的实际 rodio 逻辑留 P1。
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

fn parse_socket_arg() -> Option<String> {
    let mut args = std::env::args();
    while let Some(a) = args.next() {
        if a == "--socket" {
            return args.next();
        }
    }
    None
}
