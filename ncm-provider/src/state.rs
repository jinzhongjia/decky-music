//! 共享类型:进程状态 State、写出通道 Out、上游超时。命令类型见 protocol.rs。

use std::future::Future;
use std::time::Duration;

use ncm_api_rs::{create_client, ApiClient};
use tokio::sync::{mpsc, Mutex};
use tokio::time::{error::Elapsed, timeout};

use crate::device::{self, Device};

/// 单一写出通道:命令响应 + 事件都经它串行写回 socket,避免并发写乱帧。
pub type Out = mpsc::UnboundedSender<String>;

/// 上游网易云接口的统一超时:每个请求独立兜底,避免断网调用永久挂住 bridge。
pub const NET_TIMEOUT: Duration = Duration::from_secs(15);

/// 给上游 Future 套 NET_TIMEOUT。超时返回 Err(Elapsed)。
pub async fn with_timeout<F: Future>(fut: F) -> Result<F::Output, Elapsed> {
    timeout(NET_TIMEOUT, fut).await
}

/// provider 进程状态。凭证不自持久化(bridge 是真相源,经 set_credential 注入);
/// 设备身份是唯一的例外,见 device.rs。
pub struct State {
    pub client: ApiClient, // create_client(None),cookie 走 Query 逐次覆盖
    pub cookie: Mutex<Option<String>>,
    /// uid 缓存:资产/电台类命令都要 uid,避免每个命令先打一发 login_status
    /// (一屏多命令时延叠加)。set_credential 时清空。
    pub uid: Mutex<Option<String>>,
    device: Device,
}

impl State {
    pub fn new(state_dir: Option<&str>) -> Self {
        Self {
            client: create_client(None),
            cookie: Mutex::new(None),
            uid: Mutex::new(None),
            device: device::load(state_dir),
        }
    }

    /// 发请求时实际带的 cookie:设备锚点 +(已登录则)凭证。
    ///
    /// 永远是 `Some`。未登录也要带锚点 —— 搜索、榜单这些匿名命令一样在暴露指纹,
    /// 而且登录流程本身就该用与登录后同一台"设备"。判断是否登录用 `credential()`。
    pub async fn cookie(&self) -> Option<String> {
        let pins = self.device.cookie_pins();
        Some(match self.credential().await {
            Some(c) => format!("{pins}; {c}"),
            None => pins,
        })
    }

    /// 只要设备锚点、不带凭证。登录流程用:换账号时把旧 MUSIC_U 发给登录接口没有好处。
    pub fn device_pins(&self) -> Option<String> {
        Some(self.device.cookie_pins())
    }

    /// 已登录凭证,`None` = 未登录。只用于登录判定与登出。
    pub async fn credential(&self) -> Option<String> {
        self.cookie.lock().await.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 我们交给 Query::cookie() 的那串字符串是这里唯一能控的边界:四个设备锚点必须在,
    /// 凭证必须跟在后面。库那边是 `or_insert`,键在了它就不会再随机生成。
    #[tokio::test]
    async fn cookie_carries_pins_with_and_without_credential() {
        let st = State::new(None);

        let anon = st.cookie().await.unwrap();
        for k in ["deviceId=", "_ntes_nuid=", "_ntes_nnid=", "WNMCID="] {
            assert!(anon.contains(k), "未登录时缺 {k}");
        }

        *st.cookie.lock().await = Some("MUSIC_U=deadbeef".into());
        let signed = st.cookie().await.unwrap();
        assert!(signed.starts_with(&anon), "登录前后设备锚点必须是同一套");
        assert!(signed.ends_with("; MUSIC_U=deadbeef"));

        // 登录流程只带锚点,不把旧凭证发给登录接口
        assert_eq!(st.device_pins().unwrap(), anon);
    }
}
