//! QQ 音乐后端:QQMusicApi-rs 作库。
//!
//! 凭证由 bridge 经 set_credential 注入(登录成功后 bridge 持久化),后端不自存;设备身份
//! 落盘到 bridge 注入的状态目录,跨进程稳定(否则每次重启都像一台新安卓机,触发风控,见
//! issue #44)。登录是长流程,以带 `qq` 标签的 login 事件上报。

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use qqmusic_api::{Client, Credential};
use serde_json::{json, Value};
use wire::{log_json, ErrorCode, LogLevel};

use crate::Out;

mod args;
mod auth;
mod brief;
mod catalog;
mod library;
mod media;
mod paging;
#[cfg(test)]
mod tests;

/// 设备身份文件名,与原 Python 版同名同格式:升级后沿用同一台"设备"。
const DEVICE_FILE: &str = "qq-device.json";
/// 单条命令的上游预算;小于 bridge 的 30s 通道超时,对齐 NCM 的单段上限。
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(15);

/// 命令失败的分类,映射到稳定错误码;第三方库原始错误不出这个模块。
#[derive(Debug)]
pub(crate) enum Fail {
    Unknown,
    NotLoggedIn,
    Invalid,
    NoPlayable,
    Upstream(qqmusic_api::Error),
}

impl From<qqmusic_api::Error> for Fail {
    fn from(e: qqmusic_api::Error) -> Self {
        Self::Upstream(e)
    }
}

pub(crate) type CmdResult = Result<Value, Fail>;

/// 认证意图代次:login / logout / set_credential / cancel_login 各自递增,
/// 迟到的旧登录轮询或凭证刷新据此放弃提交。
#[derive(Clone, Default)]
pub(crate) struct AuthGen(Arc<AtomicU64>);

impl AuthGen {
    fn begin(&self) -> u64 {
        self.0.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub(crate) fn is(&self, generation: u64) -> bool {
        self.0.load(Ordering::SeqCst) == generation
    }
}

pub struct Qq {
    client: Client,
    auth: AuthGen,
    login: Option<tokio::task::JoinHandle<()>>,
}

impl Qq {
    pub fn new(state_dir: Option<&str>, _debug: bool) -> Self {
        let device = state_dir.map(|dir| Path::new(dir).join(DEVICE_FILE));
        let client = build_client(device.as_deref());
        if let Some(path) = device {
            tokio::spawn(auth::ensure_device(client.clone(), path));
        }
        Self {
            client,
            auth: AuthGen::default(),
            login: None,
        }
    }

    fn abort_login(&mut self) {
        if let Some(handle) = self.login.take() {
            handle.abort();
        }
    }

    /// 读循环内同步调用:认证类命令就地登记意图代次,其余命令后台执行。
    pub fn receive(&mut self, out: &Out, req: wire::Request) {
        match req.cmd.as_str() {
            "set_credential" => self.set_credential(out, req),
            "login" => {
                let generation = self.auth.begin();
                self.abort_login();
                let kind = req.args["type"].as_str().unwrap_or("qq").to_string();
                let _ = out.send(wire::ok_empty(req.id));
                let (client, out, auth) = (self.client.clone(), out.clone(), self.auth.clone());
                let flow = auth::login_flow(client, out, auth, generation, kind);
                self.login = Some(tokio::spawn(flow));
            }
            // 切走音源时 bridge 发:回收在跑的扫码轮询(原来靠杀进程)。
            "cancel_login" => {
                self.auth.begin();
                self.abort_login();
                let _ = out.send(wire::ok_empty(req.id));
            }
            "logout" => {
                self.auth.begin();
                self.abort_login();
                let old = self.client.credential();
                self.client.set_credential(Credential::default());
                let _ = out.send(log_json(LogLevel::Info, "logout", "done"));
                let _ = out.send(wire::ok_empty(req.id));
                tokio::spawn(auth::server_logout(self.client.clone(), old));
            }
            _ => {
                let (client, out) = (self.client.clone(), out.clone());
                tokio::spawn(async move {
                    let response = run_command(&client, &out, &req).await;
                    let _ = out.send(response);
                });
            }
        }
    }

    fn set_credential(&mut self, out: &Out, req: wire::Request) {
        let generation = self.auth.begin();
        self.abort_login();
        let cred = &req.args["cred"];
        let parsed = (!cred.is_null()).then(|| Credential::from_value(cred).ok());
        let Some(credential) = parsed else {
            self.client.set_credential(Credential::default());
            let _ = out.send(log_json(LogLevel::Info, "credential", "cleared"));
            let _ = out.send(wire::ok(req.id, json!({ "refreshed": null })));
            return;
        };
        self.client.set_credential(credential.unwrap_or_default());
        let _ = out.send(log_json(LogLevel::Info, "credential", "injected"));
        let (client, out, auth) = (self.client.clone(), out.clone(), self.auth.clone());
        tokio::spawn(async move {
            let refreshed = auth::refresh_if_expired(&client, &out, &auth, generation).await;
            let _ = out.send(wire::ok(req.id, json!({ "refreshed": refreshed })));
        });
    }
}

impl Drop for Qq {
    fn drop(&mut self) {
        self.abort_login();
    }
}

/// 带设备档案建 client;档案路径不可用时退回内存态设备,不挡住启动。
fn build_client(device: Option<&Path>) -> Client {
    let with_device = device.and_then(|path| Client::builder().device_path(path).build().ok());
    with_device
        .or_else(|| Client::new().ok())
        .expect("QQ client must build with the default transport")
}

/// 普通命令:限时执行并把结果映射成协议响应;失败只落受控类别,不透上游原文。
async fn run_command(client: &Client, out: &Out, req: &wire::Request) -> String {
    let id = req.id;
    let result = tokio::time::timeout(UPSTREAM_TIMEOUT, dispatch(client, out, req)).await;
    match result {
        Ok(Ok(data)) => wire::ok(id, data),
        Ok(Err(fail)) => fail_response(out, id, &req.cmd, fail),
        Err(_) => {
            let _ = out.send(log_json(LogLevel::Warn, "cmd", "upstream timed out"));
            wire::err(id, ErrorCode::UpstreamTimeout, "upstream_timeout")
        }
    }
}

fn fail_response(out: &Out, id: u64, cmd: &str, fail: Fail) -> String {
    let code = match fail {
        Fail::Unknown => ErrorCode::UnknownCmd,
        Fail::NotLoggedIn => ErrorCode::NotLoggedIn,
        Fail::Invalid => ErrorCode::InvalidRequest,
        Fail::NoPlayable => ErrorCode::NoPlayable,
        Fail::Upstream(e) if e.is_timeout() => ErrorCode::UpstreamTimeout,
        Fail::Upstream(_) => ErrorCode::ProviderError,
    };
    if matches!(code, ErrorCode::UpstreamTimeout | ErrorCode::ProviderError) {
        let place = if cmd == "lyric" { "lyric" } else { "cmd" };
        let _ = out.send(log_json(LogLevel::Warn, place, "upstream request failed"));
    }
    let message = serde_json::to_value(code)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    wire::err(id, code, &message)
}

async fn dispatch(client: &Client, out: &Out, req: &wire::Request) -> CmdResult {
    let a = &req.args;
    match req.cmd.as_str() {
        "song_url" => media::song_url(client, out, a).await,
        "lyric" => media::lyric(client, a).await,
        "account" => auth::account(client).await,
        cmd if catalog::handles(cmd) => catalog::run(client, cmd, a).await,
        cmd if library::handles(cmd) => library::run(client, cmd, a).await,
        // 未知命令(含 NCM 专属的 comments / discover 等)单独成码,不回显命令名
        _ => Err(Fail::Unknown),
    }
}
