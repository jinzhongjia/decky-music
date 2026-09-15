use super::*;
use crate::loading::Loads;
use crate::protocol;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Notify};

#[derive(Default)]
struct Counters {
    accepted: AtomicUsize,
    active: AtomicUsize,
    peak: AtomicUsize,
    closed: AtomicUsize,
    changed: Notify,
}

struct Connection(Arc<Counters>);
impl Drop for Connection {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
        self.0.closed.fetch_add(1, Ordering::SeqCst);
        self.0.changed.notify_one();
    }
}

struct Server {
    url: String,
    counts: Arc<Counters>,
    task: JoinHandle<()>,
}

impl Server {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let counts = Arc::new(Counters::default());
        let shared = Arc::clone(&counts);
        let task = tokio::spawn(async move {
            let mut connections = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    result = listener.accept() => {
                        let (socket, _) = result.unwrap();
                        let counts = Arc::clone(&shared);
                        counts.accepted.fetch_add(1, Ordering::SeqCst);
                        let active = counts.active.fetch_add(1, Ordering::SeqCst) + 1;
                        counts.peak.fetch_max(active, Ordering::SeqCst);
                        counts.changed.notify_one();
                        connections.spawn(serve(socket, Connection(counts)));
                    }
                    Some(_) = connections.join_next(), if !connections.is_empty() => {}
                }
            }
        });
        Self { url, counts, task }
    }

    async fn wait(&self, counter: &AtomicUsize, target: usize) {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let changed = self.counts.changed.notified();
                if counter.load(Ordering::SeqCst) >= target {
                    return;
                }
                changed.await;
            }
        })
        .await
        .expect("connection lifecycle did not complete promptly");
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn serve(mut socket: TcpStream, _connection: Connection) {
    let mut request = Vec::new();
    while !request.ends_with(b"\r\n\r\n") {
        let mut byte = [0];
        if socket.read(&mut byte).await.unwrap_or(0) == 0 {
            return;
        }
        request.push(byte[0]);
    }
    let request = String::from_utf8(request).unwrap();
    if request.starts_with("GET /ok ") {
        let _ = socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nabcd")
            .await;
        return;
    }
    if request.starts_with("GET /partial ") {
        if request.to_ascii_lowercase().contains("range: bytes=1-") {
            let _ = socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 1-3/4\r\n\r\nbcd").await;
            return;
        }
        let _ = socket.write_all(b"HTTP/1.1 206 Partial Content\r\nContent-Length: 4\r\nContent-Range: bytes 0-3/4\r\n\r\na").await;
    }
    // /headers never sends headers; /partial sends one byte then stalls forever.
    let mut byte = [0];
    let _ = socket.read(&mut byte).await;
}

fn request(id: u64, url: String) -> protocol::Request {
    protocol::Request {
        id,
        cmd: "load".into(),
        args: json!({"url": url}),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn repeated_loads_cancel_headers_before_retry_and_newest_starts_promptly() {
    let server = Server::start().await;
    let mut loads = Loads::new();
    let (cmd, commands) = std::sync::mpsc::channel();
    let (out, mut responses) = mpsc::unbounded_channel();
    let mut max_cancel_ms = 0;
    for id in 1..=32 {
        loads
            .start(&cmd, &out, request(id, format!("{}/headers", server.url)))
            .await;
        server.wait(&server.counts.accepted, id as usize).await;
        let started = Instant::now();
        loads.invalidate(&out).await;
        server.wait(&server.counts.closed, id as usize).await;
        max_cancel_ms = max_cancel_ms.max(started.elapsed().as_millis());
    }
    assert_eq!(server.counts.accepted.load(Ordering::SeqCst), 32);
    assert!(server.counts.peak.load(Ordering::SeqCst) <= 2);
    let started = Instant::now();
    loads
        .start(&cmd, &out, request(33, format!("{}/ok", server.url)))
        .await;
    let mut superseded = 0;
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let response: Value = serde_json::from_str(&responses.recv().await.unwrap()).unwrap();
            if response["error"]["code"] == "superseded" {
                superseded += 1;
            }
            if response["id"] == 33 && response["ok"] == true {
                break;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(superseded, 32);
    assert_eq!(
        commands
            .try_iter()
            .filter(|cmd| matches!(cmd, crate::audio::AudioCmd::Load { .. }))
            .count(),
        1
    );
    println!("header cancellation: attempts=32 peak_connections={} max_cancel_ms={max_cancel_ms} newest_open_ms={}", server.counts.peak.load(Ordering::SeqCst), started.elapsed().as_millis());
    loads.invalidate(&out).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn partial_body_drop_closes_connection_and_reclaims_task_and_buffer() {
    let server = Server::start().await;
    let reader = open_http_stream(format!("{}/partial", server.url))
        .await
        .unwrap();
    let shared = Arc::downgrade(&reader.shared);
    let task = Arc::clone(&reader.task);
    let started = Instant::now();
    drop(reader);
    let producer = task.lock().take().unwrap();
    let _ = tokio::time::timeout(Duration::from_secs(2), producer)
        .await
        .unwrap();
    server.wait(&server.counts.closed, 1).await;
    assert!(
        shared.upgrade().is_none(),
        "producer retained the ring buffer"
    );
    assert_eq!(server.counts.active.load(Ordering::SeqCst), 0);
    println!(
        "partial body drop: live_producers=0 retained_buffers=0 close_ms={}",
        started.elapsed().as_millis()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stalled_body_is_cancelled_and_same_position_seek_restarts_failed_stream() {
    let server = Server::start().await;
    let mut reader = open_http_stream(format!("{}/partial", server.url))
        .await
        .unwrap();
    let probe = reader.probe();
    let mut first = [0];
    reader.read_exact(&mut first).unwrap();
    assert_eq!(&first, b"a");
    assert!(reader.read_with_wait(&mut [0], |_, _| true).is_err());
    server.wait(&server.counts.closed, 1).await;
    assert!(reader.read(&mut [0]).is_err());
    assert!(probe.failure().is_some());
    reader.seek(SeekFrom::Start(1)).unwrap();
    let mut rest = [0; 3];
    reader.read_exact(&mut rest).unwrap();
    assert_eq!(&rest, b"bcd");
    assert_eq!(reader.read(&mut [0]).unwrap(), 0);
    assert!(probe.failure().is_none());
    reader.control().shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn replacement_load_joins_pending_headers_without_waiting_for_timeout() {
    let server = Server::start().await;
    let mut loads = Loads::new();
    let (cmd, commands) = std::sync::mpsc::channel();
    let (out, mut responses) = mpsc::unbounded_channel();
    loads
        .start(&cmd, &out, request(1, format!("{}/headers", server.url)))
        .await;
    server.wait(&server.counts.accepted, 1).await;
    let started = Instant::now();
    loads
        .start(&cmd, &out, request(2, format!("{}/ok", server.url)))
        .await;
    server.wait(&server.counts.closed, 2).await;
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let value: Value = serde_json::from_str(&responses.recv().await.unwrap()).unwrap();
            if value["id"] == 2 && value["ok"] == true {
                break;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(
        commands
            .try_iter()
            .filter(|cmd| matches!(cmd, crate::audio::AudioCmd::Load { .. }))
            .count(),
        1
    );
    assert_eq!(server.counts.accepted.load(Ordering::SeqCst), 2);
    println!(
        "replacement: header_attempts=2 cancelled_old=1 newest_open_ms={}",
        started.elapsed().as_millis()
    );
    loads.invalidate(&out).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stop_unblocks_decoder_read_and_reclaims_buffer_before_reader_drop() {
    let server = Server::start().await;
    let mut reader = open_http_stream(format!("{}/partial", server.url))
        .await
        .unwrap();
    reader.read_exact(&mut [0]).unwrap();
    let control = reader.control();
    let shared = Arc::clone(&reader.shared);
    let (done, result) = std::sync::mpsc::channel();
    let decoder = std::thread::spawn(move || {
        done.send(reader.read_exact(&mut [0])).unwrap();
    });
    let started = Instant::now();
    control.shutdown().await;
    assert_eq!(
        result
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .unwrap_err()
            .kind(),
        io::ErrorKind::BrokenPipe
    );
    decoder.join().unwrap();
    server.wait(&server.counts.closed, 1).await;
    assert_eq!(shared.state.lock().buffer.capacity(), 0);
    assert_eq!(server.counts.accepted.load(Ordering::SeqCst), 1);
    println!(
        "stop: live_producers=0 buffer_capacity=0 decoder_exit_ms={}",
        started.elapsed().as_millis()
    );
}
