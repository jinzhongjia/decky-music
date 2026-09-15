"""Behavioral regression coverage for fail-closed SteamOS deployment."""

import importlib.util
import json
import os
import pwd
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "deploy_target", Path(__file__).resolve().parents[1] / "scripts/deploy_target.py"
)
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


class TestDeployTarget(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.plugins = self.root / "home" / "alex" / "homebrew" / "plugins"
        self.plugins.mkdir(parents=True)
        self.properties = {
            "LoadState": "loaded",
            "FragmentPath": "/etc/systemd/system/plugin_loader.service",
            "Environment": shlex.join(
                [
                    "PRIVILEGED_PATH=" + str(self.plugins.parent),
                    "UNPRIVILEGED_USER=" + pwd.getpwuid(os.getuid()).pw_name,
                ]
            ),
        }
        self.service = patch.object(deploy, "service_properties", return_value=self.properties)
        self.service.start()
        self.addCleanup(self.service.stop)
        self.addCleanup(self.temporary.cleanup)

    def test_non_deck_owner_does_not_follow_ssh_login(self):
        with patch.dict(os.environ, {"USER": "operator", "HOME": "/home/operator"}):
            self.assertEqual(deploy.preflight("Decky Music"), self.plugins)

    def test_custom_install_with_spaces_and_shell_metacharacters(self):
        custom = self.root / "custom disk's $(not-a-command);" / "plugins"
        custom.mkdir(parents=True)
        self.properties["Environment"] = shlex.join(
            [
                "UNPRIVILEGED_PATH=/home/alex/homebrew",
                "PRIVILEGED_PATH=" + str(custom.parent),
            ]
        )
        # Dollar characters could be unresolved service expansions: require an override.
        with self.assertRaises(deploy.DeployError):
            deploy.preflight("Decky Music")
        self.assertEqual(deploy.preflight("Decky Music", str(custom)), custom)
        spaced = self.root / "custom disk's homebrew" / "plugins"
        spaced.mkdir(parents=True)
        self.properties["Environment"] = shlex.join(["PRIVILEGED_PATH=" + str(spaced.parent)])
        self.assertEqual(deploy.preflight("Decky Music"), spaced)

    def test_privileged_path_precedes_different_unprivileged_home(self):
        self.properties["Environment"] += " UNPRIVILEGED_PATH=/home/someone-else/homebrew"
        self.assertEqual(deploy.preflight("Decky Music"), self.plugins)

    def test_unprivileged_and_legacy_configuration(self):
        for value in (
            "UNPRIVILEGED_PATH=" + str(self.plugins.parent),
            "PLUGIN_PATH=" + str(self.plugins),
        ):
            with self.subTest(value=value):
                self.properties["Environment"] = shlex.join([value])
                self.assertEqual(deploy.preflight("Decky Music"), self.plugins)

    def test_missing_ambiguous_or_indirect_configuration_requires_override(self):
        cases = [
            {"Environment": ""},
            {"Environment": "PRIVILEGED_PATH=/a PRIVILEGED_PATH=/b"},
            {"EnvironmentFiles": "/etc/decky.env (ignore_errors=no)"},
            {"PassEnvironment": "PRIVILEGED_PATH"},
            {"UnsetEnvironment": "PRIVILEGED_PATH"},
        ]
        for values in cases:
            with self.subTest(values=values), patch.dict(self.properties, values):
                with self.assertRaises(deploy.DeployError):
                    deploy.preflight("Decky Music")
                self.assertEqual(deploy.preflight("Decky Music", str(self.plugins)), self.plugins)

    def test_invalid_overrides_never_fall_back_to_discovered_path(self):
        file = self.root / "plugins"
        file.write_text("not a directory")
        link = self.root / "linked" / "plugins"
        link.parent.mkdir()
        link.symlink_to("/", target_is_directory=True)
        for value in (
            "",
            "/",
            ".",
            "relative/plugins",
            str(self.root),
            str(file),
            str(link),
            str(self.root / "missing/plugins"),
            str(self.plugins / ".."),
        ):
            with self.subTest(value=value), self.assertRaises(deploy.DeployError):
                deploy.preflight("Decky Music", value)

    def test_no_system_service_fails_even_with_override(self):
        self.service.stop()
        completed = subprocess.CompletedProcess([], 0, "LoadState=not-found\nFragmentPath=\n", "")
        with patch.object(deploy.subprocess, "run", return_value=completed):
            for override in (None, str(self.plugins)):
                with (
                    self.subTest(override=override),
                    self.assertRaises(deploy.DeployError),
                ):
                    deploy.preflight("Decky Music", override)

    def test_destination_symlink_and_unsafe_names_are_rejected(self):
        (self.plugins / "Decky Music").symlink_to(self.root, target_is_directory=True)
        for name in ("Decky Music", "..", "../outside", "/absolute", "", "line\nbreak"):
            with self.subTest(name=name), self.assertRaises(deploy.DeployError):
                deploy.preflight(name)

    def make_upload(self, unsafe=False):
        upload = self.root / "upload"
        upload.mkdir()
        with zipfile.ZipFile(upload / "plugin.zip", "w") as bundle:
            bundle.writestr("Decky Music/plugin.json", json.dumps({"name": "Decky Music"}))
            bundle.writestr("Decky Music/dist/index.js", "new frontend")
            if unsafe:
                bundle.writestr("Decky Music/../../outside", "danger")
        (upload / "player").write_bytes(b"new player")
        (upload / "qq-provider.tar.gz").write_bytes(b"opaque provider archive")
        existing = self.plugins / "Decky Music"
        existing.mkdir()
        (existing / "old").write_text("keep unless installation succeeds")
        return upload, existing

    def test_install_replaces_only_named_plugin_and_preserves_qq_archive(self):
        upload, existing = self.make_upload()
        other = self.plugins / "Another Plugin"
        other.mkdir()
        with patch.object(deploy.subprocess, "run") as run:
            deploy.install_remote("Decky Music", None, str(self.plugins), str(upload))
        self.assertEqual((existing / "dist/index.js").read_text(), "new frontend")
        self.assertFalse((existing / "old").exists())
        self.assertTrue((existing / "dev_mode").is_file())
        self.assertTrue(os.access(existing / "bin/player", os.X_OK))
        self.assertEqual((existing / "bin/qq-provider").read_bytes(), b"opaque provider archive")
        self.assertTrue(other.is_dir())
        run.assert_called_once_with(["systemctl", "restart", "plugin_loader.service"], check=True)

    def test_changed_target_is_rejected_before_old_plugin_deletion(self):
        upload, existing = self.make_upload()
        with self.assertRaises(deploy.DeployError):
            deploy.install_remote(
                "Decky Music", None, str(self.root / "elsewhere/plugins"), str(upload)
            )
        self.assertTrue((existing / "old").is_file())

    def test_unsafe_archive_is_rejected_before_old_plugin_deletion(self):
        upload, existing = self.make_upload(unsafe=True)
        with self.assertRaises(deploy.DeployError):
            deploy.install_remote("Decky Music", None, str(self.plugins), str(upload))
        self.assertTrue((existing / "old").is_file())
        self.assertFalse((self.plugins / "outside").exists())

    def test_remote_shell_preserves_literal_arguments_and_password_stays_on_stdin(self):
        original_run = subprocess.run
        password = "secret'\";$not-a-command"
        argument = "custom disk's $(touch should-not-exist); plugins"
        observed = {}

        def local_transport(command, **kwargs):
            remote = shlex.split(command[-1])
            observed["command"] = command
            # Replace only sudo/SSH transport; execute the actual quoted payload through a shell.
            self.assertEqual(remote[:5], ["sudo", "-S", "-p", "", "--"])
            return original_run(["sh", "-c", shlex.join(remote[5:])], **kwargs)

        code = "import json,sys; print(json.dumps([sys.argv[1],sys.stdin.read()]))"
        with (
            patch.dict(os.environ, {"DECK_PASS": password}),
            patch.object(deploy.subprocess, "run", side_effect=local_transport),
        ):
            result = deploy.ssh(
                "operator@steamos",
                [sys.executable, "-c", code, argument],
                sudo=True,
                capture=True,
            )
        self.assertEqual(json.loads(result.stdout), [argument, password + "\n"])
        self.assertNotIn(password, " ".join(observed["command"]))

    def test_host_cannot_inject_options_or_remote_commands(self):
        for host in (
            "",
            "-oProxyCommand=bad",
            "host;touch-bad",
            "user@host command",
            "host:/tmp",
        ):
            with self.subTest(host=host), self.assertRaises(deploy.DeployError):
                deploy.validate_host(host)
        self.assertEqual(deploy.validate_host("operator@steamos-box"), "operator@steamos-box")

    def test_account_follows_service_user_not_ssh_login_or_directory_owner(self):
        account = pwd.struct_passwd(("steamplayer", "x", 1234, 2345, "", "/home/player", "/bin/sh"))
        properties = {"Environment": "UNPRIVILEGED_USER=steamplayer"}
        with (
            patch.dict(os.environ, {"USER": "operator"}),
            patch.object(deploy.pwd, "getpwnam", return_value=account),
        ):
            self.assertEqual(deploy.plugin_account(properties, self.plugins).pw_name, "steamplayer")

    def test_account_home_matching_is_component_bounded_and_unambiguous(self):
        parent = self.plugins.parent.parent
        alice = pwd.struct_passwd(("alex", "x", 1234, 1234, "", str(parent), "/bin/sh"))
        prefix = pwd.struct_passwd(("wrong", "x", 5678, 5678, "", str(parent)[:-1], "/bin/sh"))
        properties = {"Environment": shlex.join(["UNPRIVILEGED_PATH=" + str(self.plugins.parent)])}
        with patch.object(deploy.pwd, "getpwall", return_value=[prefix, alice]):
            self.assertEqual(deploy.plugin_account(properties, self.plugins).pw_name, "alex")
        duplicate = pwd.struct_passwd(("duplicate", "x", 4321, 4321, "", str(parent), "/bin/sh"))
        for accounts in ([prefix], [alice, duplicate]):
            with (
                self.subTest(accounts=accounts),
                patch.object(deploy.pwd, "getpwall", return_value=accounts),
                self.assertRaises(deploy.DeployError),
            ):
                deploy.plugin_account(properties, self.plugins)

    @unittest.skipUnless(
        os.geteuid() == 0, "requires root to exercise real sandbox UID permissions"
    )
    def test_root_install_allows_sandbox_to_unpack_qq_and_write_import_cache(self):
        accounts = [account for account in pwd.getpwall() if account.pw_uid > 0]
        if not accounts:
            self.skipTest("requires an unprivileged local account")
        account = accounts[0]
        self.root.chmod(0o755)
        self.properties["Environment"] = shlex.join(
            [
                "PRIVILEGED_PATH=" + str(self.plugins.parent),
                "UNPRIVILEGED_USER=" + account.pw_name,
            ]
        )
        upload, existing = self.make_upload()
        with zipfile.ZipFile(upload / "plugin.zip", "a") as bundle:
            bundle.writestr("Decky Music/py_modules/bridge.py", "# cacheable module")
        with patch.object(deploy.subprocess, "run"):
            deploy.install_remote("Decky Music", None, str(self.plugins), str(upload))
        code = (
            "from pathlib import Path; import sys; p=Path(sys.argv[1]); "
            "(p/'bin/qq-provider').rename(p/'bin/qq-provider.tar.gz'); "
            "(p/'bin/qq-provider').mkdir(); "
            "(p/'py_modules/__pycache__').mkdir(); "
            "(p/'py_modules/__pycache__/bridge.pyc').write_bytes(b'cache')"
        )
        result = subprocess.run(
            [sys.executable, "-c", code, str(existing)],
            user=account.pw_uid,
            group=account.pw_gid,
            extra_groups=[],
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((existing / "bin/qq-provider").is_dir())
        self.assertEqual((existing / "py_modules/__pycache__/bridge.pyc").read_bytes(), b"cache")
        self.assertEqual(existing.stat().st_uid, 0)

    def test_shell_stops_before_download_or_build_when_target_preflight_fails(self):
        sandbox = self.root / "checkout"
        (sandbox / "scripts").mkdir(parents=True)
        source = Path(__file__).resolve().parents[1] / "scripts"
        for filename in ("deploy.sh", "deploy_target.py"):
            shutil.copyfile(source / filename, sandbox / "scripts" / filename)
        (sandbox / "plugin.json").write_text(json.dumps({"name": "Decky Music"}))
        commands = self.root / "commands"
        commands.mkdir()
        for name, body in (
            ("ssh", "exit 1"),
            ("sudo", 'touch "$BUILD_MARKER"; exit 99'),
            ("curl", 'touch "$BUILD_MARKER"; exit 99'),
        ):
            executable = commands / name
            executable.write_text("#!/bin/sh\n" + body + "\n")
            executable.chmod(0o755)
        marker = self.root / "must-not-build"
        environment = dict(
            os.environ,
            DECK_HOST="operator@steamos",
            PATH=str(commands) + os.pathsep + os.environ["PATH"],
            BUILD_MARKER=str(marker),
        )
        result = subprocess.run(
            ["bash", str(sandbox / "scripts/deploy.sh")],
            env=environment,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(marker.exists())
        self.assertFalse((sandbox / "cli").exists())


if __name__ == "__main__":
    unittest.main()
