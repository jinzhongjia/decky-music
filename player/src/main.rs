//! player:拿 URL → HTTP 拉流 → 解码 → 推 PipeWire;上报进度/结束。
//!
//! 入口: `player --socket <path>`。bridge 作 server,player 连入;收 NDJSON 命令、
//! 发 NDJSON 事件。控制面命令:load / pause / resume / volume / seek / stop。
//!
//! rodio 的 OutputStream/Sink 是 !Send,不能跨 tokio await,所以音频跑在专用 OS 线程上,
//! 与 tokio 侧用 channel 通信。

use std::io::Cursor;
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc as tmpsc;

mod logging;
mod protocol;
use logging::{log_json, LogLevel};
use protocol::ErrorCode;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let socket = arg("--socket").expect("--socket <path> required");
    tokio::runtime::Runtime::new()?.block_on(socket_loop(&socket))
}

// ---- 音频线程 ----

enum AudioCmd {
    Load(Vec<u8>),
    Pause,
    Resume,
    Volume(f32),
    Seek(f64),
    Stop,
}

/// 上报给 bridge 的事件,序列化成 NDJSON(协议 v1 event / log 格式)。
enum AudioEv {
    Playing {
        pos: f64,
    },
    Paused {
        pos: f64,
    },
    Ended,
    Error {
        code: ErrorCode,
        message: String,
    },
    Log {
        level: LogLevel,
        place: &'static str,
        msg: String,
    },
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl AudioEv {
    fn to_ndjson(&self) -> String {
        match self {
            // wall_ms + pos:UI 本地插值进度(pos + (now - wall_ms))
            AudioEv::Playing { pos } => protocol::event(
                "player",
                "playing",
                json!({"pos": pos, "wall_ms": epoch_ms()}),
            ),
            AudioEv::Paused { pos } => protocol::event("player", "paused", json!({"pos": pos})),
            AudioEv::Ended => protocol::event("player", "ended", json!({})),
            AudioEv::Error { code, message } => protocol::event(
                "player",
                "error",
                json!({"code": code.as_str(), "message": message}),
            ),
            AudioEv::Log { level, place, msg } => log_json(*level, place, msg),
        }
    }
}

/// 拥有 OutputStream + Sink 的专用线程。用 recv_timeout 轮询:平时睡,到点醒来查是否播完。
fn audio_thread(rx: mpsc::Receiver<AudioCmd>, ev: tmpsc::UnboundedSender<AudioEv>) {
    let (_stream, handle) = match rodio::OutputStream::try_default() {
        Ok(v) => v,
        Err(e) => {
            let _ = ev.send(AudioEv::Error {
                code: ErrorCode::AudioDeviceFailed,
                message: format!("open audio device: {e}"),
            });
            return;
        }
    };
    let _ = ev.send(AudioEv::Log {
        level: LogLevel::Info,
        place: "audio",
        msg: "default audio device opened".into(),
    });
    let mut sink: Option<rodio::Sink> = None;
    let mut active = false; // 是否有在播的曲子(用于判定 ended)

    loop {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(AudioCmd::Load(bytes)) => {
                match rodio::Sink::try_new(&handle)
                    .map_err(|e| e.to_string())
                    .and_then(|s| {
                        rodio::Decoder::new(Cursor::new(bytes))
                            .map(|d| {
                                s.append(d);
                                s
                            })
                            .map_err(|e| e.to_string())
                    }) {
                    Ok(s) => {
                        sink = Some(s);
                        active = true;
                        let _ = ev.send(AudioEv::Playing { pos: 0.0 });
                    }
                    Err(e) => {
                        let _ = ev.send(AudioEv::Error {
                            code: ErrorCode::DecodeFailed,
                            message: format!("decode/play: {e}"),
                        });
                    }
                }
            }
            Ok(AudioCmd::Pause) => {
                if let Some(s) = &sink {
                    s.pause();
                    let _ = ev.send(AudioEv::Paused {
                        pos: s.get_pos().as_secs_f64(),
                    });
                }
            }
            Ok(AudioCmd::Resume) => {
                if let Some(s) = &sink {
                    s.play();
                    let _ = ev.send(AudioEv::Playing {
                        pos: s.get_pos().as_secs_f64(),
                    });
                }
            }
            Ok(AudioCmd::Volume(v)) => {
                if let Some(s) = &sink {
                    s.set_volume(v.clamp(0.0, 1.0));
                }
            }
            Ok(AudioCmd::Seek(sec)) => {
                if let Some(s) = &sink {
                    // ponytail: best-effort;流式解码器可能不支持 seek,失败就忽略。
                    let _ = s.try_seek(Duration::from_secs_f64(sec.max(0.0)));
                }
            }
            Ok(AudioCmd::Stop) => {
                sink = None;
                active = false;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // 播完检测:曾在播 && sink 空了 → ended(只报一次)
                if active {
                    if let Some(s) = &sink {
                        if s.empty() {
                            active = false;
                            let _ = ev.send(AudioEv::Ended);
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

// ---- socket 侧 ----

async fn socket_loop(socket: &str) -> Result<(), Box<dyn std::error::Error>> {
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
    // 事件转发到写出
    let ev_out = out_tx.clone();
    tokio::spawn(async move {
        while let Some(e) = ev_rx.recv().await {
            let _ = ev_out.send(e.to_ndjson());
        }
    });

    let http = reqwest::Client::builder().build()?;
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
        let resp = match req.cmd.as_str() {
            "load" => match protocol::parse_args::<protocol::LoadArgs>(&req) {
                // ponytail: 整首拉进内存再播;流式边下边播留后续。不记 URL(含限时 vkey,避免泄漏)
                Ok(a) => match fetch(&http, &a.url).await {
                    Ok(bytes) => {
                        let _ = out_tx.send(log_json(
                            LogLevel::Info,
                            "load",
                            &format!("fetched {} bytes", bytes.len()),
                        ));
                        let _ = cmd_tx.send(AudioCmd::Load(bytes));
                        protocol::ok_empty(req.id)
                    }
                    Err(e) => {
                        let _ = out_tx.send(log_json(
                            LogLevel::Error,
                            "load",
                            &format!("fetch failed: {e}"),
                        ));
                        protocol::err(req.id, ErrorCode::FetchFailed, &e.to_string())
                    }
                },
                Err(_) => protocol::err(req.id, ErrorCode::MissingField, "url required"),
            },
            "pause" => send(&cmd_tx, AudioCmd::Pause, req.id),
            "resume" => send(&cmd_tx, AudioCmd::Resume, req.id),
            "stop" => send(&cmd_tx, AudioCmd::Stop, req.id),
            "volume" => match protocol::parse_args::<protocol::VolumeArgs>(&req) {
                Ok(a) => send(&cmd_tx, AudioCmd::Volume(a.val as f32), req.id),
                Err(_) => protocol::err(req.id, ErrorCode::InvalidRequest, "bad volume args"),
            },
            "seek" => match protocol::parse_args::<protocol::SeekArgs>(&req) {
                Ok(a) => send(&cmd_tx, AudioCmd::Seek(a.sec), req.id),
                Err(_) => protocol::err(req.id, ErrorCode::InvalidRequest, "bad seek args"),
            },
            _ => protocol::err(req.id, ErrorCode::UnknownCmd, "unknown cmd"),
        };
        let _ = out_tx.send(resp);
    }
    Ok(())
}

async fn fetch(http: &reqwest::Client, url: &str) -> reqwest::Result<Vec<u8>> {
    Ok(http
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?
        .to_vec())
}

fn send(tx: &mpsc::Sender<AudioCmd>, c: AudioCmd, id: u64) -> String {
    match tx.send(c) {
        Ok(_) => protocol::ok_empty(id),
        Err(_) => protocol::err(id, ErrorCode::AudioThreadGone, "audio thread gone"),
    }
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
