use std::sync::mpsc;
use std::time::Duration;

use rodio::Source;
use serde_json::json;
use tokio::sync::mpsc as tmpsc;

use crate::protocol::{self, ErrorCode};
use crate::protocol::{log_json, LogLevel};
use crate::stream::{HttpRangeReader, StreamProbe};
use crate::util::epoch_ms;

pub(crate) enum AudioCmd {
    Load(Box<HttpRangeReader>),
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
    /// Paused long enough that the player released the sink and must reload on resume.
    Unloaded {
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
    // 仅供 MPRIS(不回传 bridge):seek 后的新位置 / 应用后的音量。socket.rs 的事件泵消费后不转发。
    Seeked {
        pos: f64,
    },
    Volume {
        val: f32,
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
            AudioEv::Unloaded { pos } => protocol::event("player", "unloaded", json!({"pos": pos})),
            AudioEv::Ended => protocol::event("player", "ended", json!({})),
            AudioEv::Error { code, message } => {
                protocol::event("player", "error", json!({"code": code, "message": message}))
            }
            AudioEv::Log { level, place, msg } => log_json(*level, place, msg),
            // MPRIS-only:事件泵消费后 continue,不走 to_ndjson;给个空串保持 match 穷尽。
            AudioEv::Seeked { .. } | AudioEv::Volume { .. } => String::new(),
        }
    }
}

/// 周期位置锚点间隔:音频欠载(缓冲停顿)时真实位置落后,UI 墙钟插值会悄悄跑偏;
/// 播放中定期重报 pos,把漂移上限压到一个间隔内。
const POS_ANCHOR_INTERVAL: Duration = Duration::from_secs(3);
const ACTIVE_POLL_INTERVAL: Duration = Duration::from_millis(250);
const IDLE_PAUSE_TIMEOUT: Duration = Duration::from_secs(30);

/// 淡入淡出:消除切歌/暂停的硬切爆音。起播淡入走 FadeIn 源适配器(采样级),
/// 收尾淡出走音量斜坡(旧曲已在 sink 里,只能从外面拉音量)。
const FADE_IN: Duration = Duration::from_millis(300);
const FADE_OUT: Duration = Duration::from_millis(200);
const FADE_STEPS: u32 = 20;

struct AudioState {
    device_sink: Option<rodio::MixerDeviceSink>,
    sink: Option<rodio::Player>,
    probe: Option<StreamProbe>,
    active: bool,
    last_anchor: std::time::Instant,
    paused_since: Option<std::time::Instant>,
    volume: f32,
}

impl AudioState {
    fn new() -> Self {
        Self {
            device_sink: None,
            sink: None,
            probe: None,
            active: false,
            last_anchor: std::time::Instant::now(),
            paused_since: None,
            volume: 1.0,
        }
    }
}

/// 音量斜坡。在音频线程内小步阻塞,总时长 ≤ FADE_OUT(低于 250ms 命令轮询间隔,
/// 后续命令最多晚这么点处理,听感无感知)。
fn fade(sink: &rodio::Player, from: f32, to: f32, dur: Duration) {
    for i in 1..=FADE_STEPS {
        let t = i as f32 / FADE_STEPS as f32;
        sink.set_volume(from + (to - from) * t);
        std::thread::sleep(dur / FADE_STEPS);
    }
}

fn fade_out_playing(sink: &Option<rodio::Player>, volume: f32) {
    if let Some(s) = sink {
        if !s.empty() && !s.is_paused() {
            fade(s, volume, 0.0, FADE_OUT);
        }
    }
}

fn ensure_device(state: &mut AudioState, ev: &tmpsc::UnboundedSender<AudioEv>) -> bool {
    if state.device_sink.is_some() {
        return true;
    }
    match rodio::DeviceSinkBuilder::open_default_sink() {
        Ok(device_sink) => {
            state.device_sink = Some(device_sink);
            let _ = ev.send(AudioEv::Log {
                level: LogLevel::Info,
                place: "audio",
                msg: "default audio device opened".into(),
            });
            true
        }
        Err(e) => {
            let _ = ev.send(AudioEv::Error {
                code: ErrorCode::AudioDeviceFailed,
                message: format!("open audio device: {e}"),
            });
            false
        }
    }
}

fn load_stream(
    state: &mut AudioState,
    stream: HttpRangeReader,
    ev: &tmpsc::UnboundedSender<AudioEv>,
) {
    if !ensure_device(state, ev) {
        return;
    }
    let probe = stream.probe();
    match rodio::Decoder::new(stream) {
        Ok(decoder) => {
            fade_out_playing(&state.sink, state.volume);
            let sink = rodio::Player::connect_new(
                state
                    .device_sink
                    .as_ref()
                    .expect("device sink initialized")
                    .mixer(),
            );
            sink.set_volume(state.volume);
            sink.append(decoder.fade_in(FADE_IN));
            state.sink = Some(sink);
            state.probe = Some(probe);
            state.active = true;
            state.last_anchor = std::time::Instant::now();
            state.paused_since = None;
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

fn pause(state: &mut AudioState, ev: &tmpsc::UnboundedSender<AudioEv>) {
    if let Some(sink) = &state.sink {
        if !sink.empty() && !sink.is_paused() {
            fade(sink, state.volume, 0.0, FADE_OUT);
        }
        sink.pause();
        sink.set_volume(state.volume);
        state.paused_since = Some(std::time::Instant::now());
        let _ = ev.send(AudioEv::Paused {
            pos: sink.get_pos().as_secs_f64(),
        });
    }
}

fn resume(state: &mut AudioState, ev: &tmpsc::UnboundedSender<AudioEv>) {
    if let Some(sink) = &state.sink {
        sink.set_volume(0.0);
        sink.play();
        fade(sink, 0.0, state.volume, FADE_OUT);
        state.last_anchor = std::time::Instant::now();
        state.paused_since = None;
        let _ = ev.send(AudioEv::Playing {
            pos: sink.get_pos().as_secs_f64(),
        });
    }
}

fn set_volume(state: &mut AudioState, value: f32, ev: &tmpsc::UnboundedSender<AudioEv>) {
    state.volume = value.clamp(0.0, 1.0);
    if let Some(sink) = &state.sink {
        sink.set_volume(state.volume);
    }
    let _ = ev.send(AudioEv::Volume { val: state.volume });
}

fn seek(state: &mut AudioState, sec: f64, ev: &tmpsc::UnboundedSender<AudioEv>) {
    if let Some(sink) = &state.sink {
        if sink
            .try_seek(Duration::from_secs_f64(sec.max(0.0)))
            .is_err()
        {
            let _ = ev.send(AudioEv::Error {
                code: ErrorCode::SeekFailed,
                message: "seek failed".into(),
            });
        } else {
            let pos = sink.get_pos().as_secs_f64();
            let _ = ev.send(AudioEv::Seeked { pos });
            if !sink.is_paused() {
                state.last_anchor = std::time::Instant::now();
                let _ = ev.send(AudioEv::Playing { pos });
            }
        }
    }
}

fn stop(state: &mut AudioState) {
    fade_out_playing(&state.sink, state.volume);
    state.sink = None;
    state.probe = None;
    state.device_sink = None;
    state.active = false;
    state.paused_since = None;
}

fn poll_timeout(state: &AudioState) -> Duration {
    match state.paused_since {
        Some(paused) => IDLE_PAUSE_TIMEOUT.saturating_sub(paused.elapsed()),
        None if state.active => ACTIVE_POLL_INTERVAL,
        None => Duration::from_secs(3600),
    }
}

fn unload_idle_sink(state: &mut AudioState, ev: &tmpsc::UnboundedSender<AudioEv>) {
    let pos = state
        .sink
        .as_ref()
        .map_or(0.0, |sink| sink.get_pos().as_secs_f64());
    stop(state);
    let _ = ev.send(AudioEv::Unloaded { pos });
}

fn poll_playback(state: &mut AudioState, ev: &tmpsc::UnboundedSender<AudioEv>) {
    if state
        .paused_since
        .is_some_and(|paused| paused.elapsed() >= IDLE_PAUSE_TIMEOUT)
    {
        unload_idle_sink(state, ev);
        return;
    }
    if !state.active {
        return;
    }
    let Some(sink) = &state.sink else {
        return;
    };
    if sink.empty() {
        state.active = false;
        match state.probe.as_ref().and_then(StreamProbe::failure) {
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
    } else if !sink.is_paused() && state.last_anchor.elapsed() >= POS_ANCHOR_INTERVAL {
        state.last_anchor = std::time::Instant::now();
        let _ = ev.send(AudioEv::Playing {
            pos: sink.get_pos().as_secs_f64(),
        });
    }
}

/// 拥有 OutputStream + Sink 的专用线程。暂停后不再 4Hz 轮询;30 秒后释放 PipeWire sink。
pub(crate) fn audio_thread(rx: mpsc::Receiver<AudioCmd>, ev: tmpsc::UnboundedSender<AudioEv>) {
    let mut state = AudioState::new();
    loop {
        match rx.recv_timeout(poll_timeout(&state)) {
            Ok(AudioCmd::Load(stream)) => load_stream(&mut state, *stream, &ev),
            Ok(AudioCmd::Pause) => pause(&mut state, &ev),
            Ok(AudioCmd::Resume) => resume(&mut state, &ev),
            Ok(AudioCmd::Volume(value)) => set_volume(&mut state, value, &ev),
            Ok(AudioCmd::Seek(sec)) => seek(&mut state, sec, &ev),
            Ok(AudioCmd::Stop) => stop(&mut state),
            Err(mpsc::RecvTimeoutError::Timeout) => poll_playback(&mut state, &ev),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unloaded_event_carries_resume_position() {
        let value: serde_json::Value =
            serde_json::from_str(&AudioEv::Unloaded { pos: 42.5 }.to_ndjson()).unwrap();
        assert_eq!(
            value,
            json!({"ev":"player","type":"unloaded","data":{"pos":42.5}})
        );
    }

    #[test]
    fn idle_state_does_not_poll_at_active_cadence() {
        assert_eq!(poll_timeout(&AudioState::new()), Duration::from_secs(3600));
    }
}
