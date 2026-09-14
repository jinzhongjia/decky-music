import unittest


class TestCiFailureProbe(unittest.TestCase):
    def test_intentional_failure_is_not_hidden(self):
        self.fail("Intentional temporary CI acceptance failure")
