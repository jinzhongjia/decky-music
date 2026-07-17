use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc as tmpsc;

use crate::audio::{audio_thread, AudioCmd, AudioEv};
use crate::logging::{log_json, LogLevel};
use crate::mpris;
use crate::protocol::{self, ErrorCode};
use crate::stream::{open_http_stream, OpenError};

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

    // MPRIS2:连 session bus 暴露 now-playing + 控制。失败降级 None(记 warn),绝不阻塞出声。
    let mpris = mpris::start(out_tx.clone()).await;

    let ev_out = out_tx.clone();
    let ev_mpris = mpris.clone();
    tokio::spawn(async move {
        while let Some(e) = ev_rx.recv().await {
            if let Some(m) = &ev_mpris {
                match &e {
                    AudioEv::Playing { pos } => mpris::apply_playing(m, *pos).await,
                    AudioEv::Paused { pos } => mpris::apply_paused(m, *pos).await,
                    AudioEv::Ended | AudioEv::Error { .. } => mpris::apply_stopped(m).await,
                    AudioEv::Seeked { pos } => mpris::apply_seeked(m, *pos).await,
                    AudioEv::Volume { val } => mpris::apply_volume(m, *val as f64).await,
                    AudioEv::Log { .. } => {}
                }
            }
            // Seeked / Volume 仅供 MPRIS,不回传 bridge(bridge 已知或不关心)
            if matches!(e, AudioEv::Seeked { .. } | AudioEv::Volume { .. }) {
                continue;
            }
            let _ = ev_out.send(e.to_ndjson());
        }
    });

    let debug = std::env::var("DECKY_MUSIC_DEBUG").is_ok(); // release 下不发 debug 日志

    // load 代次:每来一个 load(或 stop)自增;后台打开完成时代次已过 → 丢弃,
    // 迟到的旧 load 绝不夺播(修「UI 显示与实际播放不一致」)。
    let load_gen = Arc::new(AtomicU64::new(0));

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
        // load 后台化:慢 CDN 打开(可 20s+)不阻塞命令循环,pause/next/新 load 即时处理
        if req.cmd == "load" {
            spawn_load(&load_gen, &cmd_tx, &out_tx, req);
            continue;
        }
        // meta:更新 MPRIS 展示态,不碰音频线程(mpris 不可用时静默 ok)
        if req.cmd == "meta" {
            let resp = match protocol::parse_args::<protocol::MetaArgs>(&req) {
                Ok(a) => {
                    if let Some(m) = &mpris {
                        mpris::apply_meta(m, a).await;
                    }
                    protocol::ok_empty(req.id)
                }
                Err(_) => protocol::err(req.id, ErrorCode::MissingField, "bad meta args"),
            };
            let _ = out_tx.send(resp);
            continue;
        }
        if req.cmd == "stop" {
            load_gen.fetch_add(1, Ordering::SeqCst); // 作废在途的旧 load 打开
        }
        let resp = handle_request(&cmd_tx, req).await;
        let _ = out_tx.send(resp);
    }
    Ok(())
}

/// load 后台任务:开流成功且代次未过 → 交音频线程;代次已过(有更新的 load/stop)→ 丢弃。
fn spawn_load(
    load_gen: &Arc<AtomicU64>,
    cmd_tx: &mpsc::Sender<AudioCmd>,
    out_tx: &tmpsc::UnboundedSender<String>,
    req: protocol::Request,
) {
    let gen = load_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let (gen_ref, cmd_tx, out_tx) = (Arc::clone(load_gen), cmd_tx.clone(), out_tx.clone());
    tokio::spawn(async move {
        let resp = match protocol::parse_args::<protocol::LoadArgs>(&req) {
            // 不记 URL(含限时 vkey,避免泄漏);只打开响应头,音频数据由 rodio 按需读取。
            Ok(a) => match open_http_stream(a.url).await {
                Ok(stream) if gen_ref.load(Ordering::SeqCst) == gen => {
                    let msg = if stream.range_supported() {
                        "stream opened with range"
                    } else {
                        "stream opened without range"
                    };
                    let _ = out_tx.send(log_json(LogLevel::Info, "load", msg));
                    send(&cmd_tx, AudioCmd::Load(Box::new(stream)), req.id)
                }
                Ok(_) => {
                    let _ = out_tx.send(log_json(LogLevel::Warn, "load", "superseded, dropped"));
                    protocol::err(req.id, ErrorCode::Superseded, "superseded by newer load")
                }
                Err(e) => {
                    let (code, msg) = match e {
                        OpenError::Timeout => (
                            ErrorCode::FetchTimeout,
                            "stream open timed out (slow network)",
                        ),
                        OpenError::Network => (ErrorCode::FetchFailed, "stream open failed"),
                    };
                    let _ = out_tx.send(log_json(LogLevel::Error, "load", msg));
                    protocol::err(req.id, code, msg)
                }
            },
            Err(_) => protocol::err(req.id, ErrorCode::MissingField, "url required"),
        };
        let _ = out_tx.send(resp);
    });
}

async fn handle_request(cmd_tx: &mpsc::Sender<AudioCmd>, req: protocol::Request) -> String {
    match req.cmd.as_str() {
        // "load" 不在此处:在 socket_loop 里 spawn 后台处理(见 spawn_load),不阻塞命令循环
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
        let resp = handle_request(
            &cmd_tx,
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
