"""
Decky QQ Music 插件后端
实现 QQ 音乐的登录、搜索、推荐和播放功能
"""

import asyncio
import base64
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# 添加 py_modules 到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "py_modules"))

import decky

# QQ Music API 导入
from qqmusic_api import Credential, login, lyric, recommend, search, song, songlist, user
from qqmusic_api.login import QR, QRCodeLoginEvents, QRLoginType
from qqmusic_api.utils.session import get_session


class Plugin:
    """Decky QQ Music 插件主类"""

    # 当前凭证
    credential: Credential | None = None
    # 当前二维码对象
    current_qr: QR | None = None
    # 事件循环
    loop: asyncio.AbstractEventLoop | None = None
    # 用户加密 uin
    encrypt_uin: str | None = None

    # ==================== 工具方法 ====================

    def _get_settings_path(self) -> Path:
        """获取设置文件路径"""
        return Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "credential.json"

    def _save_credential(self) -> bool:
        """保存凭证到文件"""
        if not self.credential:
            return False
        try:
            settings_path = self._get_settings_path()
            settings_path.parent.mkdir(parents=True, exist_ok=True)
            with open(settings_path, "w", encoding="utf-8") as f:
                f.write(self.credential.as_json())
            decky.logger.info("凭证保存成功")
            return True
        except Exception as e:
            decky.logger.error(f"保存凭证失败: {e}")
            return False

    def _load_credential(self) -> bool:
        """从文件加载凭证"""
        try:
            settings_path = self._get_settings_path()
            if settings_path.exists():
                with open(settings_path, encoding="utf-8") as f:
                    data = json.load(f)
                self.credential = Credential.from_cookies_dict(data)
                self.encrypt_uin = self.credential.encrypt_uin if self.credential else None
                # 设置凭证到 session
                if self.credential:
                    get_session().credential = self.credential
                decky.logger.info("凭证加载成功")
                return True
        except Exception as e:
            decky.logger.error(f"加载凭证失败: {e}")
        return False

    def _format_song(self, item: dict[str, Any]) -> dict[str, Any]:
        """格式化歌曲信息为统一格式"""
        # 处理歌手信息
        singers = item.get("singer", [])
        if isinstance(singers, list):
            singer_name = ", ".join([s.get("name", "") for s in singers if s.get("name")])
        else:
            singer_name = str(singers)

        # 获取专辑信息
        album = item.get("album", {})
        if isinstance(album, dict):
            album_name = album.get("name", "")
            album_mid = album.get("mid", "")
        else:
            album_name = ""
            album_mid = ""

        # 获取歌曲 mid
        mid = item.get("mid", "") or item.get("songmid", "")

        return {
            "id": item.get("id", 0) or item.get("songid", 0),
            "mid": mid,
            "name": item.get("name", "") or item.get("title", "") or item.get("songname", ""),
            "singer": singer_name,
            "album": album_name,
            "albumMid": album_mid,
            "duration": item.get("interval", 0),
            "cover": f"https://y.qq.com/music/photo_new/T002R300x300M000{album_mid}.jpg" if album_mid else "",
        }

    # ==================== 登录相关 API ====================

    async def get_qr_code(self, login_type: str = "qq") -> dict[str, Any]:
        """获取登录二维码"""
        try:
            qr_type = QRLoginType.QQ if login_type == "qq" else QRLoginType.WX
            self.current_qr = await login.get_qrcode(qr_type)

            qr_base64 = base64.b64encode(self.current_qr.data).decode("utf-8")

            decky.logger.info(f"获取{login_type}二维码成功")
            return {
                "success": True,
                "qr_data": f"data:{self.current_qr.mimetype};base64,{qr_base64}",
                "login_type": login_type,
            }
        except Exception as e:
            decky.logger.error(f"获取二维码失败: {e}")
            return {"success": False, "error": str(e)}

    async def check_qr_status(self) -> dict[str, Any]:
        """检查二维码扫描状态"""
        if not self.current_qr:
            return {"success": False, "error": "没有可用的二维码"}

        try:
            event, credential = await login.check_qrcode(self.current_qr)

            status_map = {
                QRCodeLoginEvents.SCAN: "waiting",
                QRCodeLoginEvents.CONF: "scanned",
                QRCodeLoginEvents.TIMEOUT: "timeout",
                QRCodeLoginEvents.DONE: "success",
                QRCodeLoginEvents.REFUSE: "refused",
                QRCodeLoginEvents.OTHER: "unknown",
            }

            status = status_map.get(event, "unknown")
            result = {"success": True, "status": status}

            if event == QRCodeLoginEvents.DONE and credential:
                self.credential = credential
                self.encrypt_uin = credential.encrypt_uin
                # 设置凭证到 session
                get_session().credential = credential
                self._save_credential()
                self.current_qr = None
                result["logged_in"] = True
                result["musicid"] = credential.musicid
                decky.logger.info(f"登录成功，musicid: {credential.musicid}")

            return result

        except Exception as e:
            decky.logger.error(f"检查二维码状态失败: {e}")
            return {"success": False, "error": str(e)}

    async def get_login_status(self) -> dict[str, Any]:
        """获取当前登录状态"""
        try:
            if not self.credential:
                self._load_credential()

            if self.credential and self.credential.has_musicid():
                # 检查是否过期
                is_expired = await self.credential.is_expired()
                if is_expired:
                    if await self.credential.can_refresh():
                        refreshed = await self.credential.refresh()
                        if refreshed:
                            self._save_credential()
                            return {
                                "logged_in": True,
                                "musicid": self.credential.musicid,
                                "encrypt_uin": self.credential.encrypt_uin,
                                "refreshed": True,
                            }
                    return {"logged_in": False, "expired": True}

                return {
                    "logged_in": True,
                    "musicid": self.credential.musicid,
                    "encrypt_uin": self.credential.encrypt_uin,
                }

            return {"logged_in": False}

        except Exception as e:
            decky.logger.error(f"获取登录状态失败: {e}")
            return {"logged_in": False, "error": str(e)}

    async def logout(self) -> dict[str, Any]:
        """退出登录"""
        try:
            self.credential = None
            self.current_qr = None
            self.encrypt_uin = None

            settings_path = self._get_settings_path()
            if settings_path.exists():
                settings_path.unlink()

            decky.logger.info("已退出登录")
            return {"success": True}

        except Exception as e:
            decky.logger.error(f"退出登录失败: {e}")
            return {"success": False, "error": str(e)}

    # ==================== 搜索相关 API ====================

    async def search_songs(self, keyword: str, page: int = 1, num: int = 20) -> dict[str, Any]:
        """搜索歌曲"""
        try:
            results = await search.search_by_type(
                keyword=keyword, search_type=search.SearchType.SONG, num=num, page=page
            )

            songs = [self._format_song(item) for item in results]

            decky.logger.info(f"搜索'{keyword}'找到 {len(songs)} 首歌曲")
            return {"success": True, "songs": songs, "keyword": keyword, "page": page}

        except Exception as e:
            decky.logger.error(f"搜索失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_hot_search(self) -> dict[str, Any]:
        """获取热搜词"""
        try:
            result = await search.hotkey()
            hotkeys = []
            for item in result.get("hotkey", []):
                hotkeys.append({"keyword": item.get("query", item.get("k", "")), "score": item.get("score", 0)})

            return {"success": True, "hotkeys": hotkeys[:20]}  # 返回更多热搜词
        except Exception as e:
            decky.logger.error(f"获取热搜失败: {e}")
            return {"success": False, "error": str(e), "hotkeys": []}

    async def get_search_suggest(self, keyword: str) -> dict[str, Any]:
        """获取搜索建议/补全"""
        try:
            if not keyword or len(keyword.strip()) == 0:
                return {"success": True, "suggestions": []}

            result = await search.complete(keyword)

            suggestions = []
            # 解析歌曲建议
            for item in result.get("song", {}).get("itemlist", []):
                suggestions.append({
                    "type": "song",
                    "keyword": item.get("name", ""),
                    "singer": item.get("singer", ""),
                })
            # 解析歌手建议
            for item in result.get("singer", {}).get("itemlist", []):
                suggestions.append({
                    "type": "singer",
                    "keyword": item.get("name", ""),
                })
            # 解析专辑建议
            for item in result.get("album", {}).get("itemlist", []):
                suggestions.append({
                    "type": "album",
                    "keyword": item.get("name", ""),
                    "singer": item.get("singer", ""),
                })

            return {"success": True, "suggestions": suggestions[:10]}

        except Exception as e:
            decky.logger.error(f"获取搜索建议失败: {e}")
            return {"success": False, "error": str(e), "suggestions": []}

    # ==================== 推荐相关 API ====================

    async def get_guess_like(self) -> dict[str, Any]:
        """获取猜你喜欢"""
        try:
            result = await recommend.get_guess_recommend()

            songs = []
            track_list = result.get("tracks", []) or result.get("data", {}).get("tracks", [])

            for item in track_list:
                songs.append(self._format_song(item))

            decky.logger.info(f"获取猜你喜欢 {len(songs)} 首")
            return {"success": True, "songs": songs}

        except Exception as e:
            decky.logger.error(f"获取猜你喜欢失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_daily_recommend(self) -> dict[str, Any]:
        """获取每日推荐"""
        try:
            # 尝试获取个性化推荐
            result = await recommend.get_radar_recommend()

            songs = []
            song_list = result.get("SongList", []) or result.get("data", {}).get("SongList", [])

            for item in song_list:
                songs.append(self._format_song(item))

            # 如果个性化推荐为空，尝试获取新歌推荐
            if not songs:
                result = await recommend.get_recommend_newsong()
                song_list = result.get("songlist", []) or result.get("data", {}).get("songlist", [])
                for item in song_list:
                    if isinstance(item, dict):
                        songs.append(self._format_song(item))

            decky.logger.info(f"获取每日推荐 {len(songs)} 首")
            return {
                "success": True,
                "songs": songs[:20],  # 限制返回数量
                "date": datetime.now().strftime("%Y-%m-%d"),
            }

        except Exception as e:
            decky.logger.error(f"获取每日推荐失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    async def get_recommend_playlists(self) -> dict[str, Any]:
        """获取推荐歌单"""
        try:
            result = await recommend.get_recommend_songlist()

            playlists = []
            playlist_list = result.get("v_hot", []) or result.get("data", {}).get("v_hot", [])

            for item in playlist_list:
                playlists.append(
                    {
                        "id": item.get("content_id", 0),
                        "name": item.get("title", ""),
                        "cover": item.get("cover", ""),
                        "songCount": item.get("song_cnt", 0),
                        "playCount": item.get("listen_num", 0),
                        "creator": item.get("username", ""),
                    }
                )

            return {"success": True, "playlists": playlists}

        except Exception as e:
            decky.logger.error(f"获取推荐歌单失败: {e}")
            return {"success": False, "error": str(e), "playlists": []}

    async def get_fav_songs(self, page: int = 1, num: int = 20) -> dict[str, Any]:
        """获取收藏歌曲"""
        try:
            if not self.credential or not self.encrypt_uin:
                return {"success": False, "error": "未登录", "songs": [], "total": 0}

            result = await user.get_fav_song(self.encrypt_uin, page=page, num=num, credential=self.credential)

            songs = []
            for item in result.get("songlist", []):
                songs.append(self._format_song(item))

            return {"success": True, "songs": songs, "total": result.get("total_song_num", 0)}

        except Exception as e:
            decky.logger.error(f"获取收藏歌曲失败: {e}")
            return {"success": False, "error": str(e), "songs": [], "total": 0}

    # ==================== 播放相关 API ====================

    async def get_song_url(self, mid: str) -> dict[str, Any]:
        """获取歌曲播放链接，自动尝试多种音质"""
        # 检查凭证状态
        has_credential = self.credential is not None and self.credential.has_musicid()
        if self.credential:
            # 输出凭证的所有关键字段
            cred_info = {
                "musicid": self.credential.musicid,
                "musickey_len": len(self.credential.musickey or ''),
                "openid_len": len(getattr(self.credential, 'openid', '') or ''),
                "access_token_len": len(getattr(self.credential, 'access_token', '') or ''),
                "refresh_token_len": len(getattr(self.credential, 'refresh_token', '') or ''),
                "refresh_key_len": len(getattr(self.credential, 'refresh_key', '') or ''),
                "login_type": getattr(self.credential, 'login_type', None),
                "encrypt_uin_len": len(self.credential.encrypt_uin or ''),
                "has_musickey": self.credential.has_musickey(),
            }
            decky.logger.info(f"获取歌曲 {mid}，凭证详情: {cred_info}")
        else:
            decky.logger.info(f"获取歌曲 {mid}，凭证为空!")
        
        if has_credential:
            # 检查凭证是否过期
            try:
                is_expired = await self.credential.is_expired()
                if is_expired:
                    decky.logger.warning("凭证已过期，尝试刷新...")
                    if await self.credential.can_refresh():
                        refreshed = await self.credential.refresh()
                        if refreshed:
                            self._save_credential()
                            decky.logger.info("凭证刷新成功")
                        else:
                            decky.logger.warning("凭证刷新失败")
            except Exception as e:
                decky.logger.warning(f"检查凭证状态失败: {e}")
        
        # 按优先级尝试不同音质
        # VIP 用户优先尝试高音质
        file_types = [
            song.SongFileType.MP3_320,  # 320kbps MP3 (VIP)
            song.SongFileType.OGG_192,  # 192kbps OGG
            song.SongFileType.MP3_128,  # 128kbps MP3
            song.SongFileType.ACC_192,  # 192kbps AAC
            song.SongFileType.ACC_96,   # 96kbps AAC
            song.SongFileType.ACC_48,   # 48kbps AAC (最低质量，试听)
        ]
        
        last_error = ""
        all_results = []  # 记录所有尝试的结果
        
        for file_type in file_types:
            try:
                decky.logger.info(f"尝试获取 {mid} 音质: {file_type.name}")
                urls = await song.get_song_urls(
                    mid=[mid], 
                    file_type=file_type, 
                    credential=self.credential
                )
                
                # 详细记录返回结果
                url = urls.get(mid, "")
                url_preview = url[:80] + "..." if url and len(url) > 80 else url
                decky.logger.info(f"API 返回: URL: {url_preview or '(空)'}")
                
                # 如果是空的，记录完整的返回内容用于调试
                if not url:
                    decky.logger.debug(f"完整返回: {urls}")
                all_results.append(f"{file_type.name}: {'有URL' if url else '空'}")
                
                if url:
                    decky.logger.info(f"✅ 获取歌曲 {mid} 成功，音质: {file_type.name}, URL长度: {len(url)}")
                    return {"success": True, "url": url, "mid": mid, "quality": file_type.name}
                else:
                    decky.logger.info(f"❌ 音质 {file_type.name} 返回空 URL")
                    
            except Exception as e:
                last_error = str(e)
                all_results.append(f"{file_type.name}: 异常-{str(e)[:50]}")
                decky.logger.warning(f"❌ 尝试 {file_type.name} 异常: {e}")
                continue
        
        # 输出所有尝试结果
        decky.logger.warning(f"所有音质尝试结果: {all_results}")
        
        # 尝试获取试听链接作为备用
        decky.logger.info(f"尝试获取试听链接...")
        try:
            # 获取歌曲详情以获取 vs 字段
            detail = await song.get_detail(mid)
            track_info = detail.get("track_info", {})
            vs_list = track_info.get("vs", [])
            file_info = track_info.get("file", {})
            size_try = file_info.get("size_try", 0)
            
            if vs_list and size_try > 0:
                try_url = await song.get_try_url(mid, vs_list[0])
                if try_url:
                    decky.logger.info(f"✅ 获取试听链接成功，长度: {len(try_url)}")
                    return {
                        "success": True, 
                        "url": try_url, 
                        "mid": mid, 
                        "quality": "TRIAL",
                        "is_trial": True  # 标记为试听版
                    }
        except Exception as e:
            decky.logger.warning(f"获取试听链接失败: {e}")
        
        # 所有方法都失败
        error_msg = "该歌曲暂时无法播放"
        if not has_credential:
            error_msg = "请先登录以播放会员歌曲"
        elif "vip" in last_error.lower() or "付费" in last_error:
            error_msg = "该歌曲需要付费购买"
        else:
            error_msg = "歌曲暂不可用，可能是版权限制"
            
        decky.logger.warning(f"无法获取歌曲 {mid}: {error_msg}, 最后错误: {last_error}")
        return {
            "success": False, 
            "url": "", 
            "mid": mid,
            "error": error_msg
        }

    async def get_song_urls_batch(self, mids: list[str]) -> dict[str, Any]:
        """批量获取歌曲播放链接"""
        try:
            urls = await song.get_song_urls(mid=mids, file_type=song.SongFileType.MP3_128, credential=self.credential)

            return {"success": True, "urls": urls}

        except Exception as e:
            decky.logger.error(f"批量获取播放链接失败: {e}")
            return {"success": False, "error": str(e), "urls": {}}

    async def get_song_lyric(self, mid: str) -> dict[str, Any]:
        """获取歌词"""
        try:
            result = await lyric.get_lyric(mid, qrc=False, trans=True)

            return {"success": True, "lyric": result.get("lyric", ""), "trans": result.get("trans", ""), "mid": mid}

        except Exception as e:
            decky.logger.error(f"获取歌词失败: {e}")
            return {"success": False, "error": str(e), "lyric": "", "trans": ""}

    async def get_song_info(self, mid: str) -> dict[str, Any]:
        """获取歌曲详细信息"""
        try:
            result = await song.get_detail(mid)
            return {"success": True, "info": result}
        except Exception as e:
            decky.logger.error(f"获取歌曲信息失败: {e}")
            return {"success": False, "error": str(e), "info": {}}

    # ==================== 歌单相关 API ====================

    async def get_user_playlists(self) -> dict[str, Any]:
        """获取用户的歌单（创建的和收藏的）"""
        try:
            if not self.credential or not self.credential.has_musicid():
                return {"success": False, "error": "未登录", "created": [], "collected": []}

            musicid = str(self.credential.musicid)
            encrypt_uin = self.encrypt_uin or ""

            # 获取创建的歌单
            created_list = []
            try:
                created_result = await user.get_created_songlist(musicid, credential=self.credential)
                decky.logger.info(f"创建歌单原始数据: {created_result[:1] if created_result else 'empty'}")
                for item in created_result:
                    created_list.append({
                        "id": item.get("tid", 0),
                        "dirid": item.get("dirid", 0),
                        "name": item.get("dirName", "") or item.get("diss_name", "") or item.get("title", ""),
                        "cover": item.get("picUrl", "") or item.get("diss_cover", "") or item.get("pic", ""),
                        "songCount": item.get("songNum", 0) or item.get("song_cnt", 0) or item.get("songnum", 0),
                        "playCount": item.get("listen_num", 0),
                    })
            except Exception as e:
                decky.logger.warning(f"获取创建的歌单失败: {e}")

            # 获取收藏的歌单
            collected_list = []
            if encrypt_uin:
                try:
                    collected_result = await user.get_fav_songlist(encrypt_uin, num=50, credential=self.credential)
                    decky.logger.info(f"收藏歌单原始数据keys: {collected_result.keys() if collected_result else 'empty'}")
                    # 尝试多种可能的字段名
                    fav_list = collected_result.get("v_list", []) or collected_result.get("v_playlist", []) or collected_result.get("data", {}).get("v_list", [])
                    decky.logger.info(f"收藏歌单列表第一项: {fav_list[:1] if fav_list else 'empty'}")
                    for item in fav_list:
                        collected_list.append({
                            "id": item.get("tid", 0) or item.get("dissid", 0),
                            "dirid": item.get("dirid", 0),
                            "name": item.get("name", "") or item.get("diss_name", "") or item.get("title", ""),
                            "cover": item.get("logo", "") or item.get("diss_cover", "") or item.get("pic", ""),
                            "songCount": item.get("songnum", 0) or item.get("song_cnt", 0) or item.get("song_count", 0),
                            "creator": item.get("creator", {}).get("nick", "") if isinstance(item.get("creator"), dict) else item.get("creator_name", ""),
                        })
                except Exception as e:
                    decky.logger.warning(f"获取收藏的歌单失败: {e}")

            decky.logger.info(f"获取用户歌单: 创建 {len(created_list)} 个, 收藏 {len(collected_list)} 个")
            return {
                "success": True,
                "created": created_list,
                "collected": collected_list,
            }

        except Exception as e:
            decky.logger.error(f"获取用户歌单失败: {e}")
            return {"success": False, "error": str(e), "created": [], "collected": []}

    async def get_playlist_songs(self, playlist_id: int, dirid: int = 0) -> dict[str, Any]:
        """获取歌单中的所有歌曲"""
        try:
            songs_data = await songlist.get_songlist(playlist_id, dirid)

            songs = [self._format_song(item) for item in songs_data]

            decky.logger.info(f"获取歌单 {playlist_id} 的歌曲: {len(songs)} 首")
            return {"success": True, "songs": songs, "playlist_id": playlist_id}

        except Exception as e:
            decky.logger.error(f"获取歌单歌曲失败: {e}")
            return {"success": False, "error": str(e), "songs": []}

    # ==================== 生命周期方法 ====================

    async def _main(self):
        """插件加载时执行"""
        self.loop = asyncio.get_event_loop()
        decky.logger.info("Decky QQ Music 插件已加载")

        # 尝试加载已保存的凭证
        self._load_credential()
        if self.credential:
            decky.logger.info("已加载保存的登录凭证")

    async def _unload(self):
        """插件卸载时执行"""
        decky.logger.info("Decky QQ Music 插件正在卸载")

    async def _uninstall(self):
        """插件删除时执行"""
        decky.logger.info("Decky QQ Music 插件已删除")
        try:
            settings_path = self._get_settings_path()
            if settings_path.exists():
                settings_path.unlink()
        except Exception:
            pass

    async def _migration(self):
        """迁移旧数据"""
        decky.logger.info("执行数据迁移检查")
