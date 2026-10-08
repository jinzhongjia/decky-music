use super::*;
use tokio::sync::mpsc;

#[tokio::test]
async fn unknown_command_never_echoes_input() {
    let state = Arc::new(State::new(None));
    let session = state.session();
    let (out, mut logs) = mpsc::unbounded_channel();
    let req = protocol::parse_request(
        r#"{"id":17,"cmd":"SENTINEL https://synthetic.invalid/?token=secret","args":{}}"#,
    )
    .unwrap();
    let response = execute(
        state,
        out,
        req,
        session,
        tokio::time::Instant::now() + deadline::COMMAND_TIMEOUT,
    )
    .await;
    assert!(!response.contains("SENTINEL"));
    assert!(!response.contains("synthetic.invalid"));
    let response: Value = serde_json::from_str(&response).unwrap();
    assert_eq!(response["error"]["code"], "unknown_cmd");
    assert!(logs.try_recv().is_err());
}
