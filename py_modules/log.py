"""bridge 统一日志:包裹 decky.logger。见 AGENTS.md「Logging rules」。

放 py_modules/ 是因为 Decky 只把该目录加进 sys.path,CLI 也会把它打进插件包
(main.py 同级的普通 .py 不会被打包)。日志一律英文、不含密钥/URL/cookie。
"""

import logging
import os

import decky

# dev/release 判定:deploy.sh 侧载时在插件目录 touch dev_mode;release 的 zip 不含它。
DEV = os.path.exists(os.path.join(decky.DECKY_PLUGIN_DIR, "dev_mode"))
# dev 输出 debug,release 过滤 debug(info/warn/error 两模式都输出)
decky.logger.setLevel(logging.DEBUG if DEV else logging.INFO)

_LEVELS = {"debug": logging.DEBUG, "info": logging.INFO, "warn": logging.WARNING, "error": logging.ERROR}


def log(source: str, origin: str, level: str, msg: str):
    """source ∈ bridge|player|provider;origin ∈ own|socket|stderr;
    level ∈ debug(仅 dev)|info|warn|error。"""
    decky.logger.log(_LEVELS.get(level, logging.INFO), "[%s·%s] %s", source, origin, msg)


async def pump_stderr(source: str, stream):
    """子进程 stderr = 非预期输出(panic / traceback / native 报错),逐行落日志兜底。"""
    while stream and (line := await stream.readline()):
        text = line.decode(errors="replace").rstrip()
        if text:
            log(source, "stderr", "warn", text)


def dir_size(path: str) -> int:
    """目录下直属普通文件字节数求和;目录不存在返回 0。日志目录是扁平的,不递归。"""
    try:
        return sum(
            os.path.getsize(e.path)
            for e in os.scandir(path)
            if e.is_file(follow_symlinks=False)
        )
    except FileNotFoundError:
        return 0


def clear_log_dir(path: str) -> None:
    """把目录下每个直属普通文件截断为 0(不删除)。目录不存在则无操作。

    截断而非删除:decky.logger 的 FileHandler 以 append 模式持有当前日志,截断后下次写入从
    0 续写(O_APPEND,无空洞);删除会让它继续写向已 unlink 的 inode,文件"消失"到下次轮转。
    # ponytail: 假设 handler 为 append 模式(logging.FileHandler 默认如此);若 Decky 改用
    # seek 定位的 handler,升级为按 decky.logger.handlers 逐个 flush+truncate(0)+seek(0)。
    """
    try:
        entries = list(os.scandir(path))
    except FileNotFoundError:
        return
    for e in entries:
        if e.is_file(follow_symlinks=False):
            with open(e.path, "w"):
                pass


def clear_logs() -> int:
    """清空插件日志目录,返回清理后的剩余字节数(供 UI 回填)。"""
    d = decky.DECKY_PLUGIN_LOG_DIR
    clear_log_dir(d)
    log("bridge", "own", "info", "logs cleared")  # 留一条确认痕迹
    return dir_size(d)


def log_dir_size() -> int:
    return dir_size(decky.DECKY_PLUGIN_LOG_DIR)
