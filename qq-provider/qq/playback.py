"""取可播 URL。

song_url 走 musicu.fcg 的 vkey **bypass**:用 curl_cffi 的官方浏览器 TLS 指纹(JA3)+ 安全 ct 值
发请求,绕开库默认 ct=11 触发的地区版权降级与 CDN 风控。做法参考 quaverq(已在真机验证可用)。
不记 URL(含限时 vkey)。
"""

import asyncio
import hashlib

# 能拿到高音质的 ct 值。**ct 不只是反风控开关,它同时决定服务端愿意下发哪些音质。**
# 真机实测(同账号同曲扫 ct=2..30):ct=2/6/26 只给 128k,FLAC 与 320k 一律空;
# ct=11(库默认)连 128k 都不给;下面这些三档全通。
#
# 坑在于 quaverq 那份 safe-ct 列表是用 MP3_128 探出来的("用最低档探测,信号最干净"),
# 所以它包含 2/6/26 —— 低档能过、高档静默被拒。我们当初正好抄中 6,于是一个 SVIP
# 年费账号也只能听 128k,而且没有任何报错。
HIGH_QUALITY_CT = (5, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 20, 21, 22, 24, 25, 28, 29, 30)
IMPERSONATE = "chrome"
CDN_FALLBACK = "https://isure.stream.qqmusic.qq.com/"
MUSICU = "https://u.y.qq.com/cgi-bin/musicu.fcg"


def _ct_for(guid: str) -> int:
    """按 guid 派生 ct:同一台"设备"永远同一个值,不同安装分散到不同值。

    不固定成常量:所有安装共用一个 ct 就是"同一指纹从大量 IP 冒出来",正是风控特征
    (同 issue #44 的设备身份持久化那笔账)。也不每次随机:同一设备来回换 ct 一样可疑。
    guid 已经落盘持久化(见 qq/__init__.py),拿它做种子既稳定又天然分散,不用额外存东西。
    """
    if not guid:
        return HIGH_QUALITY_CT[0]
    digest = hashlib.sha256(guid.encode()).digest()
    return HIGH_QUALITY_CT[digest[0] % len(HIGH_QUALITY_CT)]


# 音质阶梯:(档位名, filename 前缀, 扩展名),从高到低。
# 前缀取自 qqmusic_api 的 SongFileType;只列 player 解得动的格式(rodio 默认带
# flac/mp3/ogg/m4a/wav)—— 加密档(.mflac/.mgg)是 DRM,NAC / DTS:X / 杜比全景声
# 需要专有解码器,都不行。
#
# 每档两个前缀:FLAC/MP3 是主力,OGG 兜一手。真机实测三首热门曲在可用 ct 下
# F000/M800/O800 都能拿到,O801 部分曲目有。真正无损(FLAC)排在 OGG 640 前面 ——
# 用户选的是"无损",就先给真无损;拿不到再退 OGG。反正批量单请求,多带几档零成本。
LADDER = [
    ("lossless", "F000", "flac"),  # SQ 无损(FLAC)
    ("lossless", "O801", "ogg"),  # SQ(OGG 640,部分曲目才有)
    ("high", "M800", "mp3"),  # HQ 320(MP3)
    ("high", "O800", "ogg"),  # HQ 320(OGG)
    ("standard", "M500", "mp3"),  # 标准 128
]
# 有序去重的档位名(每档有多个前缀,不能直接取 LADDER 的第一列)
QUALITIES = list(dict.fromkeys(name for name, _, _ in LADDER))
DEFAULT_QUALITY = "high"


def _ladder(quality: str):
    """从所选上限往下的阶梯。上限之上的档不问 —— 用户选标准就别偷偷给无损。

    永远保留下面所有档作兜底:选了无损也必须能播无版权 / 非会员的歌,否则这个功能
    就变成「一开就有一半歌放不出来」。
    """
    if quality not in QUALITIES:
        quality = DEFAULT_QUALITY
    at = next(i for i, (name, _, _) in enumerate(LADDER) if name == quality)
    return LADDER[at:]


async def song_url(
    q, mid: str, media_mid: str = "", quality: str = DEFAULT_QUALITY
) -> tuple[str | None, str]:
    """取可播完整 URL。返回 (url, 命中档位);全档不可下发(无版权/需 VIP)返 (None, "")。

    **一次请求问全部档位**:vkey 接口的 filename 是数组,响应 midurlinfo 按下标一一
    对应。以前逐档试最坏要 5 次往返(约 1.7s),现在恒定 1 次;而且拿到的是真正最高
    可用档,不是"第一个应答的档"。

    命中档位进日志 —— 选了无损实际降到 320k 时,不留痕没人查得出来。
    """
    cred = q.client.credential
    file_mid = media_mid or mid
    tiers = _ladder(quality)
    names = [f"{prefix}{file_mid}{file_mid}.{ext}" for _, prefix, ext in tiers]
    data = await _vkey(q, names, mid, cred)
    info = data.get("midurlinfo") or []
    # 按阶梯顺序取第一个有 purl 的。strict=False 是刻意的:上游少回几条时按短的截断,
    # 不能抛 —— provider 绝不因为上游返回形状怪就崩。
    for (name, _, _), entry in zip(tiers, info, strict=False):
        purl = (entry or {}).get("purl") or ""
        if purl:
            return _full_url(purl), name
    return None, ""


async def _vkey(q, filenames: list[str], mid: str, cred) -> dict:
    """一次问多个 filename。songmid / songtype 必须与 filename 等长,否则响应对不上号。"""
    guid = await q.get_guid()
    comm = {"ct": _ct_for(guid), "cv": 0}  # ct 决定能拿到哪些音质,见 _ct_for
    if cred and cred.musickey:
        comm["qq"] = str(cred.musicid)
        comm["authst"] = cred.musickey
    body = {
        "comm": comm,
        "req_0": {
            "module": "music.vkey.GetVkey",
            "method": "UrlGetVkey",
            "param": {
                "filename": filenames,
                "guid": guid,
                "songmid": [mid] * len(filenames),
                "songtype": [0] * len(filenames),
            },
        },
    }
    data = await asyncio.to_thread(_post_impersonate, body)
    return data.get("req_0", {}).get("data", {}) or {}


def _post_impersonate(body: dict) -> dict:
    # 反风控:curl_cffi 用官方浏览器 TLS 指纹(JA3)+ UA 发 musicu.fcg
    from curl_cffi import requests as creq

    return creq.post(MUSICU, json=body, impersonate=IMPERSONATE, timeout=10).json()


def _full_url(purl: str) -> str:
    # purl 多为裸路径(F000xxx.mp3?vkey=…);个别直接返完整 URL,原样用(http 升 https)
    if purl.startswith("https://"):
        return purl
    if purl.startswith("http://"):
        return "https://" + purl[len("http://") :]
    return CDN_FALLBACK + purl
