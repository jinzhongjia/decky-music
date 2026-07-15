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
