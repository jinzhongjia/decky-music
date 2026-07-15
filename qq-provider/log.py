"""provider 结构化日志事件。见 AGENTS.md「Logging rules」。

bridge 收 {"ev":"log",...} 后落 decky.logger(origin=socket)。日志一律英文、不含密钥/cookie。
"""

import os

DEBUG = bool(os.environ.get("DECKY_MUSIC_DEBUG"))  # bridge 在 dev 模式下注入


def make_log(out):
    """返回 log(level, where, msg):把结构化日志事件塞进 out 队列。
    release 下不发 debug(省 IPC)。level ∈ debug|info|warn|error。"""

    def log(level: str, where: str, msg: str):
        if level == "debug" and not DEBUG:
            return
        out.put_nowait({"ev": "log", "level": level, "where": where, "msg": msg})

    return log
