"""Child executable installation, environment and process primitives."""

import asyncio
import os
import decky
from log import DEV, log, pump_stderr
from session_env import audio_environment


def BIN(name: str) -> str:
    # 拼出插件 bin/ 下二进制的绝对路径,供 spawn 子进程用。
    # 安装目录运行时才由 DECKY_PLUGIN_DIR 决定,不能写死。
    # 二进制经 remote_binary(正式)或开发期侧载放入 bin/。
    # 例:BIN("player") → .../decky-music/bin/player
    return os.path.join(decky.DECKY_PLUGIN_DIR, "bin", name)


def _child_env() -> dict:
    # 保留有效的用户音频会话,否则按实际有效 UID 查找;不假定 deck/1000。
    env = audio_environment()
    # provider 持久化自己的设备身份用(QQ 后端的伪造安卓机档案)。不持久化的话每次重启
    # 都是一台新设备,同账号同 IP 冒出大量新设备正是风控特征,见 issue #44。
    env["DECKY_MUSIC_STATE_DIR"] = decky.DECKY_PLUGIN_SETTINGS_DIR
    if DEV:
        env["DECKY_MUSIC_DEBUG"] = "1"  # 子进程据此决定是否发 debug 日志(release 省 IPC)
    # glibc 默认按线程数开 malloc arena(最多 8×核数),各自保留空闲内存不还系统;
    # 两个子进程线程都很少,封顶 2 个 arena 能压住常驻内存随时间上涨。
    env["MALLOC_ARENA_MAX"] = "2"
    return env


def stop_child(proc, hard: bool = False):
    """停掉子进程,已经退出的也安全。

    asyncio 的 Process.terminate() 对已退出的进程抛 ProcessLookupError。子进程自己崩了
    (或被判死杀掉)之后再切 provider 就会撞上,异常从 set_provider 冒出去,此后再也切不动,
    只能重启 Steam。真机复现过。
    hard=True 用 SIGKILL:判死的进程可能正卡在不响应的状态,别指望它体面退出。
    """
    if proc is None:
        return
    try:
        proc.kill() if hard else proc.terminate()
    except ProcessLookupError:
        pass  # 已经没了 —— 正是想要的结果


async def spawn(source: str, *args: str) -> asyncio.subprocess.Process:
    log("bridge", "own", "info", "spawning player" if source == "player" else "spawning provider")
    # ponytail: full-zip 装机经 Decky extractall 落地会丢执行位;spawn 前补 +x 兜底。
    # 幂等(remote_binary/侧载本就 +x),best-effort 不阻断 spawn。
    try:
        os.chmod(args[0], 0o755)
    except OSError:
        pass
    proc = await asyncio.create_subprocess_exec(
        *args,
        env=_child_env(),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    asyncio.create_task(pump_stderr(source, proc.stderr))
    return proc
