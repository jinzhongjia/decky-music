//! MPRIS2 D-Bus 服务:把 player 的播放态 + bridge 下发的曲目元数据暴露到 `org.mpris.MediaPlayer2`,
//! 让桌面媒体控件 / 蓝牙耳机按键控制播放。
//!
//! 控制红线:所有控制动作(播放/暂停/上下曲/seek/音量/循环)**不在本地直接执行**,而是作为
//! `{"ev":"player","type":"control",...}` 事件上送 bridge —— bridge 是唯一真相源,与 UI callable
//! 走同一套命令回路(见 DESIGN §4),避免状态分叉。展示属性(状态/进度/音量)直接读 player 自身
//! 音频态,不往返 bridge。
//!
//! 线程模型:`Server`(zbus)是 Send+Sync,跑在 player 的多线程 tokio 上;共享态用 parking_lot
//! Mutex,临界区不跨 await。连不上 session bus(无 D-Bus / 无权限)→ 降级为 `None`,绝不阻塞出声。

use std::sync::Arc;

use mpris_server::zbus::{fdo, Result};
use mpris_server::{
    LoopStatus, Metadata, PlaybackRate, PlaybackStatus, PlayerInterface, Property, RootInterface,
    Server, Signal, Time, TrackId, Volume,
};
use parking_lot::Mutex;
use serde_json::json;
use tokio::sync::mpsc::UnboundedSender;

use crate::logging::{log_json, LogLevel};
use crate::protocol;
use crate::util::epoch_ms;

pub type MprisServer = Server<MprisImpl>;

/// player 暴露给 MPRIS 的可变态。字段是原语,Metadata 现算(避免 Metadata 所有权/克隆纠缠)。
struct MprisState {
    status: PlaybackStatus,
    pos: f64,       // 最近锚点位置(秒)
    wall_ms: u64,   // 该位置对应墙钟(ms);playing 时 position 据此插值
    length_us: i64, // 当前曲时长(微秒),0 = 未知
    volume: f64,
    // 元数据(bridge meta 命令下发)
    title: String,
    artist: String,
    album: String,
    art_url: String,
    track_id: String,
    can_next: bool,
    can_prev: bool,
    play_mode: String, // list_loop | single_loop | shuffle → LoopStatus/Shuffle
}

impl MprisState {
    fn new() -> Self {
        Self {
            status: PlaybackStatus::Stopped,
            pos: 0.0,
            wall_ms: 0,
            length_us: 0,
            volume: 1.0,
            title: String::new(),
            artist: String::new(),
            album: String::new(),
            art_url: String::new(),
            track_id: String::new(),
            can_next: false,
            can_prev: false,
            play_mode: "list_loop".into(),
        }
    }

    /// 当前位置(秒):playing 时按墙钟插值,夹在 [0, 时长]。与 UI 的进度插值同一算法。
    fn position_secs(&self) -> f64 {
        let mut p = self.pos;
        if self.status == PlaybackStatus::Playing && self.wall_ms > 0 {
            p += epoch_ms().saturating_sub(self.wall_ms) as f64 / 1000.0;
        }
        if self.length_us > 0 {
            p = p.min(self.length_us as f64 / 1_000_000.0);
        }
        p.max(0.0)
    }

    fn build_metadata(&self) -> Metadata {
        // mpris:trackid 必填(空曲用 NO_TRACK);其余字段为空则不写。
        let mut b = Metadata::builder().trackid(track_path(&self.track_id));
        if !self.title.is_empty() {
            b = b.title(self.title.clone());
        }
        if !self.artist.is_empty() {
            b = b.artist([self.artist.clone()]);
        }
        if !self.album.is_empty() {
            b = b.album(self.album.clone());
        }
        if !self.art_url.is_empty() {
            b = b.art_url(self.art_url.clone());
        }
        if self.length_us > 0 {
            b = b.length(Time::from_micros(self.length_us));
        }
        b.build()
    }
}

/// 歌曲 id → 合法 D-Bus 对象路径(mpris:trackid 要求)。非 `[A-Za-z0-9_]` 一律换成 `_`。
fn track_path(id: &str) -> TrackId {
    if id.is_empty() {
        return TrackId::NO_TRACK;
    }
    let mut s = String::from("/org/mpris/decky_music/track/");
    for c in id.chars() {
        s.push(if c.is_ascii_alphanumeric() || c == '_' {
            c
        } else {
            '_'
        });
    }
    TrackId::try_from(s).unwrap_or(TrackId::NO_TRACK)
}

// ponytail: LoopStatus(None/Track/Playlist) × Shuffle 与我们的三态 play_mode 是有损映射。
// 够桌面/耳机显示与切换即可;要精确保真再拆 loop 与 shuffle 两个独立状态。
fn loop_status_of(mode: &str) -> LoopStatus {
    match mode {
        "single_loop" => LoopStatus::Track,
        _ => LoopStatus::Playlist,
    }
}

/// D-Bus 接口实现:读态发属性,控制动作转 `control` 事件上送 bridge。
pub struct MprisImpl {
    state: Mutex<MprisState>,
    ctl: UnboundedSender<String>, // 复用 player→bridge 写出通道,发 control 事件
}

impl MprisImpl {
    fn send_control(&self, action: &str, value: Option<f64>, mode: Option<&str>) {
        let mut data = json!({ "action": action });
        if let Some(v) = value {
            data["value"] = json!(v);
        }
        if let Some(m) = mode {
            data["mode"] = json!(m);
        }
        let _ = self.ctl.send(protocol::event("player", "control", data));
    }
}

impl RootInterface for MprisImpl {
    async fn raise(&self) -> fdo::Result<()> {
        Ok(())
    }
    async fn quit(&self) -> fdo::Result<()> {
        Ok(())
    }
    async fn can_quit(&self) -> fdo::Result<bool> {
        Ok(false)
    }
    async fn fullscreen(&self) -> fdo::Result<bool> {
        Ok(false)
    }
    async fn set_fullscreen(&self, _: bool) -> Result<()> {
        Ok(())
    }
    async fn can_set_fullscreen(&self) -> fdo::Result<bool> {
        Ok(false)
    }
    async fn can_raise(&self) -> fdo::Result<bool> {
        Ok(false)
    }
    async fn has_track_list(&self) -> fdo::Result<bool> {
        Ok(false)
    }
    async fn identity(&self) -> fdo::Result<String> {
        Ok("Decky Music".into())
    }
    async fn desktop_entry(&self) -> fdo::Result<String> {
        Ok(String::new())
    }
    async fn supported_uri_schemes(&self) -> fdo::Result<Vec<String>> {
        Ok(vec![])
    }
    async fn supported_mime_types(&self) -> fdo::Result<Vec<String>> {
        Ok(vec![])
    }
}

impl PlayerInterface for MprisImpl {
    async fn next(&self) -> fdo::Result<()> {
        self.send_control("next", None, None);
        Ok(())
    }
    async fn previous(&self) -> fdo::Result<()> {
        self.send_control("prev", None, None);
        Ok(())
    }
    async fn pause(&self) -> fdo::Result<()> {
        self.send_control("pause", None, None);
        Ok(())
    }
    async fn play_pause(&self) -> fdo::Result<()> {
        self.send_control("playpause", None, None);
        Ok(())
    }
    async fn stop(&self) -> fdo::Result<()> {
        self.send_control("stop", None, None);
        Ok(())
    }
    async fn play(&self) -> fdo::Result<()> {
        self.send_control("play", None, None);
        Ok(())
    }

    async fn seek(&self, offset: Time) -> fdo::Result<()> {
        // MPRIS Seek 是相对偏移;player/bridge 用绝对 seek。取当前插值位置 + 偏移。
        let target = self.state.lock().position_secs() + offset.as_micros() as f64 / 1_000_000.0;
        self.send_control("seek", Some(target.max(0.0)), None);
        Ok(())
    }

    async fn set_position(&self, _track_id: TrackId, position: Time) -> fdo::Result<()> {
        // ponytail: 不校验 track_id 是否当前曲 —— 只有对当前曲 seek 才有意义,直接绝对定位。
        let sec = (position.as_micros() as f64 / 1_000_000.0).max(0.0);
        self.send_control("seek", Some(sec), None);
        Ok(())
    }

    async fn open_uri(&self, _uri: String) -> fdo::Result<()> {
        Err(fdo::Error::NotSupported("OpenUri not supported".into()))
    }

    async fn playback_status(&self) -> fdo::Result<PlaybackStatus> {
        Ok(self.state.lock().status)
    }
    async fn loop_status(&self) -> fdo::Result<LoopStatus> {
        Ok(loop_status_of(&self.state.lock().play_mode))
    }
    async fn set_loop_status(&self, loop_status: LoopStatus) -> Result<()> {
        let mode = match loop_status {
            LoopStatus::Track => "single_loop",
            _ => "list_loop",
        };
        self.send_control("play_mode", None, Some(mode));
        Ok(())
    }
    async fn rate(&self) -> fdo::Result<PlaybackRate> {
        Ok(1.0)
    }
    async fn set_rate(&self, _: PlaybackRate) -> Result<()> {
        Ok(())
    }
    async fn shuffle(&self) -> fdo::Result<bool> {
        Ok(self.state.lock().play_mode == "shuffle")
    }
    async fn set_shuffle(&self, shuffle: bool) -> Result<()> {
        let mode = if shuffle { "shuffle" } else { "list_loop" };
        self.send_control("play_mode", None, Some(mode));
        Ok(())
    }
    async fn metadata(&self) -> fdo::Result<Metadata> {
        Ok(self.state.lock().build_metadata())
    }
    async fn volume(&self) -> fdo::Result<Volume> {
        Ok(self.state.lock().volume)
    }
    async fn set_volume(&self, volume: Volume) -> Result<()> {
        self.send_control("volume", Some(volume.clamp(0.0, 1.0)), None);
        Ok(())
    }
    async fn position(&self) -> fdo::Result<Time> {
        Ok(Time::from_micros(
            (self.state.lock().position_secs() * 1_000_000.0) as i64,
        ))
    }
    async fn minimum_rate(&self) -> fdo::Result<PlaybackRate> {
        Ok(1.0)
    }
    async fn maximum_rate(&self) -> fdo::Result<PlaybackRate> {
        Ok(1.0)
    }
    async fn can_go_next(&self) -> fdo::Result<bool> {
        Ok(self.state.lock().can_next)
    }
    async fn can_go_previous(&self) -> fdo::Result<bool> {
        Ok(self.state.lock().can_prev)
    }
    async fn can_play(&self) -> fdo::Result<bool> {
        Ok(true)
    }
    async fn can_pause(&self) -> fdo::Result<bool> {
        Ok(true)
    }
    async fn can_seek(&self) -> fdo::Result<bool> {
        Ok(true)
    }
    async fn can_control(&self) -> fdo::Result<bool> {
        Ok(true)
    }
}

/// 建 MPRIS 服务并注册到 session bus。失败(无 bus / 无权限)→ 记 warn 返回 `None`,不影响播放。
pub async fn start(ctl: UnboundedSender<String>) -> Option<Arc<MprisServer>> {
    let imp = MprisImpl {
        state: Mutex::new(MprisState::new()),
        ctl: ctl.clone(),
    };
    // bus 名后缀须唯一且不以数字开头:decky_music.instance<pid>
    let suffix = format!("decky_music.instance{}", std::process::id());
    match Server::new(&suffix, imp).await {
        Ok(srv) => {
            let _ = ctl.send(log_json(
                LogLevel::Info,
                "mpris",
                "registered org.mpris.MediaPlayer2",
            ));
            Some(Arc::new(srv))
        }
        Err(e) => {
            let _ = ctl.send(log_json(
                LogLevel::Warn,
                "mpris",
                &format!("unavailable: {e}"),
            ));
            None
        }
    }
}

// ---- 态更新(socket.rs 侧调用;锁内构造 owned 值,await 时不持锁) ----

async fn apply_status(srv: &MprisServer, status: PlaybackStatus, pos: f64) {
    let changed = {
        let mut s = srv.imp().state.lock();
        s.pos = pos;
        s.wall_ms = epoch_ms();
        let changed = s.status != status;
        s.status = status;
        changed
    };
    // 位置锚点每次都更新(插值准);PlaybackStatus 只在真变化时发信号,避免每 3s 锚点刷屏。
    if changed {
        let _ = srv
            .properties_changed([Property::PlaybackStatus(status)])
            .await;
    }
}

pub async fn apply_playing(srv: &MprisServer, pos: f64) {
    apply_status(srv, PlaybackStatus::Playing, pos).await;
}

pub async fn apply_paused(srv: &MprisServer, pos: f64) {
    apply_status(srv, PlaybackStatus::Paused, pos).await;
}

pub async fn apply_stopped(srv: &MprisServer) {
    apply_status(srv, PlaybackStatus::Stopped, 0.0).await;
}

pub async fn apply_seeked(srv: &MprisServer, pos: f64) {
    {
        let mut s = srv.imp().state.lock();
        s.pos = pos;
        s.wall_ms = epoch_ms();
    }
    let _ = srv
        .emit(Signal::Seeked {
            position: Time::from_micros((pos * 1_000_000.0) as i64),
        })
        .await;
}

pub async fn apply_volume(srv: &MprisServer, volume: f64) {
    srv.imp().state.lock().volume = volume;
    let _ = srv.properties_changed([Property::Volume(volume)]).await;
}

/// bridge `meta` 命令:更新当前曲展示信息 + 可否上下曲,发 Metadata/CanGoNext/CanGoPrevious/
/// LoopStatus/Shuffle 变更。`clear` = 无当前曲(停止/清空队列)。
pub async fn apply_meta(srv: &MprisServer, m: protocol::MetaArgs) {
    let props = {
        let mut s = srv.imp().state.lock();
        if m.clear {
            s.title.clear();
            s.artist.clear();
            s.album.clear();
            s.art_url.clear();
            s.track_id.clear();
            s.length_us = 0;
            s.can_next = false;
            s.can_prev = false;
        } else {
            s.title = m.title;
            s.artist = m.artist;
            s.album = m.album;
            s.art_url = m.art_url;
            s.track_id = m.track_id;
            s.length_us = (m.length_ms.max(0.0) * 1000.0) as i64;
            s.can_next = m.can_next;
            s.can_prev = m.can_prev;
            if !m.play_mode.is_empty() {
                s.play_mode = m.play_mode;
            }
        }
        [
            Property::Metadata(s.build_metadata()),
            Property::CanGoNext(s.can_next),
            Property::CanGoPrevious(s.can_prev),
            Property::LoopStatus(loop_status_of(&s.play_mode)),
            Property::Shuffle(s.play_mode == "shuffle"),
        ]
    };
    let _ = srv.properties_changed(props).await;
}
