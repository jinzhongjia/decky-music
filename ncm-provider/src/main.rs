//! ncm-provider:网易云 provider。ncm-api-rs 作为库,包一层 UDS + NDJSON server。
//!
//! bridge 作 server,provider 启动后连入 `--socket <path>`。无状态:cookie 由 bridge
//! spawn 时注入,不自存。
//!
//! 现状:通信骨架。song_url / search / lyric 的实际 ncm-api 调用留到后续。

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

#[derive(Deserialize)]
struct Cmd {
    cmd: String,
    #[allow(dead_code)]
    id: Option<String>,
    #[allow(dead_code)]
    keyword: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let socket = parse_socket_arg().expect("--socket <path> required");
    let stream = UnixStream::connect(&socket).await?;
    let (rd, mut wr) = stream.into_split();
    let mut lines = BufReader::new(rd).lines();

    while let Some(line) = lines.next_line().await? {
        let cmd: Cmd = match serde_json::from_str(&line) {
            Ok(c) => c,
            Err(_) => continue,
        };
        // ponytail: 派发骨架。song_url/search/lyric 的实际 ncm-api 调用留 P2。
        let resp = match cmd.cmd.as_str() {
            "song_url" => r#"{"ok":false,"msg":"not implemented"}"#,
            "search" => r#"{"ok":false,"msg":"not implemented"}"#,
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
