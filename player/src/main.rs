//! player:拿 URL → HTTP 拉流 → 解码 → 推 PipeWire;上报进度/结束。
//!
//! 入口: `player --socket <path>`。bridge 作 server,player 连入;收 NDJSON 命令、
//! 发 NDJSON 事件。控制面命令:load / pause / resume / volume / seek / stop。
//!
//! rodio 的 OutputStream/Sink 是 !Send,不能跨 tokio await,所以音频跑在专用 OS 线程上,
//! 与 tokio 侧用 channel 通信。

mod audio;
mod loading;
mod mpris;
mod protocol;
mod socket;
mod stream;
mod util;

use socket::socket_loop;
use util::arg;

/// player 的 nice 值:比 provider 高(要按时喂音频),但仍低于前台游戏。
/// 音频缓冲足够大(见 audio::DEVICE_BUFFER_FRAMES),轻度让路不会断音。
const NICENESS: i32 = 5;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let socket = arg("--socket").expect("--socket <path> required");
    wire::lower_priority(NICENESS);
    // 单线程运行时:控制面、HTTP 拉流与 MPRIS 都是 IO;解码出声在独立音频线程。
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(socket_loop(&socket))
}
