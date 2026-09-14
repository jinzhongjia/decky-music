use std::io::{self, Read, Seek, SeekFrom};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use tokio::task::JoinHandle;

use crate::util::checked_seek;
pub(crate) use buffer::StreamControl;
use buffer::{BufferState, SharedBuffer};
pub(crate) use http::open_http_stream;

mod buffer;
mod http;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum OpenError {
    Timeout,
    Network,
}

const READ_STALL_TIMEOUT: Duration = Duration::from_secs(30);

pub(crate) struct HttpRangeReader {
    shared: Arc<SharedBuffer>,
    task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl HttpRangeReader {
    pub(crate) fn range_supported(&self) -> bool {
        self.shared.state.lock().range_supported
    }

    pub(crate) fn control(&self) -> StreamControl {
        StreamControl {
            shared: Arc::downgrade(&self.shared),
            task: Arc::clone(&self.task),
        }
    }

    /// rodio may swallow IO errors as EOF; retain the failure after dropping its reader.
    pub(crate) fn probe(&self) -> StreamProbe {
        StreamProbe {
            shared: Arc::clone(&self.shared),
        }
    }
}

pub(crate) struct StreamProbe {
    shared: Arc<SharedBuffer>,
}

impl StreamProbe {
    pub(crate) fn failure(&self) -> Option<&'static str> {
        self.shared.state.lock().error
    }

    pub(crate) fn cancelled(&self) -> bool {
        self.shared.state.lock().cancelled
    }
}

impl Read for HttpRangeReader {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        let mut deadline = None;
        self.read_with_wait(out, |shared, state| {
            let deadline = *deadline.get_or_insert_with(|| Instant::now() + READ_STALL_TIMEOUT);
            shared.can_read.wait_until(state, deadline).timed_out()
        })
    }
}

impl HttpRangeReader {
    fn read_with_wait(
        &mut self,
        out: &mut [u8],
        mut wait: impl FnMut(&SharedBuffer, &mut parking_lot::MutexGuard<'_, BufferState>) -> bool,
    ) -> io::Result<usize> {
        if out.is_empty() {
            return Ok(0);
        }
        let mut timed_out = false;
        let mut state = self.shared.state.lock();
        loop {
            if state.stop {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "stream cancelled",
                ));
            }
            if state.read_pos < state.buffer_start || state.read_pos > state.write_pos {
                return Err(io::Error::other("stream buffer invalid"));
            }
            // Drain the buffered tail before error/EOF; never truncate a finished download.
            if state.readable() > 0 {
                let n = state.read_into(out);
                self.shared.changed.notify_one();
                return Ok(n);
            }
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
            // The producer may have won the mutex at the deadline: recheck before latching.
            if timed_out {
                state.fail("stream stalled");
                self.shared.can_read.notify_all();
                self.shared.changed.notify_one();
                self.shared.generation_changed.notify_one();
                return Err(io::Error::other("stream stalled"));
            }
            timed_out = wait(&self.shared, &mut state);
        }
    }
}

impl Seek for HttpRangeReader {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let mut state = self.shared.state.lock();
        if state.stop {
            return Err(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "stream cancelled",
            ));
        }
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
        if next != state.read_pos || state.error.is_some() {
            if next < state.buffer_start || next > state.write_pos || state.error.is_some() {
                if next != 0 && !state.range_supported {
                    return Err(io::Error::other("range unsupported"));
                }
                state.reset(next);
            } else {
                state.read_pos = next;
            }
            self.shared.changed.notify_one();
            self.shared.generation_changed.notify_one();
            self.shared.can_read.notify_all();
        }
        Ok(state.read_pos)
    }
}

impl Drop for HttpRangeReader {
    fn drop(&mut self) {
        // Natural source destruction must preserve the completion callback's failure/EOF.
        // Cancellation by the load owner is marked separately before aborting the task.
        if let Some(task) = self.task.lock().as_ref() {
            task.abort();
        }
        self.shared.close(false);
    }
}

#[cfg(test)]
mod cancellation_tests;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;
