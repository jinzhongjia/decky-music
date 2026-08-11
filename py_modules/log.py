"""bridge 统一日志:包裹 decky.logger。见 AGENTS.md「Logging rules」。

放 py_modules/ 是因为 Decky 只把该目录加进 sys.path,CLI 也会把它打进插件包
(main.py 同级的普通 .py 不会被打包)。日志一律英文、不含密钥/URL/cookie。
"""

import logging
import os
import re

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


# 每次启动必现的库级探测噪声(issue #46)。ALSA/PipeWire 枚举候选设备时逐个试探,试不通
# 就往 stderr 打印,紧随其后 player 自己会经 socket 通道报 "audio: default audio device
# opened" —— 也就是说这些行并非"非预期输出",却每次都占满 release 日志顶部的 WARNING,
# 把 stderr「出现即可疑」的信号价值稀释掉。
#
# 降级为 debug 而不是丢弃:dev 下照样看得到,排查真实音频问题时不丢线索。
# 有意写窄 —— 只列观测到的具体形态,不用 "ALSA lib" 前缀一刀切,否则会连真实的设备级
# 报错一起吞掉。新形态宁可先以 warn 冒出来,再按需补进这张表。
_STDERR_NOISE = (
    # PipeWire/JACK 尝试连接播放端口:cannot connect player.P.1467.2:out_000 to system:playback_1
    re.compile(r"^cannot connect \S+:out_\d+ to system:playback_\d+$"),
    # OSS 兼容层探测:ALSA lib pcm_oss.c:404:(_snd_pcm_oss_open) Cannot open device /dev/dsp
    re.compile(r"^ALSA lib pcm_oss\.c:\d+:\(_snd_pcm_oss_open\) Cannot open device /dev/dsp$"),
    # dmix 插件在已被独占的设备上试探
    re.compile(r"^ALSA lib pcm_dmix\.c:\d+:\(snd_pcm_dmix_open\) unable to open slave$"),
    # 配置里列了本机没有的 PCM 名
    re.compile(r"^ALSA lib pcm\.c:\d+:\(snd_pcm_open_noupdate\) Unknown PCM "),
    re.compile(r"^ALSA lib confmisc\.c:\d+:\([\w.]+\) (Unknown|Cannot find) "),
)


def stderr_level(text: str) -> str:
    """子进程 stderr 单行该记什么级别:已知库级探测噪声 → debug,其余 → warn。"""
    return "debug" if any(p.search(text) for p in _STDERR_NOISE) else "warn"


async def pump_stderr(source: str, stream):
    """子进程 stderr = 非预期输出(panic / traceback / native 报错),逐行落日志兜底。

    已知的库级探测噪声降到 debug(见 _STDERR_NOISE),好让 release 日志里剩下的 stderr
    行都真的值得看。
    """
    while stream and (line := await stream.readline()):
        text = line.decode(errors="replace").rstrip()
        if text:
            log(source, "stderr", stderr_level(text), text)


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
