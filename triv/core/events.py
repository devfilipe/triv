"""triv.core.events — Async event bus for plugins and hooks."""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any, Callable


class EventBus:
    """Pub/sub event system. Supports sync and async handlers."""

    def __init__(self) -> None:
        self._handlers: dict[str, list[Callable]] = defaultdict(list)

    def subscribe(self, event: str, handler: Callable) -> None:
        self._handlers[event].append(handler)

    def unsubscribe(self, event: str, handler: Callable) -> None:
        try:
            self._handlers[event].remove(handler)
        except ValueError:
            pass

    async def emit(self, event: str, **kwargs: Any) -> list[Any]:
        """Fire event, collect results from all handlers."""
        results: list[Any] = []
        for handler in self._handlers.get(event, []):
            if asyncio.iscoroutinefunction(handler):
                r = await handler(**kwargs)
            else:
                r = handler(**kwargs)
            results.append(r)
        return results

    async def emit_chain(self, event: str, data: dict) -> dict:
        """Fire event as pipeline — each handler may modify *data*."""
        for handler in self._handlers.get(event, []):
            if asyncio.iscoroutinefunction(handler):
                data = (await handler(data)) or data
            else:
                data = handler(data) or data
        return data

    def handler_count(self, event: str | None = None) -> int:
        if event:
            return len(self._handlers.get(event, []))
        return sum(len(v) for v in self._handlers.values())

    @property
    def events(self) -> list[str]:
        return list(self._handlers.keys())
