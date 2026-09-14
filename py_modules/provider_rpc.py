"""Provider account, catalogue and radio RPC orchestration."""

import asyncio
import decky
import protocol
import settings
from ipc import ConnectionOrigin
from log import log
from diagnostics import safe_code, safe_command, safe_event
from queue_items import songs_to_items


class ProviderRPC:
    async def _refresh_credential(self) -> bool:
        """重注入当前凭证触发 provider 侧过期检测/刷新(QQ musickey 有效期撑不过长会话;
        NCM 无刷新概念,幂等无害)。返回是否真的刷新了(供播放失败重试判断值不值得再试)。"""
        origin = self.provider.origin
        if not self.provider.is_current(origin):
            return False
        which = origin.provider
        cred = (self.settings.get("accounts") or {}).get(which)
        if not cred:
            return False
        r = await self.provider.request("set_credential", {"cred": cred})
        if not self.provider.is_current(origin):
            return False
        new_cred = r.data.get("refreshed") if r.ok else None
        if new_cred:
            self.settings.setdefault("accounts", {})[which] = new_cred
            settings.save_settings(self.settings)
            log("bridge", "own", "info", f"{which} credential refreshed mid-session, persisted")
            return True
        return False

    async def _credential_refresh_loop(self):
        # 每小时查一次过期(曾发生 13h 长会话 musickey 过期 → 全部歌报"无权限");
        # 播放路径另有 no_playable 时的即时刷新重试兜底,这里把常态过期窗口压到 ≤1h
        while True:
            await asyncio.sleep(3600)
            try:
                await self._refresh_credential()
            except Exception:
                log("bridge", "own", "debug", "credential refresh failed")

    def _kick_seed_liked(self):
        # 红心种子(P6):后台拉服务器已收藏 id 全集灌 liked_ids,跨会话点亮与服务器一致。
        # 双端 liked_ids 命令:NCM likelist 全量;QQ get_fav_song 大 num 一发拉全(quaverq 实证)。
        origin = self.provider.origin

        async def seed():
            if not self.provider.is_current(origin):
                return
            try:
                r = await self.provider.request("liked_ids")
                if not self.provider.is_current(origin):
                    return
                if r.ok:
                    ids = {str(i) for i in r.data.get("ids", []) if i}
                    self.liked_ids |= ids  # 合并,不覆盖本会话已点的
                    log("bridge", "own", "info", f"liked seed: {len(ids)} ids")
                else:
                    code = safe_code(r.error.code) if r.error else "provider_error"
                    log("bridge", "own", "debug", f"liked seed skipped: {code}")
            except Exception:
                log("bridge", "own", "debug", "liked seed failed")

        self._track_task(seed())

    async def set_provider(self, which: str | None):
        settings.require_provider(which)
        self._provider_change_gen += 1
        gen = self._provider_change_gen
        if self.settings.get("provider") != which:
            self.provider.end_session()
            self.liked_ids.clear()  # 两家 id 体系不通用
            await self.playback.queue_clear()
        if gen != self._provider_change_gen:
            return
        # Only the latest source intent may establish a new provider lifetime.
        self.settings["provider"] = which
        settings.save_settings(self.settings)
        await self._ensure_provider(which)

    async def get_provider(self) -> dict:
        # 读回当前 provider + 是否已登录(bridge 是真相源),并幂等拉起其进程:
        # 解决"settings 预设了 provider、首次加载 UI 拿到了但进程没起"的问题。
        which = self.settings.get("provider")
        await self._ensure_provider(which)
        logged_in = bool((self.settings.get("accounts") or {}).get(which))
        log("bridge", "own", "debug", f"get_provider -> {which} loggedIn={logged_in}")
        return {"provider": which, "loggedIn": logged_in, "error": self.provider_error}

    async def login(self, login_type: str | None = None):
        await self.provider.request("login", {"type": login_type})

    async def logout(self):
        origin = self.provider.origin
        if not self.provider.is_current(origin):
            return
        which = origin.provider
        await self.provider.request("logout")
        if not self.provider.is_current(origin):
            return
        (self.settings.get("accounts") or {}).pop(which, None)
        settings.save_settings(self.settings)
        await self.provider.request("set_credential", {"cred": None})
        if not self.provider.is_current(origin):
            return
        log("bridge", "own", "info", f"{which} logged out")

    async def get_account(self) -> dict:
        # UI callable 返回沿用旧形状(账号字段平铺);失败回空对象,前端按空账号渲染。
        r = await self.provider.request("account")
        return r.data if r.ok else {}

    async def _radio_fetch(self, kind: str) -> list[dict]:
        r = await self.provider.request("radio_fetch", {"kind": kind})
        if not r.ok:
            code = safe_code(r.error.code) if r.error else "provider_error"
            log("bridge", "own", "warn", f"radio_fetch failed: {code}")
            return []
        return songs_to_items(r.data.get("songs", []))

    async def play_radio(self, kind: str) -> dict:
        # 进电台模式(P5d):拉第一批开播。失败带稳定 error code(not_logged_in 等)供前端 i18n
        r = await self.provider.request("radio_fetch", {"kind": kind})
        if not r.ok:
            code = safe_code(r.error.code) if r.error else "provider_error"
            log("bridge", "own", "warn", f"radio start failed: {code}")
            return {"ok": False, "error": code}
        ok = await self.playback.play_radio(kind, songs_to_items(r.data.get("songs", [])))
        return {"ok": bool(ok), "error": None if ok else "provider_error"}

    async def fm_trash(self):
        # FM 垃圾桶:标记当前曲不喜欢 + 切下一首(仅 radio 模式;NCM 专属)
        cur = self.playback.current_id()
        if self.playback.mode != "radio" or not cur:
            return
        r = await self.provider.request("fm_trash", {"id": cur})
        if not r.ok:
            log(
                "bridge",
                "own",
                "warn",
                f"fm_trash failed: {safe_code(r.error.code) if r.error else '?'}",
            )
        await self.playback.next_track()

    async def like_current(self, on: bool) -> dict:
        # 红心当前曲(QQ/NCM 同名命令 like_song {id, on})。
        # QQ 以 data.success 表达业务失败(如曲目查不到),必须一并校验,不能只看 r.ok。
        cur = self.playback.current_id()
        if not cur:
            log("bridge", "own", "warn", "like_current ignored: no current track")
            return {"ok": False, "error": "provider_error"}
        r = await self.provider.request("like_song", {"id": cur, "on": on})
        success = r.ok and bool(r.data.get("success", True))
        if success:
            (self.liked_ids.add if on else self.liked_ids.discard)(cur)
            log("bridge", "own", "info", "like_song succeeded")
            return {"ok": True, "error": None, "liked": on}
        code = (
            (safe_code(r.error.code) if r.error else "provider_error")
            if not r.ok
            else "provider_error"
        )
        log("bridge", "own", "warn", f"like_song failed: {code}")
        return {"ok": False, "error": code, "liked": cur in self.liked_ids}

    async def get_comments(self, song_id: str) -> dict:
        # 热评(P5f;NCM 专属命令,QQ 调用会得 unknown_cmd → 空列表 + error)
        r = await self.provider.request("comments", {"id": song_id, "limit": 30})
        if r.ok:
            return {"ok": True, "comments": r.data.get("comments", [])}
        return {
            "ok": False,
            "comments": [],
            "error": safe_code(r.error.code) if r.error else "provider_error",
        }

    async def get_user_assets(self) -> dict:
        r = await self.provider.request("user_assets")
        if r.ok:
            return {"ok": True, **r.data}
        return {"ok": False, "error": safe_code(r.error.code) if r.error else "provider_error"}

    async def _list_cmd(
        self, cmd: str, key: str, limit: int = 50, extra: dict | None = None
    ) -> dict:
        # 列表类命令统一形状:{ok, <key>: [...], error?}。首页 50 条(翻页 P6)
        args = {"limit": limit, **(extra or {})}
        r = await self.provider.request(cmd, args)
        # provider 进程没了(崩溃/被杀)时 writer 为 None,request 会立刻短路成 timeout。
        # 浏览类命令自己不经 _ensure_provider,所以在用户回到 QAM / 重进页面(那时才有
        # get_provider)之前,每次搜索翻页都报错 —— 看起来就是"插件坏了"。这里就地拉起
        # 并重试一次,把它收敛成一次用户无感的重连。只在通道确实断了时重试:上游错误
        # (无版权 / upstream_timeout 等)不该触发重开进程。
        # 判断只在失败分支里做:成功路径不碰 self.settings —— 有测试用 Bridge.__new__()
        # 构造、根本没跑过 start(),成功路径读 settings 会直接 AttributeError。
        if not r.ok and getattr(self.provider, "writer", None) is None:
            which = getattr(self, "settings", {}).get("provider")
            if which:
                log("bridge", "own", "info", f"{safe_command(cmd)}: provider gone, respawning")
                await self._ensure_provider(which)
                r = await self.provider.request(cmd, args)
        if r.ok:
            return {"ok": True, key: r.data.get(key, [])}
        code = safe_code(r.error.code) if r.error else "provider_error"
        # Never use child-provided diagnostic prose as a fallback.
        # 失败必落日志(UI 只有 error banner,无迹可查的瞬时抖动全靠这里定位)
        log("bridge", "own", "warn", f"{safe_command(cmd)} failed: {code}")
        return {"ok": False, key: [], "error": code}

    async def search_songs(self, keyword: str, offset: int = 0) -> dict:
        return await self._list_cmd(
            "search_songs", "songs", extra={"keyword": keyword, "offset": offset}
        )

    async def search_playlists(self, keyword: str, offset: int = 0) -> dict:
        return await self._list_cmd(
            "search_playlists", "playlists", extra={"keyword": keyword, "offset": offset}
        )

    async def search_albums(self, keyword: str, offset: int = 0) -> dict:
        return await self._list_cmd(
            "search_albums", "albums", extra={"keyword": keyword, "offset": offset}
        )

    async def search_artists(self, keyword: str, offset: int = 0) -> dict:
        return await self._list_cmd(
            "search_artists", "artists", extra={"keyword": keyword, "offset": offset}
        )

    async def search_hot(self) -> dict:
        # 双 provider 同名命令(qq get_hotkey / ncm search_hot_detail),形状 {keyword,label}
        return await self._list_cmd("search_hot", "keywords", 20)

    async def _detail_cmd(self, cmd: str, item_id: str) -> dict:
        r = await self.provider.request(cmd, {"id": item_id, "limit": 50})
        if r.ok:
            return {"ok": True, **r.data}
        code = safe_code(r.error.code) if r.error else "provider_error"
        log("bridge", "own", "warn", f"{safe_command(cmd)} failed: {code}")
        return {"ok": False, "error": code}

    async def get_artist_detail(self, artist_id: str) -> dict:
        return await self._detail_cmd("artist_detail", artist_id)

    async def get_album_detail(self, album_id: str) -> dict:
        return await self._detail_cmd("album_detail", album_id)

    async def get_fav_songs(self, offset: int = 0) -> dict:
        return await self._list_cmd("fav_songs", "songs", extra={"offset": offset})

    async def get_listen_rank(self, offset: int = 0) -> dict:
        return await self._list_cmd("listen_rank", "songs", extra={"offset": offset})

    async def get_created_playlists(self, offset: int = 0) -> dict:
        return await self._list_cmd("created_playlists", "playlists", extra={"offset": offset})

    async def get_fav_playlists(self, offset: int = 0) -> dict:
        return await self._list_cmd("fav_playlists", "playlists", extra={"offset": offset})

    async def add_to_playlist(self, playlist_id: str, song_id: str) -> dict:
        # 收藏到歌单(P6,X 菜单):QQ 传 dirid(add_songs 语义)、NCM 传 pid,由前端按数据形状选
        r = await self.provider.request(
            "add_to_playlist", {"playlist_id": playlist_id, "song_id": song_id}
        )
        # QQ 带 success 布尔(查无此歌等假成功),NCM 无该字段默认 True(同 like_current 口径)
        if r.ok and bool(r.data.get("success", True)):
            log("bridge", "own", "info", "add_to_playlist succeeded")
            return {"ok": True}
        code = safe_code(r.error.code) if (not r.ok and r.error) else "provider_error"
        log("bridge", "own", "warn", f"add_to_playlist failed: {code}")
        return {"ok": False, "error": code}

    async def fav_playlist(self, playlist_id: str, on: bool) -> dict:
        # 收藏/取消收藏他人歌单。id 用全局 tid/pid(QQ 的 dirid 不认;榜单 id 也不是它,
        # 故 UI 只在搜索/推荐/发现的歌单卡上给这个动作)。两端接口都幂等。
        r = await self.provider.request("fav_playlist", {"id": playlist_id, "on": on})
        if r.ok and bool(r.data.get("success", True)):
            log("bridge", "own", "info", "fav_playlist succeeded")
            return {"ok": True}
        code = (
            (safe_code(r.error.code) if r.error else "provider_error")
            if not r.ok
            else "provider_error"
        )
        log("bridge", "own", "warn", f"fav_playlist failed: {code}")
        return {"ok": False, "error": code}

    async def like_state(self) -> dict:
        # 当前曲红心态(会话级记忆);沉浸页换曲/重进时拉取点亮
        cur = self.playback.current_id()
        return {"id": cur, "liked": bool(cur) and cur in self.liked_ids}

    async def get_lyric(self, mid: str) -> dict:
        # 透传 provider 归一化歌词;失败回空歌词(前端显示占位,不报错)
        r = await self.provider.request("lyric", {"id": mid})
        return r.data if r.ok else {"word_by_word": False, "lines": []}

    async def get_recommend(self) -> dict:
        # 推荐页数据(QQ);失败回空列表,UI 渲染可恢复空态
        r = await self.provider.request("recommend")
        return r.data if r.ok else {"playlists": [], "newsongs": []}

    async def get_toplists(self) -> dict:
        # 榜单卡列表(Playlist 形状;两端 toplists 同名命令,数量几十一次拉全)
        return await self._list_cmd("toplists", "toplists", 100)

    async def get_toplist_songs(self, top_id: str, offset: int = 0) -> dict:
        return await self._list_cmd(
            "toplist_songs", "songs", extra={"id": top_id, "offset": offset}
        )

    async def get_playlist_songs(self, playlist_id: str, offset: int = 0) -> dict:
        # 歌单曲目,统一 offset 分页(QQ/NCM 同名命令,透传共用;失败经 _list_cmd 落日志)
        return await self._list_cmd(
            "playlist_songs", "songs", extra={"id": playlist_id, "offset": offset}
        )

    async def get_discover(self) -> dict:
        # NCM 发现页;失败回空列表
        r = await self.provider.request("discover")
        return r.data if r.ok else {"playlists": []}

    async def get_daily_songs(self) -> dict:
        # NCM 每日推荐(需登录);失败带 error code 供前端 i18n(not_logged_in 等)
        r = await self.provider.request("daily_songs")
        if r.ok:
            return {"ok": True, "songs": r.data.get("songs", [])}
        return {
            "ok": False,
            "songs": [],
            "error": safe_code(r.error.code) if r.error else "provider_error",
        }

    async def _on_provider_event(self, ev: protocol.ChildEvent, origin: ConnectionOrigin):
        if not self.provider.is_current(origin):
            return
        ev = safe_event(ev)
        if ev is None:
            return
        # 登录成功:credential 只落 bridge(单一真相源),绝不下发 UI;其余状态/QR 转发给 UI
        if ev.ev == "login" and ev.type == "done":
            which = origin.provider
            self.settings.setdefault("accounts", {})[which] = ev.data.get("cred")
            settings.save_settings(self.settings)
            log("bridge", "own", "info", f"{which} login success, credential persisted")
            self._kick_seed_liked()
            await decky.emit("login", {"ev": "login", "type": "done", "data": {}})
            return
        if ev.type == "error":
            log("bridge", "own", "warn", f"{ev.ev} error: {ev.data.get('code', '')}")
        await decky.emit(ev.ev, {"ev": ev.ev, "type": ev.type, "data": ev.data})
