//! player:拿 URL → HTTP 拉流 → 解码 → 推 PipeWire;上报进度/结束。
//!
//! 入口: `player --socket <path>`。bridge 作 server,player 连入;收 NDJSON 命令、
//! 发 NDJSON 事件。控制面命令:load / pause / resume / volume / seek / stop。
//!
//! rodio 的 OutputStream/Sink 是 !Send,不能跨 tokio await,所以音频跑在专用 OS 线程上,
//! 与 tokio 侧用 channel 通信。

mod audio;
mod logging;
mod protocol;
mod socket;
mod stream;
mod util;

use socket::socket_loop;
use util::arg;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let socket = arg("--socket").expect("--socket <path> required");
    tokio::runtime::Runtime::new()?.block_on(socket_loop(&socket))
}
