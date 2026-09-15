use std::sync::{mpsc, Arc};

use parking_lot::Mutex;
use tokio::sync::mpsc as tmpsc;
use tokio::task::JoinHandle;

use crate::audio::AudioCmd;
use crate::protocol::{self, ErrorCode, LogLevel, Request};
use crate::stream::{open_http_stream, OpenError, StreamControl};

#[derive(Default)]
pub(crate) struct LoadState {
    pub(crate) generation: u64,
    pending_id: Option<u64>,
    active: Option<StreamControl>,
}

/// One header task, one handed-off stream. Replacement joins old work before spawning.
pub(crate) struct Loads {
    pub(crate) state: Arc<Mutex<LoadState>>,
    pending: Option<JoinHandle<()>>,
}

impl Loads {
    pub(crate) fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(LoadState::default())),
            pending: None,
        }
    }

    pub(crate) async fn invalidate(&mut self, out: &tmpsc::UnboundedSender<String>) {
        let active = {
            let mut state = self.state.lock();
            state.generation += 1;
            if let Some(id) = state.pending_id.take() {
                let _ = out.send(protocol::err(
                    id,
                    ErrorCode::Superseded,
                    "superseded by newer load",
                ));
            }
            let active = state.active.take();
            if let Some(active) = &active {
                active.cancel();
            }
            active
        };
        if let Some(task) = self.pending.take() {
            task.abort();
            let _ = task.await;
        }
        if let Some(active) = active {
            active.shutdown().await;
        }
    }

    pub(crate) async fn start(
        &mut self,
        cmd: &mpsc::Sender<AudioCmd>,
        out: &tmpsc::UnboundedSender<String>,
        req: Request,
    ) {
        self.invalidate(out).await;
        // Release decoded samples as well as the HTTP producer before the next handoff.
        let _ = cmd.send(AudioCmd::Stop);
        let generation = {
            let mut state = self.state.lock();
            state.pending_id = Some(req.id);
            state.generation
        };
        let (state, cmd, out) = (Arc::clone(&self.state), cmd.clone(), out.clone());
        self.pending = Some(tokio::spawn(async move {
            let result = match protocol::parse_args::<protocol::LoadArgs>(&req) {
                Ok(args) => open_http_stream(args.url).await.map_err(open_error),
                Err(_) => Err((ErrorCode::MissingField, "url required")),
            };
            let mut current = state.lock();
            if current.generation != generation {
                return;
            }
            current.pending_id = None;
            let response = match result {
                Ok(stream) => {
                    let message = if stream.range_supported() {
                        "stream opened with range"
                    } else {
                        "stream opened without range"
                    };
                    let _ = out.send(protocol::log_json(LogLevel::Info, "load", message));
                    current.active = Some(stream.control());
                    super::socket::send(
                        &cmd,
                        AudioCmd::Load {
                            stream: Box::new(stream),
                            generation,
                        },
                        req.id,
                    )
                }
                Err((code, message)) => protocol::err(req.id, code, message),
            };
            // Same mutex as invalidation and audio event emission: no late handoff/result.
            let _ = out.send(response);
        }));
    }
}

impl Drop for Loads {
    fn drop(&mut self) {
        let mut state = self.state.lock();
        state.generation += 1;
        if let Some(active) = state.active.take() {
            active.cancel();
        }
        if let Some(task) = self.pending.take() {
            task.abort();
        }
    }
}

fn open_error(error: OpenError) -> (ErrorCode, &'static str) {
    match error {
        OpenError::Timeout => (
            ErrorCode::FetchTimeout,
            "stream open timed out (slow network)",
        ),
        OpenError::Network => (ErrorCode::FetchFailed, "stream open failed"),
    }
}
