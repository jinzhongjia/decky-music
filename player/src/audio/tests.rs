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
fn completion_callback_enqueues_once() {
    let (tx, rx) = mpsc::channel();
    let done = AtomicBool::new(false);

    notify_finished(&done, &tx, 7, None);
    notify_finished(&done, &tx, 7, None);

    assert!(matches!(
        rx.recv().unwrap(),
        AudioCmd::Finished {
            generation: 7,
            failure: None
        }
    ));
    assert!(matches!(rx.try_recv(), Err(mpsc::TryRecvError::Empty)));
}

#[test]
fn paused_state_has_one_release_deadline() {
    let mut state = AudioState::new();
    state.paused_since = Some(std::time::Instant::now() - IDLE_PAUSE_TIMEOUT);

    assert_eq!(idle_timeout(&state), Some(Duration::ZERO));
}

#[test]
fn failed_completion_emits_fetch_failed_not_ended() {
    let (tx, mut received) = tmpsc::unbounded_channel();
    let events = AudioEvents::new(
        tx,
        Arc::new(parking_lot::Mutex::new(crate::loading::LoadState::default())),
    );
    let (sink, _source) = rodio::Player::new();
    let mut state = AudioState::new();
    state.sink = Some(sink);
    state.generation = 7;

    // A previous source cannot suppress or replace the current source's failure.
    finish_stream(&mut state, 6, Some("stream truncated"), &events);
    assert!(matches!(
        received.try_recv(),
        Err(tmpsc::error::TryRecvError::Empty)
    ));
    finish_stream(&mut state, 7, Some("stream stalled"), &events);
    let event: serde_json::Value =
        serde_json::from_str(&received.try_recv().unwrap().1.to_ndjson()).unwrap();
    assert_eq!(event["type"], "error");
    assert_eq!(event["data"]["code"], "fetch_failed");

    finish_stream(&mut state, 7, None, &events);
    assert!(matches!(
        received.try_recv(),
        Err(tmpsc::error::TryRecvError::Empty)
    ));
}

#[test]
fn clean_completion_emits_ended_once() {
    let (tx, mut received) = tmpsc::unbounded_channel();
    let events = AudioEvents::new(
        tx,
        Arc::new(parking_lot::Mutex::new(crate::loading::LoadState::default())),
    );
    let (sink, _source) = rodio::Player::new();
    let mut state = AudioState::new();
    state.sink = Some(sink);
    state.generation = 7;

    finish_stream(&mut state, 7, None, &events);
    assert!(matches!(received.try_recv().unwrap().1, AudioEv::Ended));
    finish_stream(&mut state, 7, None, &events);
    assert!(matches!(
        received.try_recv(),
        Err(tmpsc::error::TryRecvError::Empty)
    ));
}

/// 不支持 seek 的音源(Source::try_seek 默认返回 NotSupported)。
struct Unseekable;

impl Iterator for Unseekable {
    type Item = rodio::Sample;
    fn next(&mut self) -> Option<rodio::Sample> {
        Some(0.0)
    }
}

impl Source for Unseekable {
    fn current_span_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> rodio::ChannelCount {
        rodio::math::nz!(1)
    }
    fn sample_rate(&self) -> rodio::SampleRate {
        rodio::math::nz!(48_000)
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

/// 对挂着 `source` 的 sink seek 到 12s,返回发出的事件。没有声卡:另起线程拉取混音输出,
/// try_seek 才能拿到周期回调的回执。
fn seek_events(source: impl Source + Send + 'static, paused: bool) -> Vec<AudioEv> {
    let (tx, mut received) = tmpsc::unbounded_channel();
    let events = AudioEvents::new(
        tx,
        Arc::new(parking_lot::Mutex::new(crate::loading::LoadState::default())),
    );
    let (sink, mut output) = rodio::Player::new();
    sink.append(source);
    if paused {
        sink.pause();
    }
    let done = Arc::new(AtomicBool::new(false));
    let pulling = Arc::clone(&done);
    let mixer = std::thread::spawn(move || {
        while !pulling.load(Ordering::Relaxed) {
            output.next();
        }
    });
    let mut state = AudioState::new();
    state.sink = Some(sink);
    seek(&mut state, 12.0, &events);
    done.store(true, Ordering::Relaxed);
    mixer.join().unwrap();
    std::iter::from_fn(|| received.try_recv().ok().map(|(_, event)| event)).collect()
}

#[test]
fn paused_seek_reports_landed_position_to_bridge() {
    let events = seek_events(rodio::source::SineWave::new(440.0), true);
    assert!(
        matches!(events[..], [AudioEv::Seeked { pos: a }, AudioEv::Paused { pos: b }] if a == 12.0 && b == 12.0),
        "暂停中 seek 必须用 paused 回报落点,否则 bridge 进度要等恢复播放才更新"
    );
}

#[test]
fn playing_seek_reanchors_progress() {
    let events = seek_events(rodio::source::SineWave::new(440.0), false);
    assert!(
        matches!(events[..], [AudioEv::Seeked { pos: a }, AudioEv::Playing { pos: b }] if a == b && b >= 12.0)
    );
}

#[test]
fn failed_seek_reports_unmoved_position_not_target() {
    for paused in [true, false] {
        let events = seek_events(Unseekable, paused);
        let [AudioEv::Error {
            code: ErrorCode::SeekFailed,
            ..
        }, anchor] = &events[..]
        else {
            panic!("unexpected events (paused={paused})");
        };
        let pos = match (anchor, paused) {
            (AudioEv::Paused { pos }, true) | (AudioEv::Playing { pos }, false) => *pos,
            _ => panic!("anchor does not match play state (paused={paused})"),
        };
        // rodio 失败时也把 get_pos 设成目标值;回报它会让 UI 停在一个音频根本没到的位置
        assert!(pos < 12.0, "failed seek reported {pos}s (paused={paused})");
    }
}
