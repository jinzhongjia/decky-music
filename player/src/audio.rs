use std::sync::mpsc;
use std::time::Duration;

use serde_json::json;
use tokio::sync::mpsc as tmpsc;

use crate::logging::{log_json, LogLevel};
use crate::protocol::{self, ErrorCode};
use crate::stream::HttpStream;
use crate::util::epoch_ms;

pub(crate) enum AudioCmd {
    Load(Box<HttpStream>),
    Pause,
    Resume,
    Volume(f32),
    Seek(f64),
    Stop,
}

/// 上报给 bridge 的事件,序列化成 NDJSON(协议 v1 event / log 格式)。
pub(crate) enum AudioEv {
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

impl AudioEv {
    pub(crate) fn to_ndjson(&self) -> String {
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
pub(crate) fn audio_thread(rx: mpsc::Receiver<AudioCmd>, ev: tmpsc::UnboundedSender<AudioEv>) {
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
            Ok(AudioCmd::Load(stream)) => {
                match rodio::Sink::try_new(&handle)
                    .map_err(|e| e.to_string())
                    .and_then(|s| {
                        rodio::Decoder::new(stream)
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
                    if s.try_seek(Duration::from_secs_f64(sec.max(0.0))).is_err() {
                        let _ = ev.send(AudioEv::Error {
                            code: ErrorCode::SeekFailed,
                            message: "seek failed".into(),
                        });
                    }
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
