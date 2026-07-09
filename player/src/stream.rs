use std::collections::VecDeque;
use std::io::{self, Read, Seek, SeekFrom};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::{Condvar, Mutex};
use reqwest::blocking::{Client, Response};
use reqwest::header::{CONTENT_LENGTH, CONTENT_RANGE, RANGE};
use reqwest::StatusCode;

use crate::util::checked_seek;

pub(crate) type HttpStream = HttpRangeReader;

pub(crate) async fn open_http_stream(url: String) -> Result<HttpStream, ()> {
    tokio::task::spawn_blocking(move || HttpRangeReader::open_url(&url))
        .await
        .map_err(|_| ())?
        .map_err(|_| ())
}

const BUFFER_CAPACITY: usize = 4 * 1024 * 1024;
const BUFFER_LOW_WATER: usize = 1024 * 1024;
const BUFFER_HIGH_WATER: usize = 3 * 1024 * 1024;
const BUFFER_REWIND: usize = 256 * 1024;
const BUFFER_CHUNK: usize = 64 * 1024;

// 网络超时:断网时挂住的连接/读会吊死解码线程(rodio 在 read 里等),进而堵住命令链路。
// blocking reqwest 的 timeout 是逐操作(connect/read/write)生效,不限制整段流式响应的总时长。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const IO_TIMEOUT: Duration = Duration::from_secs(15);
// 读侧兜底:缓冲空且 producer 迟迟不补(网络停摆)时,解码 read 最多等这么久 → 报错结束,
// 不永久阻塞音频线程。正常补货(内网/CDN)远快于此,不会误伤。
const READ_STALL_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) struct HttpRangeReader {
    shared: Arc<SharedBuffer>,
}

struct SharedBuffer {
    state: Mutex<BufferState>,
    can_read: Condvar,
    can_write: Condvar,
}

struct BufferState {
    buffer: VecDeque<u8>,
    buffer_start: u64,
    read_pos: u64,
    write_pos: u64,
    content_length: Option<u64>,
    range_supported: bool,
    eof: bool,
    error: Option<&'static str>,
    stop: bool,
    generation: u64,
}

impl BufferState {
    fn new(range_supported: bool, content_length: Option<u64>) -> Self {
        Self {
            buffer: VecDeque::with_capacity(BUFFER_CAPACITY),
            buffer_start: 0,
            read_pos: 0,
            write_pos: 0,
            content_length,
            range_supported,
            eof: false,
            error: None,
            stop: false,
            generation: 0,
        }
    }

    fn readable(&self) -> usize {
        (self.write_pos - self.read_pos) as usize
    }

    fn push(&mut self, data: &[u8]) {
        self.buffer.extend(data);
        self.write_pos += data.len() as u64;
    }

    fn read_into(&mut self, out: &mut [u8]) -> usize {
        let offset = (self.read_pos - self.buffer_start) as usize;
        let count = out.len().min(self.readable());
        let (front, back) = self.buffer.as_slices();
        let mut copied = 0;
        if offset < front.len() {
            let n = count.min(front.len() - offset);
            out[..n].copy_from_slice(&front[offset..offset + n]);
            copied += n;
        }
        if copied < count {
            let offset = offset.saturating_sub(front.len());
            let n = (count - copied).min(back.len() - offset);
            out[copied..copied + n].copy_from_slice(&back[offset..offset + n]);
            copied += n;
        }
        self.read_pos += copied as u64;
        self.trim_rewind();
        copied
    }

    fn trim_rewind(&mut self) {
        let keep_from = self.read_pos.saturating_sub(BUFFER_REWIND as u64);
        if keep_from <= self.buffer_start {
            return;
        }
        let drop = (keep_from - self.buffer_start).min(self.buffer.len() as u64) as usize;
        self.buffer.drain(..drop);
        self.buffer_start += drop as u64;
    }

    fn reset(&mut self, pos: u64) {
        self.buffer.clear();
        self.buffer_start = pos;
        self.read_pos = pos;
        self.write_pos = pos;
        self.eof = false;
        self.error = None;
        self.generation += 1;
    }
}

impl HttpRangeReader {
    fn open_url(url: &str) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let client = Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(IO_TIMEOUT)
            .build()?;
        let (response, range_supported, content_length) = open_http_response(&client, url, 0)?;
        let shared = Arc::new(SharedBuffer {
            state: Mutex::new(BufferState::new(range_supported, content_length)),
            can_read: Condvar::new(),
            can_write: Condvar::new(),
        });
        thread::spawn({
            let shared = Arc::clone(&shared);
            let url = url.to_string();
            move || producer_loop(shared, client, url, Some(response), 0)
        });
        Ok(Self { shared })
    }

    pub(crate) fn range_supported(&self) -> bool {
        self.shared.state.lock().range_supported
    }
}

impl Read for HttpRangeReader {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        let mut state = self.shared.state.lock();
        loop {
            if let Some(err) = state.error {
                return Err(io::Error::other(err));
            }
            if state
                .content_length
                .is_some_and(|len| state.read_pos >= len)
                || state.eof
            {
                return Ok(0);
            }
            if state.read_pos < state.buffer_start || state.read_pos > state.write_pos {
                return Err(io::Error::other("stream buffer invalid"));
            }
            if state.readable() > 0 {
                let n = state.read_into(out);
                self.shared.can_write.notify_one();
                return Ok(n);
            }
            if self
                .shared
                .can_read
                .wait_for(&mut state, READ_STALL_TIMEOUT)
                .timed_out()
            {
                return Err(io::Error::other("stream stalled"));
            }
        }
    }
}

impl Seek for HttpRangeReader {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let mut state = self.shared.state.lock();
        let next = match pos {
            SeekFrom::Start(n) => n,
            SeekFrom::Current(offset) => checked_seek(state.read_pos, offset)?,
            SeekFrom::End(offset) => {
                let len = state
                    .content_length
                    .ok_or_else(|| io::Error::other("content length unavailable"))?;
                checked_seek(len, offset)?
            }
        };
        if next != state.read_pos {
            if next < state.buffer_start || next > state.write_pos {
                if next != 0 && !state.range_supported {
                    return Err(io::Error::other("range unsupported"));
                }
                state.reset(next);
            } else {
                state.read_pos = next;
            }
            self.shared.can_write.notify_all();
            self.shared.can_read.notify_all();
        }
        Ok(state.read_pos)
    }
}

impl Drop for HttpRangeReader {
    fn drop(&mut self) {
        let mut state = self.shared.state.lock();
        state.stop = true;
        self.shared.can_write.notify_all();
        self.shared.can_read.notify_all();
    }
}

fn producer_loop(
    shared: Arc<SharedBuffer>,
    client: Client,
    url: String,
    initial_response: Option<Response>,
    initial_generation: u64,
) {
    let mut response = initial_response;
    let mut response_generation = initial_generation;
    let mut chunk = vec![0_u8; BUFFER_CHUNK];
    loop {
        let generation = {
            let mut state = shared.state.lock();
            loop {
                if state.stop {
                    return;
                }
                if state.error.is_some() || state.eof {
                    shared.can_write.wait(&mut state);
                    continue;
                }
                state.trim_rewind();
                if state.generation != response_generation {
                    break state.generation;
                }
                if state.buffer.len() < BUFFER_HIGH_WATER {
                    break state.generation;
                }
                while state.buffer.len() > BUFFER_LOW_WATER
                    && !state.stop
                    && state.generation == response_generation
                {
                    shared.can_write.wait(&mut state);
                    state.trim_rewind();
                }
            }
        };

        if response.is_none() || response_generation != generation {
            let start = shared.state.lock().write_pos;
            match open_http_response(&client, &url, start) {
                Ok((resp, range_supported, content_length)) => {
                    let mut state = shared.state.lock();
                    if state.generation != generation {
                        continue;
                    }
                    if start == 0 {
                        state.range_supported = range_supported;
                    }
                    if content_length.is_some() {
                        state.content_length = content_length;
                    }
                    response = Some(resp);
                    response_generation = generation;
                }
                Err(_) => {
                    let mut state = shared.state.lock();
                    if state.generation == generation {
                        state.error = Some("stream open failed");
                        shared.can_read.notify_all();
                    }
                    response = None;
                    continue;
                }
            }
        }

        let n = match response
            .as_mut()
            .and_then(|resp| resp.read(&mut chunk).ok())
        {
            Some(n) => n,
            None => {
                let mut state = shared.state.lock();
                if state.generation == response_generation {
                    state.error = Some("stream read failed");
                    shared.can_read.notify_all();
                }
                response = None;
                continue;
            }
        };

        let mut state = shared.state.lock();
        if state.generation != response_generation {
            response = None;
            continue;
        }
        if n == 0 {
            state.eof = true;
            response = None;
            shared.can_read.notify_all();
            continue;
        }
        state.push(&chunk[..n]);
        shared.can_read.notify_all();
    }
}

fn open_http_response(
    client: &Client,
    url: &str,
    start: u64,
) -> Result<(Response, bool, Option<u64>), Box<dyn std::error::Error + Send + Sync>> {
    let resp = client
        .get(url)
        .header(RANGE, format!("bytes={start}-"))
        .send()?;
    let status = resp.status();
    let range_supported = status == StatusCode::PARTIAL_CONTENT;
    if start > 0 && !range_supported {
        return Err("range request unsupported".into());
    }
    let resp = resp.error_for_status()?;
    let content_length = content_range_total(&resp).or_else(|| {
        if resp.status() == StatusCode::OK {
            resp.headers()
                .get(CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok())
        } else {
            None
        }
    });
    Ok((resp, range_supported, content_length))
}

fn content_range_total(resp: &Response) -> Option<u64> {
    let value = resp.headers().get(CONTENT_RANGE)?.to_str().ok()?;
    let (_, total) = value.rsplit_once('/')?;
    total.parse().ok()
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
        let target = (BUFFER_HIGH_WATER + BUFFER_CHUNK) as u64;
        let data: Vec<u8> = (0..=255).cycle().take(target as usize + 512).collect();
        let (url, starts) = range_server(data.clone());
        let mut reader = HttpRangeReader::open_url(&url).unwrap();
        assert_eq!(starts.recv_timeout(StdDuration::from_secs(2)).unwrap(), 0);

        let mut first = [0_u8; 4];
        reader.read_exact(&mut first).unwrap();
        assert_eq!(&first, &data[0..4]);

        reader.seek(SeekFrom::Start(target)).unwrap();
        let mut next = [0_u8; 4];
        reader.read_exact(&mut next).unwrap();
        let target = target as usize;
        assert_eq!(&next, &data[target..target + 4]);
        assert_eq!(
            starts.recv_timeout(StdDuration::from_secs(2)).unwrap(),
            target as u64
        );
    }

    #[test]
    fn http_reader_falls_back_when_range_is_unsupported() {
        let target = (BUFFER_HIGH_WATER + BUFFER_CHUNK) as u64;
        let data: Vec<u8> = (0..=255).cycle().take(target as usize + 512).collect();
        let (url, _starts) = http_server(data.clone(), false);
        let mut reader = HttpRangeReader::open_url(&url).unwrap();

        assert!(!reader.range_supported());
        let mut first = [0_u8; 4];
        reader.read_exact(&mut first).unwrap();
        assert_eq!(&first, &data[0..4]);
        assert!(reader.seek(SeekFrom::Start(target)).is_err());
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
        let data = std::sync::Arc::new(data);
        std::thread::spawn(move || {
            for stream in listener.incoming().take(32).flatten() {
                let data = std::sync::Arc::clone(&data);
                let tx = tx.clone();
                std::thread::spawn(move || {
                    handle_request(stream, data.as_slice(), supports_range, &tx);
                });
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
        let _ = stream.write_all(headers.as_bytes());
        let _ = stream.write_all(body);
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
