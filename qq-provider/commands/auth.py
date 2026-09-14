"""Authentication commands; intent generations are registered by the dispatcher."""

import asyncio

import protocol
from qq import account, login

COMMANDS = frozenset({"set_credential", "login", "logout", "account"})


async def handle(q, req, emit, log, generation):
    match req.cmd:
        case "set_credential":
            cred = req.args.get("cred")
            generation = await q.set_credential(cred, generation)
            if generation is None:
                return protocol.ok(req.id, {"refreshed": None})
            log("info", "credential", "injected" if cred else "cleared")
            refreshed = await login.refresh_if_expired(q, log, generation) if cred else None
            if refreshed:
                log("info", "credential", "refreshed expired credential")
            return protocol.ok(req.id, {"refreshed": refreshed})
        case "login":
            await q.cancel_login()
            if generation == q.auth_generation:
                kind = req.args.get("type") or "qq"
                q.login_task = asyncio.create_task(login.run(q, emit, log, generation, kind))
            return protocol.ok(req.id)
        case "logout":
            await q.logout(generation)
            log("info", "logout", "done")
            return protocol.ok(req.id)
        case "account":
            return protocol.ok(req.id, await account.get(q))
