use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{CONTENT_LENGTH, CONTENT_RANGE, RANGE};
use reqwest::{Client, Response, StatusCode};
use tokio::sync::{Semaphore, SemaphorePermit};

use super::buffer::{SharedBuffer, BUFFER_CHUNK, BUFFER_HIGH_WATER, BUFFER_LOW_WATER};
use super::{HttpRangeReader, OpenError};

// Includes headers, retry delay and body producers, not just accepted results.
const MAX_ACTIVE_LOADS: usize = 2;
static ACTIVE_LOADS: Semaphore = Semaphore::const_new(MAX_ACTIVE_LOADS);
const HEADER_TIMEOUT: Duration = Duration::from_secs(10);
const INITIAL_OPEN_BACKOFF: Duration = Duration::from_secs(1);
const OPEN_RETRIES: u32 = 3;
const OPEN_BACKOFF_BASE: Duration = Duration::from_millis(500);

pub(crate) async fn open_http_stream(url: String) -> Result<HttpRangeReader, OpenError> {
    let permit = ACTIVE_LOADS
        .acquire()
        .await
        .map_err(|_| OpenError::Network)?;
    let client = Client::builder()
        .connect_timeout(HEADER_TIMEOUT)
        .pool_max_idle_per_host(0)
        .build()
        .map_err(|_| OpenError::Network)?;
    // timeout wraps send(), not the response body: long songs have no total deadline.
    let initial = match open_response(&client, &url, 0).await {
        Ok(response) => response,
        Err(_) => {
            tokio::time::sleep(INITIAL_OPEN_BACKOFF).await;
            open_response(&client, &url, 0).await?
        }
    };
    let shared = SharedBuffer::new(initial.1, initial.2);
    let task = tokio::spawn(producer(
        Arc::clone(&shared),
        client,
        url,
        initial.0,
        permit,
    ));
    Ok(HttpRangeReader {
        shared,
        task: Arc::new(parking_lot::Mutex::new(Some(task))),
    })
}

async fn open_response(
    client: &Client,
    url: &str,
    start: u64,
) -> Result<(Response, bool, Option<u64>), OpenError> {
    let response = tokio::time::timeout(
        HEADER_TIMEOUT,
        client
            .get(url)
            .header(RANGE, format!("bytes={start}-"))
            .send(),
    )
    .await
    .map_err(|_| OpenError::Timeout)?
    .map_err(|error| {
        if error.is_timeout() {
            OpenError::Timeout
        } else {
            OpenError::Network
        }
    })?;
    let range = response.status() == StatusCode::PARTIAL_CONTENT;
    if start > 0 && !range {
        return Err(OpenError::Network);
    }
    let response = response
        .error_for_status()
        .map_err(|_| OpenError::Network)?;
    let length = response
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit_once('/'))
        .and_then(|(_, total)| total.parse().ok())
        .or_else(|| {
            (response.status() == StatusCode::OK)
                .then(|| {
                    response
                        .headers()
                        .get(CONTENT_LENGTH)?
                        .to_str()
                        .ok()?
                        .parse()
                        .ok()
                })
                .flatten()
        });
    Ok((response, range, length))
}

async fn changed_generation(shared: &SharedBuffer, generation: u64) {
    loop {
        let changed = shared.generation_changed.notified();
        {
            let state = shared.state.lock();
            if state.stop || state.generation != generation {
                return;
            }
        }
        changed.await;
    }
}

async fn ready(shared: &SharedBuffer) -> Option<u64> {
    loop {
        let changed = shared.changed.notified();
        {
            let state = shared.state.lock();
            if state.stop {
                return None;
            }
            if state.error.is_none() && !state.eof {
                return Some(state.generation);
            }
        }
        changed.await;
    }
}

async fn room(shared: &SharedBuffer, generation: u64, throttled: &mut bool) -> bool {
    loop {
        let changed = shared.changed.notified();
        {
            let mut state = shared.state.lock();
            if state.stop || state.generation != generation {
                return false;
            }
            state.trim_rewind();
            *throttled |= state.buffer.len() >= BUFFER_HIGH_WATER;
            if !*throttled || state.buffer.len() <= BUFFER_LOW_WATER {
                *throttled = false;
                return true;
            }
        }
        changed.await;
    }
}

async fn reopen(
    shared: &SharedBuffer,
    client: &Client,
    url: &str,
    generation: u64,
) -> Option<Response> {
    let start = shared.state.lock().write_pos;
    for attempt in 0..OPEN_RETRIES {
        if attempt > 0 {
            tokio::time::sleep(OPEN_BACKOFF_BASE * 2_u32.pow(attempt - 1)).await;
        }
        if let Ok((response, range, length)) = open_response(client, url, start).await {
            let mut state = shared.state.lock();
            if state.generation != generation || state.stop {
                return None;
            }
            if start == 0 {
                state.range_supported = range;
            }
            if length.is_some() {
                state.content_length = length;
            }
            return Some(response);
        }
    }
    let mut state = shared.state.lock();
    if state.generation == generation && !state.stop {
        state.error = Some("stream open failed");
        shared.can_read.notify_all();
    }
    None
}

struct Resume {
    at: u64,
    stalls: u32,
}

impl Resume {
    fn ended(&mut self, shared: &SharedBuffer, generation: u64, clean: bool) {
        let mut state = shared.state.lock();
        if state.generation != generation || state.stop {
            return;
        }
        if state
            .content_length
            .map_or(clean, |length| state.write_pos >= length)
        {
            state.eof = true;
        } else {
            self.stalls = if state.write_pos == self.at {
                self.stalls + 1
            } else {
                0
            };
            self.at = state.write_pos;
            if !state.range_supported || self.stalls >= 3 {
                state.error = Some("stream truncated");
            }
        }
        shared.can_read.notify_all();
    }
}

async fn consume(shared: &SharedBuffer, response: &mut Response, generation: u64) -> Option<bool> {
    let mut throttled = false;
    loop {
        if !room(shared, generation, &mut throttled).await {
            return None;
        }
        match response.chunk().await {
            Ok(Some(chunk)) => {
                // The ring is strictly bounded; retain at most one transport frame outside it.
                for part in chunk.chunks(BUFFER_CHUNK) {
                    if !room(shared, generation, &mut throttled).await {
                        return None;
                    }
                    let mut state = shared.state.lock();
                    if state.generation != generation || state.stop {
                        return None;
                    }
                    state.push(part);
                    shared.can_read.notify_all();
                }
            }
            Ok(None) => return Some(true),
            Err(_) => return Some(false),
        }
    }
}

async fn producer(
    shared: Arc<SharedBuffer>,
    client: Client,
    url: String,
    initial: Response,
    _permit: SemaphorePermit<'static>,
) {
    let mut response = Some(initial);
    let mut generation = 0;
    let mut resume = Resume {
        at: u64::MAX,
        stalls: 0,
    };
    while let Some(next) = ready(&shared).await {
        if next != generation {
            response = None;
            generation = next;
            resume = Resume {
                at: u64::MAX,
                stalls: 0,
            };
        }
        tokio::select! {
            biased;
            _ = changed_generation(&shared, generation) => { response = None; }
            _ = async {
                if response.is_none() {
                    response = reopen(&shared, &client, &url, generation).await;
                }
                if let Some(mut body) = response.take() {
                    if let Some(clean) = consume(&shared, &mut body, generation).await {
                        resume.ended(&shared, generation, clean);
                    }
                }
            } => {}
        }
    }
}
