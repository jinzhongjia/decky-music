use super::*;
use crate::provider_commands::resolve_uid;

#[tokio::test]
async fn cookie_carries_stable_device_pins_across_credential_changes() {
    let state = State::new(None);
    let anonymous = state.cookie().await.unwrap();
    for key in ["deviceId=", "_ntes_nuid=", "_ntes_nnid=", "WNMCID="] {
        assert!(anonymous.contains(key));
    }
    state.replace_credential(Some("MUSIC_U=synthetic".into()), None);
    assert_eq!(
        state.cookie().await.unwrap(),
        format!("{anonymous}; MUSIC_U=synthetic")
    );
    assert_eq!(state.device_pins().unwrap(), anonymous);
}

#[tokio::test]
async fn stale_lookup_and_logout_cannot_overwrite_new_account() {
    let state = State::new(None);
    state.replace_credential(Some("synthetic_old".into()), None);
    let old = state.session();
    SESSION
        .scope(old.clone(), async {
            let uid = resolve_uid(&old, 1, async {
                state.replace_credential(Some("synthetic_new".into()), None);
                Ok("old_uid".into())
            })
            .await
            .unwrap();
            assert_eq!(uid, "old_uid");
            assert!(!state.is_current(&old));
            assert_eq!(state.credential().await.as_deref(), Some("synthetic_old"));
            assert!(!state.replace_credential(None, Some(&old)));
        })
        .await;
    assert_eq!(state.credential().await.as_deref(), Some("synthetic_new"));
    assert!(state.session().uid.lock().await.is_none());
}

#[tokio::test]
async fn canceled_uid_lookup_does_not_poison_single_flight() {
    let state = State::new(None);
    let session = state.session();
    let other = session.clone();
    let (started, ready) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        resolve_uid(&other, 1, async {
            started.send(()).unwrap();
            std::future::pending::<Result<String, String>>().await
        })
        .await
    });
    ready.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert_eq!(
        resolve_uid(&session, 2, async { Ok("new_uid".into()) })
            .await
            .unwrap(),
        "new_uid"
    );
}

#[tokio::test]
async fn stale_response_and_login_completion_are_fenced_at_publication() {
    let state = State::new(None);
    let old = state.session();
    state.replace_credential(Some("synthetic_new".into()), None);
    let (out, mut responses) = tokio::sync::mpsc::unbounded_channel();
    state.publish_response(Some(&old), &out, 7, crate::protocol::ok_empty(7));
    let response: serde_json::Value =
        serde_json::from_str(&responses.recv().await.unwrap()).unwrap();
    assert_eq!(response["error"]["code"], "superseded");
    assert!(
        !state.replace_credential_with(Some("synthetic_old".into()), Some(&old), || {
            out.send("stale login completion".into()).unwrap();
        })
    );
    assert!(responses.try_recv().is_err());
    assert_eq!(state.credential().await.as_deref(), Some("synthetic_new"));
}
