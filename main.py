"""bridge 接口层:Decky 调用的 Plugin 类,仅做转发。

UI 只跟这里说话;真正的实现(UDS 连接、进程管理、provider 生命周期、命令编排)在
py_modules/bridge.py。下面 CALLABLES 里的每个名字即一个前端 callable,须与 src/api.ts 对应
(绑定规范见 AGENTS.md「API 契约」;tests/test_callables.py 机械校验两端一致)。

转发靠 __getattr__ 而非逐个写同名方法:Decky loader 以 `getattr(plugin, method)(*args)`
按名分发(见 decky-loader sandboxed_plugin.py),名字命中即可。CALLABLES 是白名单 ——
Bridge 的其余公开方法(start / unload 等)不因此暴露成 RPC。
"""

from bridge import Bridge

# 前端可调用的 bridge 方法(= RPC 契约面)。增删这里必须同步改 src/api.ts。
CALLABLES = frozenset(
    """
    set_provider get_provider login logout get_account
    play_queue get_playback play_radio fm_trash like_current like_state
    get_comments get_user_assets add_to_playlist
    get_fav_songs get_listen_rank get_created_playlists get_fav_playlists
    get_queue queue_play queue_insert_next queue_append queue_remove queue_clear
    next_track prev_track set_play_mode pause resume seek volume
    search_songs search_playlists search_albums search_artists search_hot
    get_artist_detail get_album_detail get_lyric get_recommend
    get_playlist_songs get_toplists get_toplist_songs get_discover get_daily_songs
    clear_cache get_cache_size clear_data
    """.split()
)


class Plugin:
    async def _main(self):
        self.bridge = Bridge()
        await self.bridge.start()

    async def _unload(self):
        await self.bridge.unload()

    def __getattr__(self, name: str):
        # __getattr__ 只在常规查找失败时触发。白名单外一律 AttributeError:
        # loader 探测的 _migration / _uninstall 照常 hasattr 为 False;"bridge" 也在白名单外,
        # 故 _main 之前误访问会直接抛,不会经 self.bridge 自递归。
        if name not in CALLABLES:
            raise AttributeError(name)
        return getattr(self.bridge, name)
