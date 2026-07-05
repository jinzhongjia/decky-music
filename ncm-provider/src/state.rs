//! 共享类型:入站命令 Cmd、进程状态 State、写出通道 Out。

use ncm_api_rs::{create_client, ApiClient};
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::{mpsc, Mutex};

/// 单一写出通道:命令响应 + 事件都经它串行写回 socket,避免并发写乱帧。
pub type Out = mpsc::UnboundedSender<String>;

/// bridge 下发的一条命令(NDJSON 一行)。
#[derive(Deserialize)]
pub struct Cmd {
    pub cmd: String,
    pub id: Option<String>,
    pub keyword: Option<String>,
    pub cred: Option<Value>,
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
