"""QQ 电台/推荐流命令。"""

from qq.search import _song_brief


async def fetch(q, kind: str) -> list[dict]:
    if kind == "qq_guess":
        resp = await q.client.recommend.get_guess_recommend(credential=q.client.credential)
    elif kind == "qq_radar":
        resp = await q.client.recommend.get_radar_recommend()
    else:
        raise ValueError("unsupported radio kind")
    return [_song_brief(s) for s in resp.songs]
