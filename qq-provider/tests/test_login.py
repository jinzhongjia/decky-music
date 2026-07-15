"""qq-provider 凭证刷新判定单测(纯本地逻辑,不打网络)。

运行:(cd qq-provider && uv run python -m unittest discover tests)
"""

import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from qqmusic_api import (  # noqa: E402
    Credential,
    LoginDeviceLimitError,
    LoginRateLimitError,
)

from qq.login import _login_error_code, _should_refresh  # noqa: E402


class TestShouldRefresh(unittest.TestCase):
    def test_none_or_anonymous(self):
        self.assertFalse(_should_refresh(None))
        self.assertFalse(_should_refresh(Credential()))  # 无 musickey = 未登录

    def test_expired(self):
        # musickeyCreateTime + keyExpiresIn 落在过去 → 过期
        cred = Credential(musickey="x", musickeyCreateTime=1, keyExpiresIn=1)
        self.assertTrue(_should_refresh(cred))

    def test_not_expired(self):
        cred = Credential(
            musickey="x", musickeyCreateTime=int(time.time()) + 99999, keyExpiresIn=99999
        )
        self.assertFalse(_should_refresh(cred))


class TestLoginErrorCode(unittest.TestCase):
    def test_specific_codes(self):
        self.assertEqual(
            _login_error_code(LoginDeviceLimitError(code=20, data={})), "login_device_limit"
        )
        self.assertEqual(
            _login_error_code(LoginRateLimitError(code=104604, data={})), "login_rate_limit"
        )

    def test_generic_fallback(self):
        self.assertEqual(_login_error_code(ValueError("x")), "login_failed")


if __name__ == "__main__":
    unittest.main()
