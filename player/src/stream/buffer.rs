use std::collections::VecDeque;
use std::sync::Arc;

use parking_lot::{Condvar, Mutex};
use tokio::sync::Notify;
use tokio::task::JoinHandle;

pub(super) const BUFFER_CAPACITY: usize = 4 * 1024 * 1024;
pub(super) const BUFFER_LOW_WATER: usize = 1024 * 1024;
pub(super) const BUFFER_HIGH_WATER: usize = 3 * 1024 * 1024;
pub(super) const BUFFER_REWIND: usize = 256 * 1024;
pub(super) const BUFFER_CHUNK: usize = 64 * 1024;

pub(super) struct SharedBuffer {
    pub state: Mutex<BufferState>,
    pub can_read: Condvar,
    pub changed: Notify,
    pub generation_changed: Notify,
}

impl SharedBuffer {
    pub fn new(range_supported: bool, content_length: Option<u64>) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(BufferState::new(range_supported, content_length)),
            can_read: Condvar::new(),
            changed: Notify::new(),
            generation_changed: Notify::new(),
        })
    }

    pub fn close(&self, cancelled: bool) {
        let mut state = self.state.lock();
        state.stop = true;
        state.cancelled |= cancelled;
        // Probes may outlive the reader; they retain the failure, never the 4 MiB allocation.
        state.buffer = VecDeque::new();
        state.buffer_start = state.read_pos;
        state.write_pos = state.read_pos;
        self.can_read.notify_all();
        self.changed.notify_one();
        self.generation_changed.notify_one();
    }
}

/// Cancellation is independent of rodio owning (and possibly blocking inside) Read.
#[derive(Clone)]
pub(crate) struct StreamControl {
    pub(super) shared: std::sync::Weak<SharedBuffer>,
    pub(super) task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl StreamControl {
    pub(crate) fn cancel(&self) {
        if let Some(shared) = self.shared.upgrade() {
            shared.close(true);
        }
        if let Some(task) = self.task.lock().as_ref() {
            task.abort();
        }
    }

    pub(crate) async fn shutdown(&self) {
        self.cancel();
        let task = self.task.lock().take();
        if let Some(task) = task {
            let _ = task.await;
        }
    }
}

pub(super) struct BufferState {
    pub buffer: VecDeque<u8>,
    pub buffer_start: u64,
    pub read_pos: u64,
    pub write_pos: u64,
    pub content_length: Option<u64>,
    pub range_supported: bool,
    pub eof: bool,
    pub error: Option<&'static str>,
    pub stop: bool,
    pub cancelled: bool,
    pub generation: u64,
}

impl BufferState {
    pub fn new(range_supported: bool, content_length: Option<u64>) -> Self {
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
            cancelled: false,
            generation: 0,
        }
    }

    pub fn readable(&self) -> usize {
        (self.write_pos - self.read_pos) as usize
    }

    pub fn push(&mut self, data: &[u8]) {
        self.buffer.extend(data);
        self.write_pos += data.len() as u64;
    }

    pub fn read_into(&mut self, out: &mut [u8]) -> usize {
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

    pub fn trim_rewind(&mut self) {
        let keep_from = self.read_pos.saturating_sub(BUFFER_REWIND as u64);
        if keep_from <= self.buffer_start {
            return;
        }
        let drop = (keep_from - self.buffer_start).min(self.buffer.len() as u64) as usize;
        self.buffer.drain(..drop);
        self.buffer_start += drop as u64;
    }

    pub fn fail(&mut self, reason: &'static str) {
        self.error = Some(reason);
        self.generation += 1;
    }

    pub fn reset(&mut self, pos: u64) {
        self.buffer.clear();
        self.buffer_start = pos;
        self.read_pos = pos;
        self.write_pos = pos;
        self.eof = false;
        self.error = None;
        self.generation += 1;
    }
}
