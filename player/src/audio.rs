use std::sync::mpsc;
use std::time::Duration;

use rodio::Source;
use serde_json::json;
use tokio::sync::mpsc as tmpsc;

use crate::logging::{log_json, LogLevel};
use crate::protocol::{self, ErrorCode};
use crate::stream::{HttpStream, StreamProbe};
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

/// 周期位置锚点间隔:音频欠载(缓冲停顿)时真实位置落后,UI 墙钟插值会悄悄跑偏;
/// 播放中定期重报 pos,把漂移上限压到一个间隔内。
const POS_ANCHOR_INTERVAL: Duration = Duration::from_secs(3);

/// 淡入淡出:消除切歌/暂停的硬切爆音。起播淡入走 FadeIn 源适配器(采样级),
/// 收尾淡出走音量斜坡(旧曲已在 sink 里,只能从外面拉音量)。
const FADE_IN: Duration = Duration::from_millis(300);
const FADE_OUT: Duration = Duration::from_millis(200);
const FADE_STEPS: u32 = 20;

/// 音量斜坡。在音频线程内小步阻塞,总时长 ≤ FADE_OUT(低于 250ms 命令轮询间隔,
/// 后续命令最多晚这么点处理,听感无感知)。
fn fade(sink: &rodio::Player, from: f32, to: f32, dur: Duration) {
    for i in 1..=FADE_STEPS {
        let t = i as f32 / FADE_STEPS as f32;
        sink.set_volume(from + (to - from) * t);
        std::thread::sleep(dur / FADE_STEPS);
    }
}

/// 旧曲收尾:仍在出声则先淡出,再由调用方丢弃/暂停。
fn fade_out_playing(sink: &Option<rodio::Player>, volume: f32) {
    if let Some(s) = sink {
        if !s.empty() && !s.is_paused() {
            fade(s, volume, 0.0, FADE_OUT);
        }
    }
}

/// 拥有 OutputStream + Sink 的专用线程。用 recv_timeout 轮询:平时睡,到点醒来查是否播完。
pub(crate) fn audio_thread(rx: mpsc::Receiver<AudioCmd>, ev: tmpsc::UnboundedSender<AudioEv>) {
    let device_sink = match rodio::DeviceSinkBuilder::open_default_sink() {
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
    let mut sink: Option<rodio::Player> = None;
    // 流状态探针:与 sink 同生命周期。rodio 解码器把流的 IO 错误静默吞成 EOF,
    // sink 放空时必须回查流是否带错死亡,否则中途断流会被误报成 ended 提前切歌。
    let mut probe: Option<StreamProbe> = None;
    let mut active = false; // 是否有在播的曲子(用于判定 ended)
    let mut last_anchor = std::time::Instant::now(); // 上次位置锚点(Playing 事件)时刻

    // 用户音量,线程内记账:新 sink 按它初始化(rodio 默认 1.0,不存则每次换歌音量跳回 100%),
    // 淡入淡出斜坡也以它为顶。
    let mut volume: f32 = 1.0;

    loop {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(AudioCmd::Load(stream)) => {
                let stream_probe = stream.probe();
                match rodio::Decoder::new(*stream) {
                    Ok(d) => {
                        fade_out_playing(&sink, volume); // 换歌不硬切
                        let s = rodio::Player::connect_new(device_sink.mixer());
                        s.set_volume(volume);
                        s.append(d.fade_in(FADE_IN));
                        sink = Some(s);
                        probe = Some(stream_probe);
                        active = true;
                        last_anchor = std::time::Instant::now();
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
                    if !s.empty() && !s.is_paused() {
                        fade(s, volume, 0.0, FADE_OUT);
                    }
                    s.pause();
                    s.set_volume(volume); // 斜坡拉到 0 后复位,resume 淡入再从 0 起
                    let _ = ev.send(AudioEv::Paused {
                        pos: s.get_pos().as_secs_f64(),
                    });
                }
            }
            Ok(AudioCmd::Resume) => {
                if let Some(s) = &sink {
                    s.set_volume(0.0);
                    s.play();
                    fade(s, 0.0, volume, FADE_OUT);
                    last_anchor = std::time::Instant::now();
                    let _ = ev.send(AudioEv::Playing {
                        pos: s.get_pos().as_secs_f64(),
                    });
                }
            }
            Ok(AudioCmd::Volume(v)) => {
                volume = v.clamp(0.0, 1.0);
                if let Some(s) = &sink {
                    s.set_volume(volume);
                }
            }
            Ok(AudioCmd::Seek(sec)) => {
                if let Some(s) = &sink {
                    if s.try_seek(Duration::from_secs_f64(sec.max(0.0))).is_err() {
                        let _ = ev.send(AudioEv::Error {
                            code: ErrorCode::SeekFailed,
                            message: "seek failed".into(),
                        });
                    } else if !s.is_paused() {
                        // seek 后立刻重锚:其它 UI 面(非发起方)才能同步到新位置
                        last_anchor = std::time::Instant::now();
                        let _ = ev.send(AudioEv::Playing {
                            pos: s.get_pos().as_secs_f64(),
                        });
                    }
                }
            }
            Ok(AudioCmd::Stop) => {
                fade_out_playing(&sink, volume);
                sink = None;
                probe = None;
                active = false;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // 播完检测:曾在播 && sink 空了。先回查流死因 —— 解码器把 IO 错误
                // 静默吞成 EOF,流带错死亡必须报 error(bridge 落日志 + UI 横幅),
                // 报 ended 会被当"播完"自动切歌(即"没播完就下一曲"的根因)。
                if active {
                    if let Some(s) = &sink {
                        if s.empty() {
                            active = false;
                            match probe.as_ref().and_then(StreamProbe::failure) {
                                Some(reason) => {
                                    let _ = ev.send(AudioEv::Error {
                                        code: ErrorCode::FetchFailed,
                                        message: format!("stream died mid-play: {reason}"),
                                    });
                                }
                                None => {
                                    let _ = ev.send(AudioEv::Ended);
                                }
                            }
                        } else if !s.is_paused() && last_anchor.elapsed() >= POS_ANCHOR_INTERVAL {
                            // 周期锚点:校准 UI 墙钟插值(缓冲停顿造成的漂移 ≤ 一个间隔)
                            last_anchor = std::time::Instant::now();
                            let _ = ev.send(AudioEv::Playing {
                                pos: s.get_pos().as_secs_f64(),
                            });
                        }
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}
