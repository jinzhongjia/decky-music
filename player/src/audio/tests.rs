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
