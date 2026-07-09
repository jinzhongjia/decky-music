use std::sync::mpsc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc as tmpsc;

use crate::audio::{audio_thread, AudioCmd, AudioEv};
use crate::logging::{log_json, LogLevel};
use crate::protocol::{self, ErrorCode};
use crate::stream::open_http_stream;

pub(crate) async fn socket_loop(socket: &str) -> Result<(), Box<dyn std::error::Error>> {
    let stream = UnixStream::connect(socket).await?;
    let (rd, mut wr) = stream.into_split();
    let mut lines = BufReader::new(rd).lines();

    // 音频线程 + 两条 channel:cmd(tokio→audio,std mpsc)、event(audio→tokio,tokio mpsc)
    let (cmd_tx, cmd_rx) = mpsc::channel::<AudioCmd>();
    let (ev_tx, mut ev_rx) = tmpsc::unbounded_channel::<AudioEv>();
    std::thread::spawn(move || audio_thread(cmd_rx, ev_tx));

    // 单一写出:命令响应 + 事件都汇到这里串行写回,避免并发写乱帧
    let (out_tx, mut out_rx) = tmpsc::unbounded_channel::<String>();
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

    let ev_out = out_tx.clone();
    tokio::spawn(async move {
        while let Some(e) = ev_rx.recv().await {
            let _ = ev_out.send(e.to_ndjson());
        }
    });

    let debug = std::env::var("DECKY_MUSIC_DEBUG").is_ok(); // release 下不发 debug 日志

    // NDJSON:每条一行 {json}\n,UTF-8,单条 ≤ 1 MiB
    while let Some(line) = lines.next_line().await? {
        let req = match protocol::parse_request(&line) {
            Ok(r) => r,
            // 解析失败拿不到 id → 记录并丢弃(协议 v1 规则)
            Err(e) => {
                let _ = out_tx.send(log_json(
                    LogLevel::Warn,
                    "protocol",
                    &format!("bad request: {}", e.0),
                ));
                continue;
            }
        };
        if debug {
            let _ = out_tx.send(log_json(LogLevel::Debug, "cmd", &req.cmd));
        }
        let resp = handle_request(&cmd_tx, &out_tx, req).await;
        let _ = out_tx.send(resp);
    }
    Ok(())
}

async fn handle_request(
    cmd_tx: &mpsc::Sender<AudioCmd>,
    out_tx: &tmpsc::UnboundedSender<String>,
    req: protocol::Request,
) -> String {
    match req.cmd.as_str() {
        "load" => match protocol::parse_args::<protocol::LoadArgs>(&req) {
            // 不记 URL(含限时 vkey,避免泄漏);只打开响应头,音频数据由 rodio 按需读取。
            Ok(a) => match open_http_stream(a.url).await {
                Ok(stream) => {
                    let msg = if stream.range_supported() {
                        "stream opened with range"
                    } else {
                        "stream opened without range"
                    };
                    let _ = out_tx.send(log_json(LogLevel::Info, "load", msg));
                    send(cmd_tx, AudioCmd::Load(Box::new(stream)), req.id)
                }
                Err(()) => {
                    let _ = out_tx.send(log_json(LogLevel::Error, "load", "stream open failed"));
                    protocol::err(req.id, ErrorCode::FetchFailed, "stream open failed")
                }
            },
            Err(_) => protocol::err(req.id, ErrorCode::MissingField, "url required"),
        },
        "pause" => send(cmd_tx, AudioCmd::Pause, req.id),
        "resume" => send(cmd_tx, AudioCmd::Resume, req.id),
        "stop" => send(cmd_tx, AudioCmd::Stop, req.id),
        "volume" => match protocol::parse_args::<protocol::VolumeArgs>(&req) {
            Ok(a) => send(cmd_tx, AudioCmd::Volume(a.val as f32), req.id),
            Err(_) => protocol::err(req.id, ErrorCode::InvalidRequest, "bad volume args"),
        },
        "seek" => match protocol::parse_args::<protocol::SeekArgs>(&req) {
            Ok(a) => send(cmd_tx, AudioCmd::Seek(a.sec), req.id),
            Err(_) => protocol::err(req.id, ErrorCode::InvalidRequest, "bad seek args"),
        },
        _ => protocol::err(req.id, ErrorCode::UnknownCmd, "unknown cmd"),
    }
}

fn send(tx: &mpsc::Sender<AudioCmd>, c: AudioCmd, id: u64) -> String {
    match tx.send(c) {
        Ok(_) => protocol::ok_empty(id),
        Err(_) => protocol::err(id, ErrorCode::AudioThreadGone, "audio thread gone"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::sync::mpsc::{self, TryRecvError};

    async fn dispatch(cmd: &str, id: u64, args: Value) -> (Value, mpsc::Receiver<AudioCmd>) {
        let (cmd_tx, cmd_rx) = mpsc::channel();
        let (out_tx, _out_rx) = tmpsc::unbounded_channel();
        let resp = handle_request(
            &cmd_tx,
            &out_tx,
            protocol::Request {
                id,
                cmd: cmd.to_string(),
                args,
            },
        )
        .await;

        (serde_json::from_str(&resp).unwrap(), cmd_rx)
    }

    fn assert_no_audio_cmd(rx: &mpsc::Receiver<AudioCmd>) {
        assert!(matches!(
            rx.try_recv(),
            Err(TryRecvError::Empty | TryRecvError::Disconnected)
        ));
    }

    #[tokio::test]
    async fn volume_dispatches_audio_cmd_and_ok_response() {
        let (resp, cmd_rx) = dispatch("volume", 7, json!({"val": 0.25})).await;

        assert_eq!(resp, json!({"id": 7, "ok": true, "data": {}}));
        match cmd_rx.try_recv().unwrap() {
            AudioCmd::Volume(val) => assert_eq!(val, 0.25),
            _ => panic!("expected volume command"),
        }
        assert_no_audio_cmd(&cmd_rx);
    }

    #[tokio::test]
    async fn seek_dispatches_audio_cmd() {
        let (resp, cmd_rx) = dispatch("seek", 8, json!({"sec": 12.5})).await;

        assert_eq!(resp, json!({"id": 8, "ok": true, "data": {}}));
        match cmd_rx.try_recv().unwrap() {
            AudioCmd::Seek(sec) => assert_eq!(sec, 12.5),
            _ => panic!("expected seek command"),
        }
        assert_no_audio_cmd(&cmd_rx);
    }

    #[tokio::test]
    async fn bad_args_return_invalid_request_without_audio_cmd() {
        for (cmd, args) in [
            ("volume", json!({"val": "loud"})),
            ("seek", json!({"sec": "later"})),
        ] {
            let (resp, cmd_rx) = dispatch(cmd, 9, args).await;

            assert_eq!(
                resp,
                json!({"id": 9, "ok": false, "error": {"code": "invalid_request", "message": format!("bad {cmd} args")}})
            );
            assert_no_audio_cmd(&cmd_rx);
        }
    }

    #[tokio::test]
    async fn unknown_command_returns_unknown_cmd_without_audio_cmd() {
        let (resp, cmd_rx) = dispatch("shuffle", 10, json!({})).await;

        assert_eq!(
            resp,
            json!({"id": 10, "ok": false, "error": {"code": "unknown_cmd", "message": "unknown cmd"}})
        );
        assert_no_audio_cmd(&cmd_rx);
    }
}
