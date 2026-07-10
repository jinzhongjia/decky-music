"""QQ provider backend command tests (pure local, no network)."""

import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import protocol  # noqa: E402
from main import handle  # noqa: E402
from qq.library import (  # noqa: E402
    NotLoggedIn,
    _as_bool,
    _as_int,
    _limit,
    _playlist_brief,
)
from qq.library import (
    like_song as _like_song,
)
from qq.library import (
    user_assets as _user_assets,
)
from qq.search import _album_brief, _artist_brief, _song_brief  # noqa: E402


class TestProviderMappers(unittest.TestCase):
    def test_song_brief_keeps_existing_shape(self):
        song = SimpleNamespace(
            mid="song_mid",
            name="Song",
            interval=188,
            singer=[SimpleNamespace(name="A"), SimpleNamespace(name="B")],
            album=SimpleNamespace(name="Album", mid="album_mid"),
            pay=SimpleNamespace(pay_play=1),
            file=SimpleNamespace(media_mid="media_mid"),
        )

        self.assertEqual(
            _song_brief(song),
            {
                "mid": "song_mid",
                "name": "Song",
                "singer": "A / B",
                "album": "Album",
                "duration": 188,
                "cover": "https://y.qq.com/music/photo_new/T002R300x300M000album_mid.jpg",
                "vip": True,
                "media_mid": "media_mid",
            },
        )

    def test_playlist_album_artist_briefs(self):
        self.assertEqual(
            _playlist_brief(
                SimpleNamespace(id=7, title="List", picurl="p", songnum=3, listennum=9)
            ),
            {"id": "7", "name": "List", "cover": "p", "count": 3, "play_count": 9},
        )
        self.assertEqual(
            _playlist_brief(SimpleNamespace(id=7, dirid=201, title="List", songnum=3)),
            {"id": "201", "name": "List", "cover": "", "count": 3, "play_count": 0},
        )
        self.assertEqual(
            _album_brief(
                SimpleNamespace(
                    id=8,
                    name="Album",
                    pic="pic",
                    singer_list=[SimpleNamespace(name="A"), SimpleNamespace(name="B")],
                    songnum=5,
                )
            ),
            {"id": "8", "name": "Album", "cover": "pic", "artist": "A / B", "count": 5},
        )
        self.assertEqual(
            _artist_brief(SimpleNamespace(mid="m", name="Artist", pic="avatar")),
            {"id": "m", "name": "Artist", "avatar": "avatar"},
        )


class TestProviderArgValidation(unittest.TestCase):
    def test_limit_and_scalar_parsers(self):
        self.assertEqual(_limit({}, default=20), 20)
        self.assertEqual(_limit({"limit": 999}), 50)
        self.assertEqual(_limit({"limit": "7"}), 7)
        with self.assertRaises(ValueError):
            _limit({"limit": True})
        with self.assertRaises(ValueError):
            _as_int({"id": "abc"}, "id")
        with self.assertRaises(ValueError):
            _as_bool({"on": "yes"}, "on")


class TestProviderDispatch(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_search_songs_does_not_call_qq(self):
        class QQ:
            async def search_songs(self, *args, **kwargs):  # pragma: no cover - must not run
                raise AssertionError("upstream called")

        resp = await handle(QQ(), protocol.Request(1, "search_songs", {}), None, lambda *a: None)
        self.assertEqual(resp["ok"], False)
        self.assertEqual(resp["error"]["code"], "invalid_request")

    async def test_dispatch_search_playlists_success_shape(self):
        class QQ:
            async def search_playlists(self, keyword, limit=20, offset=0):
                self.seen = (keyword, limit, offset)
                return [{"id": "1", "name": "List", "cover": "", "count": 0, "play_count": 0}]

        qq = QQ()
        resp = await handle(
            qq,
            protocol.Request(2, "search_playlists", {"keyword": "jay", "limit": 3, "offset": 6}),
            None,
            lambda *a: None,
        )
        self.assertEqual(
            resp,
            protocol.ok(
                2,
                {
                    "playlists": [
                        {"id": "1", "name": "List", "cover": "", "count": 0, "play_count": 0}
                    ]
                },
            ),
        )
        self.assertEqual(qq.seen, ("jay", 3, 6))

    async def test_invalid_like_song_missing_on(self):
        class QQ:
            async def like_song(self, *args, **kwargs):  # pragma: no cover - must not run
                raise AssertionError("upstream called")

        resp = await handle(
            QQ(), protocol.Request(3, "like_song", {"id": "123"}), None, lambda *a: None
        )
        self.assertEqual(resp["ok"], False)
        self.assertEqual(resp["error"]["code"], "invalid_request")

    async def test_invalid_created_playlists_bad_paging(self):
        class QQ:
            async def created_playlists(self, *args, **kwargs):  # pragma: no cover - must not run
                raise AssertionError("upstream called")

        resp = await handle(
            QQ(),
            protocol.Request(4, "created_playlists", {"limit": True}),
            None,
            lambda *a: None,
        )
        self.assertEqual(resp["ok"], False)
        self.assertEqual(resp["error"]["code"], "invalid_request")

    async def test_dispatch_maps_not_logged_in(self):
        class QQ:
            async def user_assets(self):
                raise NotLoggedIn()

        resp = await handle(
            QQ(), protocol.Request(5, "user_assets", {}), None, lambda *a: None
        )
        self.assertEqual(resp["ok"], False)
        self.assertEqual(resp["error"]["code"], "not_logged_in")


class TestProviderLoginRequired(unittest.IsolatedAsyncioTestCase):
    async def test_user_assets_requires_credential_before_upstream(self):
        class User:
            async def get_fav_song(self, *args, **kwargs):  # pragma: no cover - must not run
                raise AssertionError("upstream called")

        q = SimpleNamespace(
            client=SimpleNamespace(
                credential=SimpleNamespace(encrypt_uin="", musicid=0),
                user=User(),
            )
        )
        with self.assertRaises(NotLoggedIn):
            await _user_assets(q)

    async def test_like_song_requires_credential_before_song_lookup(self):
        class Song:
            async def query_song(self, *args, **kwargs):  # pragma: no cover - must not run
                raise AssertionError("upstream called")

        q = SimpleNamespace(
            client=SimpleNamespace(
                credential=SimpleNamespace(encrypt_uin="", musicid=0),
                song=Song(),
            )
        )
        with self.assertRaises(NotLoggedIn):
            await _like_song(q, "123", True)


if __name__ == "__main__":
    unittest.main()
