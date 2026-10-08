//! One absolute budget per command, including credential/cache waits and all upstream stages.
use std::future::Future;
use std::time::Duration;

use tokio::time::{error::Elapsed, timeout_at, Instant};

pub const COMMAND_TIMEOUT: Duration = Duration::from_secs(25);
const NET_TIMEOUT: Duration = Duration::from_secs(15);

tokio::task_local! { static DEADLINE: Instant; }

pub async fn command<F: Future>(deadline: Instant, future: F) -> Result<F::Output, Elapsed> {
    if Instant::now() >= deadline {
        return timeout_at(deadline, std::future::pending()).await;
    }
    let result = DEADLINE.scope(deadline, timeout_at(deadline, future)).await;
    if Instant::now() >= deadline {
        // timeout_at polls a ready inner future first. Do not let an optional
        // stage swallow expiration and turn an exhausted command into success.
        return timeout_at(deadline, std::future::pending()).await;
    }
    result
}

pub async fn with_timeout<F: Future>(future: F) -> Result<F::Output, Elapsed> {
    let stage = Instant::now() + NET_TIMEOUT;
    let deadline = DEADLINE.try_with(|end| (*end).min(stage)).unwrap_or(stage);
    if Instant::now() >= deadline {
        return timeout_at(deadline, std::future::pending()).await;
    }
    timeout_at(deadline, future).await
}

#[cfg(test)]
mod tests;
