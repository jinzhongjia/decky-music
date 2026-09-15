"""Absolute-offset consumers must see the same ordered slice on every QQ endpoint."""

import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import protocol  # noqa: E402
from commands import handle  # noqa: E402


class PagedUpstream:
    def __init__(self, total):
        self.items = [SimpleNamespace(mid=str(i), id=str(i), name=str(i)) for i in range(total)]
        self.calls = []

    async def fetch(self, *_args, page, num, **_kwargs):
        self.calls.append((page, num))
        start = (page - 1) * num
        items = self.items[start : start + num]
        return SimpleNamespace(
            song=items,
            songlist=items,
            album=items,
            songs=items,
            song_tab=items,
            song_list=items,
            playlists=items,
            total_num=len(self.items),
        )

    async def artist_info(self, *_args):
        return SimpleNamespace(singer=SimpleNamespace(mid="artist", name="Artist"))

    async def album_info(self, *_args):
        return SimpleNamespace(album=SimpleNamespace(id=7, name="Album"), singers=[])

    def provider(self):
        return SimpleNamespace(
            client=SimpleNamespace(
                credential=SimpleNamespace(encrypt_uin="synthetic-user", musicid=1),
                search=SimpleNamespace(search_by_type=self.fetch),
                songlist=SimpleNamespace(get_detail=self.fetch),
                top=SimpleNamespace(get_detail=self.fetch),
                singer=SimpleNamespace(get_info=self.artist_info, get_tab_detail=self.fetch),
                album=SimpleNamespace(get_detail=self.album_info, get_song=self.fetch),
                user=SimpleNamespace(get_fav_song=self.fetch, get_fav_songlist=self.fetch),
            )
        )


class TestOffsetConsumers(unittest.IsolatedAsyncioTestCase):
    async def test_all_paged_commands_preserve_absolute_order_and_bounded_fetches(self):
        endpoints = (
            ("search_songs", "songs", "mid"),
            ("search_playlists", "playlists", "id"),
            ("search_albums", "albums", "id"),
            ("playlist_songs", "songs", "mid"),
            ("toplist_songs", "songs", "mid"),
            ("artist_detail", "songs", "mid"),
            ("album_detail", "songs", "mid"),
            ("fav_songs", "songs", "mid"),
            ("fav_playlists", "playlists", "id"),
        )
        # Alignment, the original [25:45] bug, both sides of a window boundary,
        # the maximum/capped limit, a short tail, EOF and a distant empty page.
        cases = (
            (20, 0),
            (20, 20),
            (20, 25),
            (20, 49),
            (20, 50),
            (50, 49),
            (999, 49),
            (20, 119),
            (20, 129),
            (20, 130),
            (20, 10000),
        )
        for cmd, field, identity in endpoints:
            for limit, offset in cases:
                with self.subTest(cmd=cmd, limit=limit, offset=offset):
                    upstream = PagedUpstream(130)
                    request = protocol.Request(
                        1,
                        cmd,
                        {
                            "keyword": "synthetic",
                            "id": "7",
                            "limit": limit,
                            "offset": offset,
                        },
                    )
                    response = await handle(upstream.provider(), request, None, lambda *_: None)
                    expected = [str(i) for i in range(130)][offset : offset + min(limit, 50)]
                    self.assertEqual([item[identity] for item in response["data"][field]], expected)
                    first_page, skip = divmod(offset, 50)
                    expected_calls = [(first_page + 1, 50)]
                    if skip + min(limit, 50) > 50 and (first_page + 1) * 50 <= 130:
                        expected_calls.append((first_page + 2, 50))
                    self.assertEqual(upstream.calls, expected_calls)
                    if cmd == "album_detail":
                        self.assertEqual(response["data"]["album"]["count"], 130)
