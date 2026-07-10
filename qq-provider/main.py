"""qq-provider:QQ 音乐 provider。qqmusic_api 作库,包一层 UDS + NDJSON server。

bridge 作 server,provider 启动后连入 `--socket <path>`。无状态:credential 由 bridge
经 set_credential 注入(登录成功后 bridge 持久化),provider 不自存。用 Nuitka
--standalone 打包(scripts/build-qq-provider.sh)。

命令:set_credential / login / song_url / search / lyric / recommend / playlist_songs。
登录是长流程,以事件上报。
"""

import argparse
import asyncio
import json

import protocol
from log import make_log  # 日志实现见 log.py
from qq import QQ
from qq.library import NotLoggedIn, _as_bool, _as_int, _as_str, _limit, _offset, keyword

# 上游调用兜底超时(秒):每个请求独立兜底,避免断网调用永久挂住 bridge。
# 15s < bridge 的 30s,对齐 ncm 的 NET_TIMEOUT。
UPSTREAM_TIMEOUT = 15


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True)
    args = parser.parse_args()

    reader, writer = await asyncio.open_unix_connection(args.socket)
    qq = QQ()
    out: asyncio.Queue = asyncio.Queue()  # 响应 + 事件汇到单写出,避免并发写乱帧

    async def pump():
        while True:
            line = await out.get()
            writer.write((json.dumps(line, ensure_ascii=False) + "\n").encode())
            await writer.drain()

    def emit(typ: str, **data):
        # 发一条 login 域事件(协议 v1:{ev:"login",type,data})
        out.put_nowait(protocol.login_event(typ, data))

    log = make_log(out)

    asyncio.create_task(pump())
    in_flight: set[asyncio.Task] = set()

    def track(coro):
        task = asyncio.create_task(coro)
        in_flight.add(task)
        task.add_done_callback(in_flight.discard)

    # NDJSON:每条一行 {json}\n,UTF-8(协议 v1)。命令处理后台化,慢上游不堵读循环。
    while line := await reader.readline():
        try:
            raw = json.loads(line)
        except json.JSONDecodeError:
            log("warn", "protocol", "bad json frame")
            continue
        try:
            req = protocol.decode_request(raw)
        except protocol.ProtocolError as e:
            rid = raw.get("id") if isinstance(raw, dict) else None
            if isinstance(rid, int) and not isinstance(rid, bool):
                await out.put(protocol.err(rid, "invalid_request", str(e)))
            else:
                log("warn", "protocol", f"bad request: {e}")
            continue
        track(_run_request(qq, req, emit, log, out))



async def _run_request(qq: QQ, req: protocol.Request, emit, log, out):
    try:
        resp = await asyncio.wait_for(handle(qq, req, emit, log), UPSTREAM_TIMEOUT)
    except TimeoutError:
        log("warn", "cmd", f"{req.cmd} timed out after {UPSTREAM_TIMEOUT}s")
        resp = protocol.err(req.id, "timeout")
    except Exception as e:
        # 上游库异常(断网 curl Timeout / NetworkError 等)只失败该命令,绝不崩进程。
        # Timeout 类异常映射 timeout 码:playback 的自动切歌熔断靠它识别断网。
        name = type(e).__name__
        log("warn", "cmd", f"{req.cmd} failed: {name}")
        resp = protocol.err(req.id, "timeout" if "Timeout" in name else "provider_error")
    await out.put(resp)

async def handle(qq: QQ, req: protocol.Request, emit, log) -> dict:
    args = req.args
    try:
        match req.cmd:
            case "set_credential":
                cred = args.get("cred")
                qq.set_credential(cred)
                log("info", "credential", "injected" if cred else "cleared")
                # 过期则刷新;新凭证随响应回传 bridge 持久化(provider 无状态,bridge 是真相源)
                refreshed = await qq.refresh_if_expired(log) if cred else None
                if refreshed:
                    log("info", "credential", "refreshed expired credential")
                return protocol.ok(req.id, {"refreshed": refreshed})
            case "login":
                # 长流程:后台跑,QR 与状态经 login 事件上报;命令本身即刻返 ok
                if qq.login_task and not qq.login_task.done():
                    qq.login_task.cancel()  # 顶掉上一个未结束的登录轮询,避免双循环并发 emit
                qq.login_task = asyncio.create_task(qq.login(emit, log, args.get("type") or "qq"))
                return protocol.ok(req.id)
            case "logout":
                await qq.logout()
                log("info", "logout", "done")
                return protocol.ok(req.id)
            case "account":
                return protocol.ok(req.id, await qq.account())
            case "song_url":
                song_id = args.get("id", "")
                log("debug", "song_url", f"id={song_id}")
                url = await qq.song_url(song_id, args.get("media_mid", ""))
                if url:
                    return protocol.ok(req.id, {"url": url})
                log("warn", "song_url", f"no playable url id={song_id} (no rights / login / VIP)")
                return protocol.err(req.id, "no_playable")
            case "search":
                kw = args.get("keyword", "")
                songs = await qq.search(kw)
                log("debug", "search", f"kw={kw} -> {len(songs)} songs")
                return protocol.ok(req.id, {"songs": songs})
            case "search_songs":
                songs = await qq.search_songs(keyword(args), _limit(args), _offset(args))
                log("debug", "search_songs", f"-> {len(songs)} songs")
                return protocol.ok(req.id, {"songs": songs})
            case "search_playlists":
                playlists = await qq.search_playlists(keyword(args), _limit(args), _offset(args))
                log("debug", "search_playlists", f"-> {len(playlists)} lists")
                return protocol.ok(req.id, {"playlists": playlists})
            case "search_albums":
                albums = await qq.search_albums(keyword(args), _limit(args), _offset(args))
                log("debug", "search_albums", f"-> {len(albums)} albums")
                return protocol.ok(req.id, {"albums": albums})
            case "search_artists":
                artists = await qq.search_artists(keyword(args), _limit(args), _offset(args))
                log("debug", "search_artists", f"-> {len(artists)} artists")
                return protocol.ok(req.id, {"artists": artists})
            case "user_assets":
                return protocol.ok(req.id, await qq.user_assets())
            case "fav_songs":
                songs = await qq.fav_songs(_limit(args), _offset(args))
                log("debug", "fav_songs", f"-> {len(songs)} songs")
                return protocol.ok(req.id, {"songs": songs})
            case "recent_songs":
                songs = await qq.recent_songs(_limit(args), _offset(args))
                return protocol.ok(req.id, {"songs": songs})
            case "created_playlists":
                playlists = await qq.created_playlists(_limit(args), _offset(args))
                return protocol.ok(req.id, {"playlists": playlists})
            case "fav_playlists":
                playlists = await qq.fav_playlists(_limit(args), _offset(args))
                return protocol.ok(req.id, {"playlists": playlists})
            case "like_song":
                ok = await qq.like_song(_as_str(args, "id"), _as_bool(args, "on"))
                log("debug", "like_song", f"id={args.get('id', '')} on={args.get('on')} -> {ok}")
                return protocol.ok(req.id, {"success": ok})
            case "add_to_playlist":
                ok = await qq.add_to_playlist(
                    _as_int(args, "playlist_id"),
                    _as_str(args, "song_id"),
                )
                return protocol.ok(req.id, {"success": ok})
            case "artist_detail":
                data = await qq.artist_detail(_as_str(args, "id"), _limit(args), _offset(args))
                return protocol.ok(req.id, data)
            case "album_detail":
                data = await qq.album_detail(
                    _as_str(args, "id"),
                    _limit(args, default=50),
                    _offset(args),
                )
                return protocol.ok(req.id, data)
            case "radio_fetch":
                songs = await qq.radio_fetch(_as_str(args, "kind"))
                return protocol.ok(req.id, {"songs": songs})
            case "recommend":
                data = await qq.recommend()
                counts = f"{len(data['playlists'])} lists, {len(data['newsongs'])} songs"
                log("debug", "recommend", counts)
                return protocol.ok(req.id, data)
            case "playlist_songs":
                songs = await qq.playlist_songs(args.get("id", ""))
                log("debug", "playlist_songs", f"id={args.get('id', '')} -> {len(songs)} songs")
                return protocol.ok(req.id, {"songs": songs})
            case "lyric":
                mid = args.get("id", "")
                try:
                    data = await qq.lyric(mid)
                except Exception as e:  # 歌词非命门:拉取失败不崩进程,返 provider_error
                    log("warn", "lyric", f"failed: {type(e).__name__}")
                    return protocol.err(req.id, "provider_error")
                log("debug", "lyric", f"id={mid} -> {len(data['lines'])} lines")
                return protocol.ok(req.id, data)
            case _:
                return protocol.err(req.id, "unknown_cmd")
    except NotLoggedIn:
        return protocol.err(req.id, "not_logged_in")
    except ValueError as e:
        return protocol.err(req.id, "invalid_request", str(e))


if __name__ == "__main__":
    asyncio.run(main())
