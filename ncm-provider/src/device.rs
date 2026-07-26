//! 设备身份持久化:生成一次、落盘、之后每个请求都带同一套。
//!
//! 为什么需要:ncm-api-rs 在 `request()` 里往 cookie 里 `or_insert` 一批设备/追踪字段 ——
//! `deviceId` 和 `WNMCID` 是进程级 `LazyLock` 随机值(provider 每重启一次就是一台新设备),
//! `_ntes_nuid` / `_ntes_nnid` 更是**每个请求**重新 `random_hex(16)`。同一账号同一 IP
//! 每发一个请求就换一个访问者标识,不是正常客户端会有的样子。
//!
//! 库那边用的是 `or_insert`:我们的 cookie 里已经有这些键,它就不再随机生成。所以修法
//! 只是把它们钉住,不碰库。同源问题在 QQ 侧见 issue #44。

use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const FILE: &str = "ncm-device.json";

#[derive(Serialize, Deserialize)]
pub struct Device {
    device_id: String, // 52 位大写 hex,对齐库的 generate_device_id
    ntes_nuid: String, // 32 位小写 hex,对齐库的 random_hex(16)
    ntes_nnid: String, // "{nuid},{生成时刻 ms}"
    wnmcid: String,    // "{6 个小写字母}.{生成时刻 ms}.01.0"
}

impl Device {
    /// 附在每个请求 cookie 里的设备锚点。
    pub fn cookie_pins(&self) -> String {
        format!(
            "deviceId={}; _ntes_nuid={}; _ntes_nnid={}; WNMCID={}",
            self.device_id, self.ntes_nuid, self.ntes_nnid, self.wnmcid
        )
    }

    fn generate() -> Self {
        let nuid = hex_lower(16);
        let ms = now_ms();
        Self {
            device_id: hex_upper(26), // 26 字节 → 52 个 hex 字符
            ntes_nnid: format!("{nuid},{ms}"),
            ntes_nuid: nuid,
            wnmcid: format!("{}.{ms}.01.0", letters(6)),
        }
    }
}

/// 读设备文件;不存在或读不动就生成一个并落盘。
///
/// `state_dir` 由 bridge 经 `DECKY_MUSIC_STATE_DIR` 注入。缺失(如直接起进程做测试)时
/// 退回进程内随机,行为等同库的默认,不为此挡住启动。
pub fn load(state_dir: Option<&str>) -> Device {
    let Some(path) = state_dir.map(|d| PathBuf::from(d).join(FILE)) else {
        return Device::generate();
    };
    if let Some(dev) = read(&path) {
        return dev;
    }
    let dev = Device::generate();
    // 里面是伪造的设备标识,按 settings.json 同口径存 0600。用 OpenOptions 直接带
    // mode 建,不走"先写再 chmod" —— 那中间有一段窗口文件是 0644 的。
    if let Ok(s) = serde_json::to_string(&dev) {
        let _ = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .and_then(|mut f| f.write_all(s.as_bytes()));
    }
    dev
}

fn read(path: &Path) -> Option<Device> {
    let s = fs::read_to_string(path).ok()?;
    let dev: Device = serde_json::from_str(&s).ok()?;
    // 早期版本可能以 0644 落过盘,读到就顺手收紧。
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    Some(dev)
}

/// 随机字节。部署目标是 SteamOS,读 /dev/urandom 就够,不为四行代码引 rand。
fn rand_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    match fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut buf)) {
        Ok(()) => buf,
        // Linux 上打不开 /dev/urandom 基本不可能,但也绝不能返回全零 ——
        // 那等于所有安装共用同一个设备 ID,比每次随机还糟。退回纳秒时钟凑数。
        Err(_) => {
            let ns = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(1);
            ns.to_le_bytes().iter().cycle().take(n).copied().collect()
        }
    }
}

fn hex_upper(bytes: usize) -> String {
    rand_bytes(bytes)
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect()
}

fn hex_lower(bytes: usize) -> String {
    rand_bytes(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn letters(n: usize) -> String {
    // 取模偏置对一个追踪 cookie 无所谓
    rand_bytes(n)
        .iter()
        .map(|b| (b'a' + b % 26) as char)
        .collect()
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 命门:同一个 state_dir 重复 load 必须拿到同一套身份 —— 否则这个模块白写。
    #[test]
    fn load_is_stable_across_restarts() {
        let dir = std::env::temp_dir().join(format!("ncm-dev-test-{}", now_ms()));
        fs::create_dir_all(&dir).unwrap();
        let d = dir.to_str().unwrap();

        let first = load(Some(d)).cookie_pins();
        let second = load(Some(d)).cookie_pins(); // 模拟 provider 重启
        assert_eq!(first, second);

        let mode = fs::metadata(dir.join(FILE)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        fs::remove_dir_all(&dir).ok();
    }

    /// 格式要对齐库自己生成的那套,否则形状本身就是特征。
    #[test]
    fn pins_match_upstream_shapes() {
        let pins = Device::generate().cookie_pins();
        let kv: std::collections::HashMap<_, _> =
            pins.split("; ").filter_map(|p| p.split_once('=')).collect();
        assert_eq!(kv["deviceId"].len(), 52);
        assert!(kv["deviceId"]
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_lowercase()));
        assert_eq!(kv["_ntes_nuid"].len(), 32);
        assert!(kv["_ntes_nuid"]
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()));
        assert!(kv["_ntes_nnid"].starts_with(&format!("{},", kv["_ntes_nuid"])));
        assert!(kv["WNMCID"].ends_with(".01.0"));
    }

    /// 两次生成必须不同,否则说明随机源坏了(全零兜底那条路)。
    #[test]
    fn generate_is_random() {
        assert_ne!(Device::generate().device_id, Device::generate().device_id);
    }
}
