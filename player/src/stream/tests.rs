use super::*;
use std::io::{BufRead, BufReader as StdBufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{self, Receiver, Sender};
use std::time::Duration as StdDuration;

fn empty_reader(content_length: Option<u64>) -> HttpRangeReader {
    HttpRangeReader {
        shared: Arc::new(SharedBuffer {
            state: Mutex::new(BufferState::new(true, content_length)),
            can_read: Condvar::new(),
            can_write: Condvar::new(),
        }),
    }
}

fn expire_read(reader: &mut HttpRangeReader) -> io::Result<usize> {
    reader.read_with_wait(&mut [0], |shared, state| {
        shared.can_read.wait_for(state, Duration::ZERO).timed_out()
    })
}

#[test]
fn stalled_read_remains_failed_for_readers_and_probe_after_drop() {
    let mut reader = empty_reader(Some(1));
    let probe = reader.probe();
    assert_eq!(
        expire_read(&mut reader).unwrap_err().kind(),
        io::ErrorKind::Other
    );
    assert!(probe.failure().is_some());
    assert!(reader.read(&mut [0]).is_err());
    drop(reader);
    assert!(probe.failure().is_some());
}

#[test]
fn refill_at_expired_wait_is_drained_before_eof() {
    let mut reader = empty_reader(Some(3));
    let probe = reader.probe();
    let mut out = [0; 2];
    let n = reader
        .read_with_wait(&mut out, |_, state| {
            state.push(b"abc");
            state.eof = true;
            true // The OS wait expired, but the producer won the mutex before the reader.
        })
        .unwrap();
    assert_eq!(&out[..n], b"ab");
    assert_eq!(reader.read(&mut out).unwrap(), 1);
    assert_eq!(out[0], b'c');
    assert_eq!(reader.read(&mut out).unwrap(), 0);
    assert!(probe.failure().is_none());
}

#[test]
fn eof_at_expired_wait_is_not_a_stall() {
    // Unknown-length FIN and a newly learned, already-consumed length are both EOF.
    for known_length in [false, true] {
        let mut reader = empty_reader(None);
        let probe = reader.probe();
        let n = reader
            .read_with_wait(&mut [0], |_, state| {
                if known_length {
                    state.content_length = Some(0);
                } else {
                    state.eof = true;
                }
                true
            })
            .unwrap();
        assert_eq!(n, 0);
        assert!(probe.failure().is_none());
    }
}

#[test]
fn failure_at_expired_wait_keeps_its_cause_and_drains_buffer() {
    let mut reader = empty_reader(Some(2));
    let probe = reader.probe();
    let reason = "stream truncated";
    let mut out = [0];
    assert_eq!(
        reader
            .read_with_wait(&mut out, |_, state| {
                state.push(b"a");
                state.error = Some(reason);
                true
            })
            .unwrap(),
        1
    );
    assert_eq!(&out, b"a");
    assert!(reader.read(&mut out).is_err());
    assert_eq!(probe.failure(), Some(reason));
}

#[test]
fn producer_error_at_expired_wait_is_not_overwritten_by_stall() {
    let mut reader = empty_reader(Some(1));
    let probe = reader.probe();
    let reason = "stream open failed";
    let result = reader.read_with_wait(&mut [0], |_, state| {
        state.error = Some(reason);
        true
    });
    assert!(result.is_err());
    assert_eq!(probe.failure(), Some(reason));
}

#[test]
fn temporary_shortage_and_spurious_wakeup_wait_for_refill() {
    let mut reader = empty_reader(Some(1));
    let mut out = [0];
    let mut wakeups = 0;
    assert_eq!(
        reader
            .read_with_wait(&mut out, |_, state| {
                wakeups += 1;
                if wakeups == 2 {
                    state.push(b"a");
                }
                false
            })
            .unwrap(),
        1
    );
    assert_eq!(&out, b"a");
    assert!(reader.probe().failure().is_none());
}

#[test]
fn late_response_cannot_revive_stall_but_seek_can_restart_producer() {
    let (url, release, server) = delayed_body_server();
    let client = Client::builder()
        .timeout(StdDuration::from_secs(2))
        .build()
        .unwrap();
    let (response, _, length) = open_http_response(&client, &url, 0).unwrap();
    let mut reader = empty_reader(length);
    let probe = reader.probe();
    let shared = Arc::clone(&reader.shared);
    let (started_tx, started) = mpsc::channel();
    let (continue_tx, proceed) = mpsc::channel();
    let producer = thread::spawn(move || {
        let mut gate = Some(proceed);
        producer_loop(shared, client, url, Some(response), 0, |response, out| {
            if let Some(proceed) = gate.take() {
                started_tx.send(()).unwrap();
                proceed.recv_timeout(StdDuration::from_secs(2)).unwrap();
            }
            response.read(out)
        });
    });
    // The response read has been selected under generation 0 and is now outside
    // the mutex. Its real HTTP body will arrive only after the reader has failed.
    started.recv_timeout(StdDuration::from_secs(2)).unwrap();

    assert!(expire_read(&mut reader).is_err());
    release.send(()).unwrap();
    continue_tx.send(()).unwrap();
    // A parked producer has processed (or rejected) the old response. Synchronize
    // through its actual condvar rather than sleeping and assuming the HTTP read ran.
    let deadline = Instant::now() + StdDuration::from_secs(2);
    loop {
        if reader.shared.can_write.notify_one() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "producer did not park after failure"
        );
        thread::yield_now();
    }
    assert!(reader.read(&mut [0]).is_err());
    assert!(probe.failure().is_some());

    reader.seek(SeekFrom::Start(1)).unwrap();
    let mut resumed = [0; 3];
    reader.read_exact(&mut resumed).unwrap();
    assert_eq!(&resumed, b"bcd");
    assert_eq!(reader.read(&mut [0]).unwrap(), 0);
    assert!(probe.failure().is_none());
    drop(reader);
    producer.join().unwrap();
    server.join().unwrap();
}

fn delayed_body_server() -> (String, Sender<()>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/song", listener.local_addr().unwrap());
    let (release, ready) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = StdBufReader::new(stream.try_clone().unwrap());
        loop {
            let mut line = String::new();
            if request.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                break;
            }
        }
        stream.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 0-3/4\r\n\r\n").unwrap();
        ready.recv_timeout(StdDuration::from_secs(2)).unwrap();
        let _ = stream.write_all(b"abcd");
        drop(stream);
        let (stream, _) = listener.accept().unwrap();
        let (starts, _) = mpsc::channel();
        handle_request(stream, b"abcd", true, usize::MAX, &starts);
    });
    (url, release, server)
}

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
    let (url, _starts) = http_server_impl(data.clone(), false, usize::MAX);
    let mut reader = HttpRangeReader::open_url(&url).unwrap();

    assert!(!reader.range_supported());
    let mut first = [0_u8; 4];
    reader.read_exact(&mut first).unwrap();
    assert_eq!(&first, &data[0..4]);
    assert!(reader.seek(SeekFrom::Start(target)).is_err());
}

#[test]
fn resumes_when_server_truncates_mid_stream() {
    // 服务端每次最多回 64KB 就掐连接(声明完整长度)→ 客户端应 Range 续传拼出全量
    let data: Vec<u8> = (0..=255).cycle().take(300_000).collect();
    let (url, starts) = http_server_impl(data.clone(), true, 64 * 1024);
    let mut reader = HttpRangeReader::open_url(&url).unwrap();
    let mut got = vec![0_u8; data.len()];
    reader.read_exact(&mut got).unwrap();
    assert_eq!(got, data);
    let mut requests = 0;
    while starts.try_recv().is_ok() {
        requests += 1;
    }
    assert!(
        requests >= 2,
        "expected range resumes, got {requests} request(s)"
    );
}

#[test]
fn mid_stream_death_errors_instead_of_silent_eof() {
    // 声明全量长度但只发一半,之后拒绝一切连接:read 必须报错(经退避重试判死),
    // probe 暴露死因。曾经这里静默 EOF → 被音频线程误判"正常播完"提前切歌。
    let data: Vec<u8> = (0..=255).cycle().take(200_000).collect();
    let (url, _starts) = http_server_dying(data.clone(), 100_000);
    let mut reader = HttpRangeReader::open_url(&url).unwrap();
    let probe = reader.probe();
    let mut got = vec![0_u8; data.len()];
    let err = reader.read_exact(&mut got).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::Other);
    assert!(probe.failure().is_some());
}

#[test]
fn clean_eof_leaves_probe_unfailed() {
    let data: Vec<u8> = (0..=255).cycle().take(50_000).collect();
    let (url, _starts) = range_server(data.clone());
    let mut reader = HttpRangeReader::open_url(&url).unwrap();
    let probe = reader.probe();
    let mut got = vec![0_u8; data.len()];
    reader.read_exact(&mut got).unwrap();
    assert_eq!(got, data);
    assert_eq!(probe.failure(), None);
}

#[test]
fn rodio_decoder_accepts_http_range_reader() {
    let (url, _starts) = range_server(wav_bytes(80_000));
    let reader = HttpRangeReader::open_url(&url).unwrap();
    let mut decoder = rodio::Decoder::new(reader).unwrap();

    assert!(decoder.next().is_some());
}

#[test]
fn truncation_stress_no_early_eof() {
    // 回归压测:反复截断+续传下必须逐字节完整,不许提前 EOF。
    // 曾因 read() 先判 eof 后排空缓冲,下载完成瞬间丢弃未消费尾巴(调度相关,
    // 单次跑难复现)—— 即"歌曲没播放完就切下一曲"的根因。
    for round in 0..10 {
        let data: Vec<u8> = (0..=255).cycle().take(300_000).collect();
        let (url, _starts) = http_server_impl(data.clone(), true, 64 * 1024);
        let mut reader = HttpRangeReader::open_url(&url).unwrap();
        let probe = reader.probe();
        let mut got = vec![0_u8; data.len()];
        reader
            .read_exact(&mut got)
            .unwrap_or_else(|e| panic!("round {round}: {e}"));
        assert_eq!(got, data, "round {round}: data mismatch");
        assert_eq!(probe.failure(), None);
    }
}

fn range_server(data: Vec<u8>) -> (String, Receiver<u64>) {
    http_server_impl(data, true, usize::MAX)
}

/// 只服务一个请求(声明全量、发送 cap 字节)后关停监听:后续连接全部被拒,
/// 模拟"断流 + 网络不可达",逼出续传重试判死路径。
fn http_server_dying(data: Vec<u8>, cap: usize) -> (String, Receiver<u64>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/song", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        if let Some(stream) = listener.incoming().flatten().next() {
            handle_request(stream, &data, true, cap, &tx);
        }
        // listener 随作用域 drop → 之后 connect 全部拒绝
    });
    (url, rx)
}

/// cap:每次响应最多发送的 body 字节数(声明完整 Content-Length 但提前掐连接,
/// 模拟 CDN 释放空闲连接的截断)。usize::MAX = 不截断。
fn http_server_impl(data: Vec<u8>, supports_range: bool, cap: usize) -> (String, Receiver<u64>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/song", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    let data = std::sync::Arc::new(data);
    std::thread::spawn(move || {
        for stream in listener.incoming().take(32).flatten() {
            let data = std::sync::Arc::clone(&data);
            let tx = tx.clone();
            std::thread::spawn(move || {
                handle_request(stream, data.as_slice(), supports_range, cap, &tx);
            });
        }
    });
    (url, rx)
}

fn handle_request(
    mut stream: TcpStream,
    data: &[u8],
    supports_range: bool,
    cap: usize,
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
    // cap:声明完整长度但只发送前 cap 字节后断开(模拟服务端截断)
    let sent = &body[..body.len().min(cap)];
    write_response_claiming(&mut stream, status, &extra, sent, body.len());
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
    write_response_claiming(stream, status, extra, body, body.len());
}

/// claimed:头部声明的 Content-Length(可大于实际发送量,模拟截断)
fn write_response_claiming(
    stream: &mut TcpStream,
    status: &str,
    extra: &str,
    body: &[u8],
    claimed: usize,
) {
    let headers =
        format!("{status}\r\nContent-Length: {claimed}\r\nAccept-Ranges: bytes\r\n{extra}\r\n");
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
