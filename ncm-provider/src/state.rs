//! 共享类型:进程状态 State、写出通道 Out、上游超时。命令类型见 protocol.rs。

use std::future::Future;
use std::time::Duration;

use ncm_api_rs::{create_client, ApiClient};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{error::Elapsed, timeout};

/// 单一写出通道:命令响应 + 事件都经它串行写回 socket,避免并发写乱帧。
pub type Out = mpsc::UnboundedSender<String>;

/// 上游网易云接口的统一超时:每个请求独立兜底,避免断网调用永久挂住 bridge。
pub const NET_TIMEOUT: Duration = Duration::from_secs(15);

/// 给上游 Future 套 NET_TIMEOUT。超时返回 Err(Elapsed)。
pub async fn with_timeout<F: Future>(fut: F) -> Result<F::Output, Elapsed> {
    timeout(NET_TIMEOUT, fut).await
}

/// provider 进程状态。无持久态:cookie 由 bridge 经 set_credential 注入,逐次覆盖到 Query。
pub struct State {
    pub client: ApiClient, // create_client(None),cookie 走 Query 逐次覆盖
    pub cookie: Mutex<Option<String>>,
}

impl State {
    pub fn new() -> Self {
        Self {
            client: create_client(None),
            cookie: Mutex::new(None),
        }
    }

    pub async fn cookie(&self) -> Option<String> {
        self.cookie.lock().await.clone()
    }
}
