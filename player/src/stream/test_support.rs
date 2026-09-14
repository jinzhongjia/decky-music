use super::*;
use std::io::{BufRead, BufReader as StdBufReader, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};

pub(super) fn open_reader(url: &str) -> HttpRangeReader {
    static RUNTIME: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
    RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .unwrap()
        })
        .block_on(open_http_stream(url.to_string()))
        .unwrap()
}

pub(super) struct Requests {
    rx: Receiver<u64>,
    address: SocketAddr,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}

impl std::ops::Deref for Requests {
    type Target = Receiver<u64>;
    fn deref(&self) -> &Self::Target {
        &self.rx
    }
}

impl Drop for Requests {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.address);
        if let Some(worker) = self.worker.take() {
            worker.join().unwrap();
        }
    }
}

pub(super) fn range_server(data: Vec<u8>) -> (String, Requests) {
    http_server_impl(data, true, usize::MAX)
}

pub(super) fn http_server_dying(data: Vec<u8>, cap: usize) -> (String, Requests) {
    start_server(data, true, cap, 1)
}

pub(super) fn http_server_impl(
    data: Vec<u8>,
    supports_range: bool,
    cap: usize,
) -> (String, Requests) {
    start_server(data, supports_range, cap, 32)
}

fn start_server(
    data: Vec<u8>,
    supports_range: bool,
    cap: usize,
    count: usize,
) -> (String, Requests) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let url = format!("http://{address}/song");
    let (tx, rx) = mpsc::channel();
    let data = Arc::new(data);
    let stop = Arc::new(AtomicBool::new(false));
    let stopping = Arc::clone(&stop);
    let worker = std::thread::spawn(move || {
        let mut workers = Vec::new();
        for stream in listener.incoming().take(count).flatten() {
            if stopping.load(Ordering::SeqCst) {
                break;
            }
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let (data, tx) = (Arc::clone(&data), tx.clone());
            workers.push(std::thread::spawn(move || {
                handle_request(stream, data.as_slice(), supports_range, cap, &tx);
            }));
        }
        drop(listener);
        for worker in workers {
            worker.join().unwrap();
        }
    });
    (
        url,
        Requests {
            rx,
            address,
            stop,
            worker: Some(worker),
        },
    )
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

pub(super) fn wav_bytes(samples: u32) -> Vec<u8> {
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
