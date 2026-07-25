// 逐个调用 bridge 的只读 callable,验证 main.py 的 __getattr__ 白名单分发。
// 只挑无副作用的读接口 + 一个越界名(必须失败),不碰播放/登录状态。
// 用 loader/call_plugin_method,绝不 connect()(会抢走插件的事件监听表)。
(async () => {
  const PLUGIN = "Decky Music";
  const call = (m, ...a) =>
    DeckyBackend.call("loader/call_plugin_method", PLUGIN, m, ...a);

  const readOnly = [
    "get_provider",
    "get_playback",
    "get_queue",
    "get_account",
    "like_state",
    "get_cache_size",
    "get_user_assets",
    "search_hot",
    "get_recommend",
    "get_toplists",
    "get_discover",
    "get_fav_songs",
    "get_created_playlists",
    "get_fav_playlists",
    "get_listen_rank",
  ];

  const out = [];
  for (const m of readOnly) {
    try {
      const r = await call(m);
      const s = JSON.stringify(r);
      out.push(`ok   ${m} -> ${s.length > 110 ? s.slice(0, 110) + "…" : s}`);
    } catch (e) {
      out.push(`FAIL ${m} -> ${e && e.message ? e.message : String(e)}`);
    }
  }

  // 带参数的读接口
  try {
    const r = await call("search_songs", "周杰伦", 0);
    out.push(`ok   search_songs -> ok=${r.ok} n=${(r.songs || []).length}`);
  } catch (e) {
    out.push(`FAIL search_songs -> ${e}`);
  }

  // 白名单外:Bridge 上真实存在但不该暴露成 RPC —— 必须失败
  for (const m of ["start", "unload", "_ensure_provider"]) {
    try {
      await call(m);
      out.push(`LEAK ${m} -> 竟然可调用(白名单失效)`);
    } catch {
      out.push(`ok   ${m} -> 已拒绝(符合预期)`);
    }
  }
  return out.join("\n");
})();
