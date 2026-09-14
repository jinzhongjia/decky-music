use super::*;
use crate::provider_commands::resolve_uid;
use crate::state::Session;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::sleep;

#[tokio::test(start_paused = true)]
async fn stages_cannot_reset_the_command_budget() {
    let start = Instant::now();
    let stages = AtomicUsize::new(0);
    let result = command(start + COMMAND_TIMEOUT, async {
        for _ in 0..3 {
            with_timeout(sleep(Duration::from_secs(10))).await?;
            stages.fetch_add(1, Ordering::Relaxed);
        }
        Ok::<_, Elapsed>(())
    })
    .await;
    assert!(result.is_err());
    assert_eq!(stages.load(Ordering::Relaxed), 2);
    assert_eq!(Instant::now() - start, COMMAND_TIMEOUT);
    assert!(Instant::now() - start < Duration::from_secs(30));
}

#[tokio::test(start_paused = true)]
async fn optional_stage_cannot_swallow_total_expiration() {
    let result = command(Instant::now() + COMMAND_TIMEOUT, async {
        with_timeout(sleep(Duration::from_secs(14))).await.unwrap();
        let _optional = with_timeout(sleep(Duration::from_secs(14))).await;
    })
    .await;
    assert!(result.is_err());
}

#[tokio::test(start_paused = true)]
async fn concurrent_commands_have_independent_deadlines() {
    let slow = tokio::spawn(command(Instant::now() + COMMAND_TIMEOUT, async {
        with_timeout(sleep(Duration::from_secs(14))).await.unwrap();
        with_timeout(sleep(Duration::from_secs(14))).await
    }));
    sleep(Duration::from_secs(10)).await;
    let start = Instant::now();
    let fast = command(start + COMMAND_TIMEOUT, async {
        with_timeout(sleep(Duration::from_secs(1))).await.unwrap();
        "ready"
    })
    .await
    .unwrap();
    assert_eq!(fast, "ready");
    assert_eq!(Instant::now() - start, Duration::from_secs(1));
    assert!(slow.await.unwrap().is_err());
}

#[tokio::test(start_paused = true)]
async fn cold_uid_is_single_flight_and_warm_uid_costs_no_stage() {
    let session = Arc::new(Session {
        credential: Some("synthetic".into()),
        uid: Mutex::new(None),
    });
    let requests = AtomicUsize::new(0);
    let lookup = || async {
        requests.fetch_add(1, Ordering::Relaxed);
        sleep(Duration::from_secs(10)).await;
        Ok("42".to_owned())
    };
    let start = Instant::now();
    let (one, two) = tokio::join!(
        command(start + COMMAND_TIMEOUT, resolve_uid(&session, 1, lookup())),
        command(start + COMMAND_TIMEOUT, resolve_uid(&session, 2, lookup())),
    );
    assert_eq!(one.unwrap().unwrap(), "42");
    assert_eq!(two.unwrap().unwrap(), "42");
    assert_eq!(requests.load(Ordering::Relaxed), 1);
    let warm = Instant::now();
    assert_eq!(resolve_uid(&session, 3, lookup()).await.unwrap(), "42");
    assert_eq!(Instant::now(), warm);
    assert_eq!(requests.load(Ordering::Relaxed), 1);
}

#[tokio::test(start_paused = true)]
async fn cold_uid_leaves_only_remaining_budget_for_content() {
    let session = Session {
        credential: Some("synthetic".into()),
        uid: Mutex::new(None),
    };
    let start = Instant::now();
    let result = command(start + COMMAND_TIMEOUT, async {
        resolve_uid(&session, 1, async {
            sleep(Duration::from_secs(12)).await;
            Ok("42".into())
        })
        .await
        .unwrap();
        with_timeout(sleep(Duration::from_secs(14))).await
    })
    .await;
    assert!(result.is_err());
    assert_eq!(Instant::now() - start, COMMAND_TIMEOUT);
}
