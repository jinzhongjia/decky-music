//! player:拿 URL → HTTP 拉流 → 解码 → 推 PipeWire;上报进度/结束。
//!
//! 两个入口:
//! - `player --play <url>`:P0 出声 spike。独立同步跑,不接 bridge。
//! - `player --socket <path>`:正式模式。bridge 作 server,player 连入;收 NDJSON 命令、
//!   发 NDJSON 事件。控制面命令:load / pause / resume / volume / seek / stop。
//!
//! rodio 的 OutputStream/Sink 是 !Send,不能跨 tokio await,所以音频跑在专用 OS 线程上,
//! 与 tokio 侧用 channel 通信。

use std::io::Cursor;
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc as tmpsc;

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
    // ponytail: 整首下到内存 + 同步阻塞。流式边下边播留后续。
    eprintln!("[player] fetching {url}");
    let bytes = reqwest::blocking::Client::builder()
        .build()?
        .get(url)
        .send()?
        .error_for_status()?
        .bytes()?;
    eprintln!("[player] fetched {} bytes, opening default audio device", bytes.len());
    let (_stream, handle) = rodio::OutputStream::try_default()?;
    let sink = rodio::Sink::try_new(&handle)?;
    sink.append(rodio::Decoder::new(Cursor::new(bytes))?);
    eprintln!("[player] playing… (Ctrl+C to stop)");
    sink.sleep_until_end();
    eprintln!("[player] done");
    Ok(())
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

/// 上报给 bridge 的事件,序列化成 NDJSON。
enum AudioEv {
    Playing { pos: f64 },
    Paused { pos: f64 },
    Ended,
    Error(String),
    Log { level: &'static str, place: &'static str, msg: String },
}

/// 结构化日志事件(bridge 收后落 decky.logger,标 origin=socket)。
fn log_json(level: &str, place: &str, msg: &str) -> String {
    format!(r#"{{"ev":"log","level":"{level}","where":"{place}","msg":{}}}"#, jstr(msg))
}

fn epoch_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()
}

impl AudioEv {
    fn to_ndjson(&self) -> String {
        match self {
            // wall_ms + pos:UI 本地插值进度(pos + (now - wall_ms))
            AudioEv::Playing { pos } => {
                format!(r#"{{"ev":"playing","pos":{pos},"wall_ms":{}}}"#, epoch_ms())
            }
            AudioEv::Paused { pos } => format!(r#"{{"ev":"paused","pos":{pos}}}"#),
            AudioEv::Ended => r#"{"ev":"ended"}"#.to_string(),
            AudioEv::Error(m) => {
                format!(r#"{{"ev":"error","msg":{}}}"#, serde_json::to_string(m).unwrap())
            }
            AudioEv::Log { level, place, msg } => log_json(level, place, msg),
        }
    }
}

/// 拥有 OutputStream + Sink 的专用线程。用 recv_timeout 轮询:平时睡,到点醒来查是否播完。
fn audio_thread(rx: mpsc::Receiver<AudioCmd>, ev: tmpsc::UnboundedSender<AudioEv>) {
    let (_stream, handle) = match rodio::OutputStream::try_default() {
        Ok(v) => v,
        Err(e) => {
            let _ = ev.send(AudioEv::Error(format!("open audio device: {e}")));
            return;
        }
    };
    let _ = ev.send(AudioEv::Log { level: "info", place: "audio", msg: "默认音频设备已打开".into() });
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
                        let _ = ev.send(AudioEv::Error(format!("decode/play: {e}")));
                    }
                }
            }
            Ok(AudioCmd::Pause) => {
                if let Some(s) = &sink {
                    s.pause();
                    let _ = ev.send(AudioEv::Paused { pos: s.get_pos().as_secs_f64() });
                }
            }
            Ok(AudioCmd::Resume) => {
                if let Some(s) = &sink {
                    s.play();
                    let _ = ev.send(AudioEv::Playing { pos: s.get_pos().as_secs_f64() });
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

#[derive(Deserialize)]
struct Cmd {
    cmd: String,
    url: Option<String>,
    sec: Option<f64>,
    val: Option<f64>,
}

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
        let cmd: Cmd = match serde_json::from_str(&line) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if debug {
            let _ = out_tx.send(log_json("debug", "cmd", &cmd.cmd));
        }
        let resp = match cmd.cmd.as_str() {
            "load" => match &cmd.url {
                // ponytail: 整首拉进内存再播;流式边下边播留后续。不记 URL(含限时 vkey,避免泄漏)
                Some(url) => match fetch(&http, url).await {
                    Ok(bytes) => {
                        let _ = out_tx.send(log_json("info", "load", &format!("已拉流 {} 字节", bytes.len())));
                        let _ = cmd_tx.send(AudioCmd::Load(bytes));
                        r#"{"ok":true}"#.to_string()
                    }
                    Err(e) => {
                        let _ = out_tx.send(log_json("error", "load", &format!("拉流失败: {e}")));
                        format!(r#"{{"ok":false,"msg":{}}}"#, jstr(&e.to_string()))
                    }
                },
                None => r#"{"ok":false,"msg":"load requires url"}"#.to_string(),
            },
            "pause" => send(&cmd_tx, AudioCmd::Pause),
            "resume" => send(&cmd_tx, AudioCmd::Resume),
            "stop" => send(&cmd_tx, AudioCmd::Stop),
            "volume" => send(&cmd_tx, AudioCmd::Volume(cmd.val.unwrap_or(1.0) as f32)),
            "seek" => send(&cmd_tx, AudioCmd::Seek(cmd.sec.unwrap_or(0.0))),
            _ => r#"{"ok":false,"msg":"unknown cmd"}"#.to_string(),
        };
        let _ = out_tx.send(resp);
    }
    Ok(())
}

async fn fetch(http: &reqwest::Client, url: &str) -> reqwest::Result<Vec<u8>> {
    Ok(http.get(url).send().await?.error_for_status()?.bytes().await?.to_vec())
}

fn send(tx: &mpsc::Sender<AudioCmd>, c: AudioCmd) -> String {
    match tx.send(c) {
        Ok(_) => r#"{"ok":true}"#.to_string(),
        Err(_) => r#"{"ok":false,"msg":"audio thread gone"}"#.to_string(),
    }
}

fn jstr(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string())
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
