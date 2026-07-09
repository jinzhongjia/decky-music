//! player:拿 URL → HTTP 拉流 → 解码 → 推 PipeWire;上报进度/结束。
//!
//! 入口: `player --socket <path>`。bridge 作 server,player 连入;收 NDJSON 命令、
//! 发 NDJSON 事件。控制面命令:load / pause / resume / volume / seek / stop。
//!
//! rodio 的 OutputStream/Sink 是 !Send,不能跨 tokio await,所以音频跑在专用 OS 线程上,
//! 与 tokio 侧用 channel 通信。

use std::io::{self, Read, Seek, SeekFrom};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::blocking::{Client, Response};
use reqwest::header::{CONTENT_LENGTH, CONTENT_RANGE, RANGE};
use reqwest::StatusCode;

use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::mpsc as tmpsc;

mod logging;
mod protocol;
use logging::{log_json, LogLevel};
use protocol::ErrorCode;

type HttpStream = HttpRangeReader;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let socket = arg("--socket").expect("--socket <path> required");
    tokio::runtime::Runtime::new()?.block_on(socket_loop(&socket))
}

// ---- 音频线程 ----

enum AudioCmd {
    Load(Box<HttpStream>),
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
                // 不记 URL(含限时 vkey,避免泄漏);只打开响应头,音频数据由 rodio 按需读取。
                Ok(a) => match open_http_stream(a.url).await {
                    Ok(stream) => {
                        let msg = if stream.range_supported() {
                            "stream opened with range"
                        } else {
                            "stream opened without range"
                        };
                        let _ = out_tx.send(log_json(LogLevel::Info, "load", msg));
                        send(&cmd_tx, AudioCmd::Load(Box::new(stream)), req.id)
                    }
                    Err(()) => {
                        let _ =
                            out_tx.send(log_json(LogLevel::Error, "load", "stream open failed"));
                        protocol::err(req.id, ErrorCode::FetchFailed, "stream open failed")
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

async fn open_http_stream(url: String) -> Result<HttpStream, ()> {
    tokio::task::spawn_blocking(move || HttpRangeReader::open_url(&url))
        .await
        .map_err(|_| ())?
        .map_err(|_| ())
}

struct HttpRangeReader {
    url: String,
    client: Client,
    position: u64,
    content_length: Option<u64>,
    range_supported: bool,
    current_stream: Option<Response>,
}

impl HttpRangeReader {
    fn open_url(url: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let mut reader = Self {
            url: url.to_string(),
            client: Client::builder().build()?,
            position: 0,
            content_length: None,
            range_supported: false,
            current_stream: None,
        };
        reader.current_stream = Some(reader.open_range(0)?);
        Ok(reader)
    }

    fn open_range(
        &mut self,
        start: u64,
    ) -> Result<Response, Box<dyn std::error::Error + Send + Sync>> {
        let resp = self
            .client
            .get(&self.url)
            .header(RANGE, format!("bytes={start}-"))
            .send()?;
        let status = resp.status();
        let supports_range = status == StatusCode::PARTIAL_CONTENT;
        if start > 0 && !supports_range {
            return Err("range request unsupported".into());
        }
        if start == 0 {
            self.range_supported = supports_range;
        }
        let resp = resp.error_for_status()?;
        self.remember_content_length(&resp);
        Ok(resp)
    }

    fn open_range_io(&mut self, start: u64) -> io::Result<Response> {
        self.open_range(start)
            .map_err(|_| io::Error::other("stream open failed"))
    }

    fn remember_content_length(&mut self, resp: &Response) {
        if let Some(total) = content_range_total(resp) {
            self.content_length = Some(total);
            return;
        }
        if resp.status() == StatusCode::OK {
            self.content_length = resp
                .headers()
                .get(CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok());
        }
    }

    fn content_length(&mut self) -> io::Result<u64> {
        if let Some(len) = self.content_length {
            return Ok(len);
        }
        let resp = self
            .client
            .head(&self.url)
            .send()
            .map_err(|_| io::Error::other("content length unavailable"))?
            .error_for_status()
            .map_err(|_| io::Error::other("content length unavailable"))?;
        self.remember_content_length(&resp);
        self.content_length
            .ok_or_else(|| io::Error::other("content length unavailable"))
    }

    fn range_supported(&self) -> bool {
        self.range_supported
    }
}

impl Read for HttpRangeReader {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        if self.content_length.is_some_and(|len| self.position >= len) {
            return Ok(0);
        }
        if self.current_stream.is_none() {
            self.current_stream = Some(self.open_range_io(self.position)?);
        }
        let n = match self.current_stream.as_mut() {
            Some(stream) => stream.read(out)?,
            None => 0,
        };
        if n == 0 {
            self.current_stream = None;
            return Ok(0);
        }
        self.position += n as u64;
        Ok(n)
    }
}

impl Seek for HttpRangeReader {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let next = match pos {
            SeekFrom::Start(n) => n,
            SeekFrom::Current(offset) => checked_seek(self.position, offset)?,
            SeekFrom::End(offset) => checked_seek(self.content_length()?, offset)?,
        };
        if next != self.position {
            if next != 0 && !self.range_supported {
                return Err(io::Error::other("range unsupported"));
            }
            self.position = next;
            self.current_stream = None;
        }
        Ok(self.position)
    }
}

fn content_range_total(resp: &Response) -> Option<u64> {
    let value = resp.headers().get(CONTENT_RANGE)?.to_str().ok()?;
    let (_, total) = value.rsplit_once('/')?;
    total.parse().ok()
}

fn checked_seek(base: u64, offset: i64) -> io::Result<u64> {
    let next = base as i128 + offset as i128;
    if next < 0 || next > u64::MAX as i128 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid seek"));
    }
    Ok(next as u64)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader as StdBufReader, Write};
    use std::net::{TcpListener, TcpStream};
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::time::Duration as StdDuration;

    #[test]
    fn http_range_reader_reopens_stream_after_seek() {
        let data: Vec<u8> = (0..=255).cycle().take(512).collect();
        let (url, starts) = range_server(data.clone());
        let mut reader = HttpRangeReader::open_url(&url).unwrap();
        assert_eq!(starts.recv_timeout(StdDuration::from_secs(2)).unwrap(), 0);

        let mut first = [0_u8; 4];
        reader.read_exact(&mut first).unwrap();
        assert_eq!(&first, &data[0..4]);

        reader.seek(SeekFrom::Start(100)).unwrap();
        let mut next = [0_u8; 4];
        reader.read_exact(&mut next).unwrap();
        assert_eq!(&next, &data[100..104]);
        assert_eq!(starts.recv_timeout(StdDuration::from_secs(2)).unwrap(), 100);
    }

    #[test]
    fn http_reader_falls_back_when_range_is_unsupported() {
        let data: Vec<u8> = (0..=255).cycle().take(512).collect();
        let (url, _starts) = http_server(data.clone(), false);
        let mut reader = HttpRangeReader::open_url(&url).unwrap();

        assert!(!reader.range_supported());
        let mut first = [0_u8; 4];
        reader.read_exact(&mut first).unwrap();
        assert_eq!(&first, &data[0..4]);
        assert!(reader.seek(SeekFrom::Start(100)).is_err());
    }

    #[test]
    fn rodio_decoder_accepts_http_range_reader() {
        let (url, _starts) = range_server(wav_bytes(80_000));
        let reader = HttpRangeReader::open_url(&url).unwrap();
        let mut decoder = rodio::Decoder::new(reader).unwrap();

        assert!(decoder.next().is_some());
    }

    fn range_server(data: Vec<u8>) -> (String, Receiver<u64>) {
        http_server(data, true)
    }

    fn http_server(data: Vec<u8>, supports_range: bool) -> (String, Receiver<u64>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/song", listener.local_addr().unwrap());
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(32).flatten() {
                handle_request(stream, &data, supports_range, &tx);
            }
        });
        (url, rx)
    }

    fn handle_request(
        mut stream: TcpStream,
        data: &[u8],
        supports_range: bool,
        starts: &Sender<u64>,
    ) {
        let mut request = String::new();
        let mut reader = StdBufReader::new(stream.try_clone().unwrap());
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                break;
            }
            request.push_str(&line);
        }

        if request.starts_with("HEAD ") {
            write_response(&mut stream, "HTTP/1.1 200 OK", "", &[]);
            return;
        }

        let range_start = range_start(&request);
        let requested_start = range_start.unwrap_or(0) as usize;
        let start = if supports_range { requested_start } else { 0 };
        let _ = starts.send(start as u64);

        if start >= data.len() {
            write_response(
                &mut stream,
                "HTTP/1.1 416 Range Not Satisfiable",
                &format!("Content-Range: bytes */{}\r\n", data.len()),
                &[],
            );
            return;
        }

        let body = &data[start..];
        let (status, extra) = if supports_range && range_start.is_some() {
            (
                "HTTP/1.1 206 Partial Content",
                format!(
                    "Content-Range: bytes {}-{}/{}\r\n",
                    start,
                    data.len() - 1,
                    data.len()
                ),
            )
        } else {
            ("HTTP/1.1 200 OK", String::new())
        };
        write_response(&mut stream, status, &extra, body);
    }

    fn range_start(request: &str) -> Option<u64> {
        request.lines().find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if !name.eq_ignore_ascii_case("range") {
                return None;
            }
            let value = value.trim().strip_prefix("bytes=")?;
            let (start, _) = value.split_once('-')?;
            start.parse().ok()
        })
    }

    fn write_response(stream: &mut TcpStream, status: &str, extra: &str, body: &[u8]) {
        let headers = format!(
            "{status}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\n{extra}\r\n",
            body.len()
        );
        stream.write_all(headers.as_bytes()).unwrap();
        stream.write_all(body).unwrap();
    }

    fn wav_bytes(samples: u32) -> Vec<u8> {
        let data_len = samples * 2;
        let mut out = Vec::with_capacity(44 + data_len as usize);
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16_u32.to_le_bytes());
        out.extend_from_slice(&1_u16.to_le_bytes());
        out.extend_from_slice(&1_u16.to_le_bytes());
        out.extend_from_slice(&8_000_u32.to_le_bytes());
        out.extend_from_slice(&16_000_u32.to_le_bytes());
        out.extend_from_slice(&2_u16.to_le_bytes());
        out.extend_from_slice(&16_u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        out.resize(44 + data_len as usize, 0);
        out
    }
}
