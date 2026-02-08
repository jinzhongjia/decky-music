"""Fallback provider 匹配工具。"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

TProvider = TypeVar("TProvider")
TMatch = TypeVar("TMatch")


async def collect_provider_matches(
    providers: list[tuple[str, TProvider]],
    matcher: Callable[[TProvider], Awaitable[TMatch | None]],
    timeout_seconds: float,
) -> list[tuple[str, TProvider, TMatch]]:
    """并发收集 fallback provider 的匹配结果。"""
    if not providers:
        return []

    tasks: dict[asyncio.Task[TMatch | None], tuple[str, TProvider]] = {}
    for provider_id, provider in providers:
        task = asyncio.create_task(
            asyncio.wait_for(matcher(provider), timeout=timeout_seconds)
        )
        tasks[task] = (provider_id, provider)

    matches: list[tuple[str, TProvider, TMatch]] = []
    try:
        while tasks:
            done, _ = await asyncio.wait(
                tasks.keys(),
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in done:
                provider_id, provider = tasks.pop(task)
                try:
                    match = task.result()
                except (asyncio.TimeoutError, Exception):
                    continue
                if match is not None:
                    matches.append((provider_id, provider, match))
    finally:
        pending_tasks = list(tasks.keys())
        for pending in pending_tasks:
            pending.cancel()
        if pending_tasks:
            await asyncio.gather(*pending_tasks, return_exceptions=True)

    return matches
