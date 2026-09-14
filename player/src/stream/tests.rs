use super::buffer::{BUFFER_CHUNK, BUFFER_HIGH_WATER};
use super::test_support::*;
use super::*;
use std::time::Duration as StdDuration;

fn empty_reader(content_length: Option<u64>) -> HttpRangeReader {
    HttpRangeReader {
        shared: SharedBuffer::new(true, content_length),
        task: Arc::new(Mutex::new(None)),
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
fn http_range_reader_reopens_stream_after_seek() {
    let target = (BUFFER_HIGH_WATER + BUFFER_CHUNK) as u64;
    let data: Vec<u8> = (0..=255).cycle().take(target as usize + 512).collect();
    let (url, starts) = range_server(data.clone());
    let mut reader = open_reader(&url);
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
    let mut reader = open_reader(&url);

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
    let mut reader = open_reader(&url);
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
    let mut reader = open_reader(&url);
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
    let mut reader = open_reader(&url);
    let probe = reader.probe();
    let mut got = vec![0_u8; data.len()];
    reader.read_exact(&mut got).unwrap();
    assert_eq!(got, data);
    assert_eq!(probe.failure(), None);
}

#[test]
fn rodio_decoder_accepts_http_range_reader() {
    let (url, _starts) = range_server(wav_bytes(80_000));
    let reader = open_reader(&url);
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
        let mut reader = open_reader(&url);
        let probe = reader.probe();
        let mut got = vec![0_u8; data.len()];
        reader
            .read_exact(&mut got)
            .unwrap_or_else(|e| panic!("round {round}: {e}"));
        assert_eq!(got, data, "round {round}: data mismatch");
        assert_eq!(probe.failure(), None);
    }
}
