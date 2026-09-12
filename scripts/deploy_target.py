#!/usr/bin/env python3
"""Deployment transport and remote checks (stdlib only, local/remote Python 3).

DECK_HOST is required; DECK_PASS is sent only to sudo's stdin. DECK_PLUGIN_PATH
selects an existing absolute plugins directory when service discovery is unclear.
Usage: python3 scripts/deploy_target.py preflight --name 'Decky Music'
       python3 scripts/deploy_target.py install --name 'Decky Music' \
           --plugins /actual/homebrew/plugins --zip 'out/Decky Music.zip'
"""

import argparse
import json
import os
import pwd
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath


class DeployError(Exception):
    pass


def validate_name(name):
    if not name or name in (".", "..") or "/" in name or "\\" in name:
        raise DeployError("plugin.json name must be one safe directory component")
    if any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise DeployError("plugin.json name must not contain control characters")


def validate_plugins(value):
    path = Path(value)
    if not value or not path.is_absolute() or ".." in path.parts:
        raise DeployError(
            "DECK_PLUGIN_PATH must be a nonempty absolute plugins directory"
        )
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise DeployError("plugins directory must not contain control characters")
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise DeployError("plugins directory must already exist") from exc
    if path.name != "plugins" or resolved.name != "plugins" or not resolved.is_dir():
        raise DeployError(
            "deployment target must be an existing directory named plugins"
        )
    if len(resolved.parts) < 3:
        raise DeployError("refusing a root-level plugins directory")
    return resolved


def service_properties():
    properties = (
        "LoadState",
        "FragmentPath",
        "Environment",
        "EnvironmentFiles",
        "PassEnvironment",
        "UnsetEnvironment",
        "NeedDaemonReload",
    )
    result = subprocess.run(
        [
            "systemctl",
            "show",
            "plugin_loader.service",
            "--no-pager",
            *["--property=" + name for name in properties],
        ],
        check=True,
        text=True,
        capture_output=True,
    )
    values = dict(
        line.split("=", 1) for line in result.stdout.splitlines() if "=" in line
    )
    if values.get("LoadState") != "loaded" or not values.get(
        "FragmentPath", ""
    ).startswith("/"):
        raise DeployError("system plugin_loader.service is not installed and loaded")
    if values.get("NeedDaemonReload") == "yes":
        raise DeployError(
            "plugin_loader.service needs systemctl daemon-reload before deployment"
        )
    return values


def _service_environment(properties):
    """Parse the same literal service settings for paths and sandbox ownership."""
    if any(
        properties.get(key)
        for key in ("EnvironmentFiles", "PassEnvironment", "UnsetEnvironment")
    ):
        raise DeployError(
            "indirect service environment cannot be inferred safely; "
            "use literal plugin_loader Environment settings for deployment"
        )
    raw = properties.get("Environment", "")
    if "\\" in raw:
        raise DeployError("service environment uses unsupported escapes")
    try:
        entries = shlex.split(raw)
    except ValueError as exc:
        raise DeployError("ambiguous service environment") from exc
    environment = {}
    for entry in entries:
        key, separator, value = entry.partition("=")
        if key not in (
            "PRIVILEGED_PATH",
            "UNPRIVILEGED_PATH",
            "PLUGIN_PATH",
            "UNPRIVILEGED_USER",
        ):
            continue
        if not separator or (key in environment and environment[key] != value):
            raise DeployError("ambiguous service environment")
        environment[key] = value
    return environment


def discover_plugins(properties):
    # Match Decky's get_privileged_path(), not the SSH account's home directory.
    environment = _service_environment(properties)
    for key in ("PRIVILEGED_PATH", "UNPRIVILEGED_PATH", "PLUGIN_PATH"):
        if key not in environment:
            continue
        value = environment[key]
        if not value or "$" in value or "%" in value or not Path(value).is_absolute():
            raise DeployError(
                "service path is not literal and absolute; set DECK_PLUGIN_PATH explicitly"
            )
        root = Path(value).parent if key == "PLUGIN_PATH" else Path(value)
        return str(root / "plugins")
    raise DeployError(
        "cannot discover Decky plugins directory; set DECK_PLUGIN_PATH explicitly"
    )


def preflight(name, override=None, expected=None):
    validate_name(name)
    properties = service_properties()
    candidate = override if override is not None else discover_plugins(properties)
    try:
        plugins = validate_plugins(candidate)
    except DeployError as exc:
        if override is None:
            raise DeployError(f"{exc}; set DECK_PLUGIN_PATH explicitly") from exc
        raise
    if expected is not None and str(plugins) != expected:
        raise DeployError(
            "plugins directory changed after preflight; refusing deployment"
        )
    destination = plugins / name
    if destination.is_symlink() or (destination.exists() and not destination.is_dir()):
        raise DeployError(
            "existing plugin destination must be a real directory, not a symlink or file"
        )
    return plugins


def unpack_plugin(archive, stage, name):
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            parts = PurePosixPath(entry.filename).parts
            mode = entry.external_attr >> 16
            if (
                not parts
                or parts[0] != name
                or ".." in parts
                or "\\" in entry.filename
                or stat.S_ISLNK(mode)
            ):
                raise DeployError("plugin archive contains an unsafe path or symlink")
        bundle.extractall(stage)
    plugin = stage / name
    if (
        not (plugin / "plugin.json").is_file()
        or not (plugin / "dist/index.js").is_file()
    ):
        raise DeployError("plugin archive is missing plugin.json or dist/index.js")
    if json.loads((plugin / "plugin.json").read_text())["name"] != name:
        raise DeployError("plugin archive name differs from deployment target")
    return plugin


def plugin_account(properties, plugins):
    """Resolve Decky's sandbox account without consulting the SSH login."""
    environment = _service_environment(properties)
    if "UNPRIVILEGED_USER" in environment:
        try:
            return pwd.getpwnam(environment["UNPRIVILEGED_USER"])
        except KeyError as exc:
            raise DeployError(
                "service UNPRIVILEGED_USER is not a local account"
            ) from exc
    value = environment.get("UNPRIVILEGED_PATH")
    if value is None:
        value = (
            str(Path(environment["PLUGIN_PATH"]).parent)
            if "PLUGIN_PATH" in environment
            else str(plugins.parent)
        )
    if (
        not value
        or not Path(value).is_absolute()
        or any(char in value for char in "$%\\")
    ):
        raise DeployError(
            "sandbox home is not literal; configure service UNPRIVILEGED_USER"
        )
    homebrew = Path(value).resolve()
    candidates = [
        account
        for account in pwd.getpwall()
        if account.pw_uid != 0
        and Path(account.pw_dir).is_absolute()
        and Path(account.pw_dir).resolve() in (homebrew, *homebrew.parents)
    ]
    if candidates:
        longest = max(
            len(Path(account.pw_dir).resolve().parts) for account in candidates
        )
        candidates = [
            account
            for account in candidates
            if len(Path(account.pw_dir).resolve().parts) == longest
        ]
    if len(candidates) != 1:
        raise DeployError(
            "cannot uniquely resolve sandbox account; "
            "configure UNPRIVILEGED_USER in plugin_loader.service"
        )
    return candidates[0]


def set_writable_ownership(plugin, account):
    # Decky skips recursive ownership repair when plugin root is already root-owned.
    # Preserve that read-only root, but allow sandbox-side QQ extraction/import caches.
    for name in ("bin", "py_modules"):
        directory = plugin / name
        if not directory.is_dir():
            continue
        for root, _, files in os.walk(directory):
            os.chown(root, account.pw_uid, account.pw_gid)
            for name in files:
                os.chown(Path(root) / name, account.pw_uid, account.pw_gid)


def install_remote(name, override, expected, upload):
    plugins = preflight(name, override, expected)
    account = plugin_account(service_properties(), plugins)
    with tempfile.TemporaryDirectory(
        prefix=".decky-music-stage-", dir=plugins
    ) as temporary:
        plugin = unpack_plugin(Path(upload) / "plugin.zip", Path(temporary), name)
        binary_dir = plugin / "bin"
        binary_dir.mkdir(exist_ok=True)
        for source, target in (
            ("player", "player"),
            ("ncm-provider", "ncm-provider"),
            ("qq-provider.tar.gz", "qq-provider"),
        ):
            artifact = Path(upload) / source
            if artifact.is_file():
                destination = binary_dir / target
                if destination.is_dir():
                    shutil.rmtree(destination)
                shutil.copyfile(artifact, destination)
                destination.chmod(0o755 if source != "qq-provider.tar.gz" else 0o644)
        # QQ's archive is kept verbatim, like Decky's remote_binary installer;
        # the bridge's existing qq_exe() extracts it on first use.
        (plugin / "dev_mode").touch()
        set_writable_ownership(plugin, account)
        plugins = preflight(name, override, expected)
        destination = plugins / name
        if destination.exists():
            shutil.rmtree(destination)
        plugin.rename(destination)
    subprocess.run(["systemctl", "restart", "plugin_loader.service"], check=True)


def validate_host(host):
    if not host or host.startswith("-") or any(char.isspace() for char in host):
        raise DeployError(
            "set DECK_HOST to an SSH host or user@host, without SSH options"
        )
    # SCP-style rsync destinations cannot represent ports or shell syntax here.
    if not re.fullmatch(
        r"(?:[A-Za-z0-9_.-]+@)?(?:[A-Za-z0-9_.-]+|\[[0-9A-Fa-f:]+\])", host
    ):
        raise DeployError(
            "invalid DECK_HOST; use an SSH config alias for custom connection options"
        )
    return host


def ssh(host, arguments, *, sudo=False, capture=False):
    password = os.environ.get("DECK_PASS", "")
    if sudo:
        arguments = (
            ["sudo", "-S", "-p", "", "--", *arguments]
            if password
            else ["sudo", "-n", "--", *arguments]
        )
    # SSH invokes the remote login shell even when subprocess receives argv.
    # Quote every argument exactly once; secrets are never part of that command.
    return subprocess.run(
        ["ssh", "-T", "--", host, shlex.join(arguments)],
        check=True,
        text=True,
        input=password + "\n" if sudo and password else "",
        stdout=subprocess.PIPE if capture else None,
    )


def remote_call(host, operation, name, override, **kwargs):
    request = json.dumps(
        dict(operation=operation, name=name, override=override, **kwargs)
    )
    source = Path(__file__).read_text()
    return ssh(
        host, ["python3", "-c", source, "remote", request], sudo=True, capture=True
    ).stdout.strip()


def upload_and_install(host, name, override, plugins, archive):
    upload = ssh(
        host, ["mktemp", "-d", "/tmp/decky-music.XXXXXXXXXX"], capture=True
    ).stdout.strip()
    if not re.fullmatch(r"/tmp/decky-music\.[A-Za-z0-9]{10}", upload):
        raise DeployError("remote mktemp returned an unexpected staging directory")
    try:
        artifacts = [
            (Path(archive), "plugin.zip"),
            (Path("target/release/player"), "player"),
            (Path("target/release/ncm-provider"), "ncm-provider"),
            (Path("qq-provider/build/qq-provider.tar.gz"), "qq-provider.tar.gz"),
        ]
        for artifact, filename in artifacts:
            if artifact.is_file():
                subprocess.run(
                    [
                        "rsync",
                        "-azp",
                        "--protect-args",
                        "--",
                        str(artifact),
                        host + ":" + upload + "/" + filename,
                    ],
                    check=True,
                )
            elif filename == "plugin.zip":
                raise DeployError("plugin zip does not exist")
        remote_call(host, "install", name, override, expected=plugins, upload=upload)
    finally:
        ssh(host, ["rm", "-rf", "--", upload])


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "remote":
        request = json.loads(sys.argv[2])
        operation = request.pop("operation")
        if operation == "preflight":
            plugins = preflight(**request)
            plugin_account(service_properties(), plugins)
            print(plugins)
        elif operation == "install":
            install_remote(**request)
        else:
            raise DeployError("unknown remote operation")
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("preflight", "install"))
    parser.add_argument("--name", required=True)
    parser.add_argument(
        "--plugins", help="canonical path returned by preflight (required for install)"
    )
    parser.add_argument("--zip", help="built plugin zip (required for install)")
    args = parser.parse_args()
    validate_name(args.name)
    host = validate_host(os.environ.get("DECK_HOST", ""))
    override = os.environ.get("DECK_PLUGIN_PATH")
    if args.operation == "preflight":
        print(remote_call(host, "preflight", args.name, override))
    elif args.plugins and args.zip:
        upload_and_install(host, args.name, override, args.plugins, args.zip)
    else:
        parser.error("install requires --plugins and --zip")


if __name__ == "__main__":
    try:
        main()
    except (
        DeployError,
        OSError,
        ValueError,
        KeyError,
        zipfile.BadZipFile,
        subprocess.CalledProcessError,
    ) as error:
        # CalledProcessError includes argv, which can include the remote program.
        message = (
            "deployment command failed; check SSH, remote Python 3, and sudo access "
            "(DECK_PASS supplies the remote sudo password)"
            if isinstance(error, subprocess.CalledProcessError)
            else str(error)
        )
        print("Deployment failed: " + message, file=sys.stderr)
        sys.exit(1)
