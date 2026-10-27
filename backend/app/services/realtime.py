"""In-process WebSocket hub: per-user fan-out for chat, notifications and the live workforce feed."""
import asyncio
import json
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.connections: dict[int, set[WebSocket]] = defaultdict(set)
        self.roles: dict[int, str] = {}
        self.loop: asyncio.AbstractEventLoop | None = None

    async def connect(self, user_id: int, role: str, ws: WebSocket):
        await ws.accept()
        self.loop = asyncio.get_running_loop()
        self.connections[user_id].add(ws)
        self.roles[user_id] = role

    def disconnect(self, user_id: int, ws: WebSocket):
        self.connections[user_id].discard(ws)
        if not self.connections[user_id]:
            self.connections.pop(user_id, None)
            self.roles.pop(user_id, None)

    def online_user_ids(self) -> list[int]:
        return list(self.connections.keys())

    async def _send(self, user_id: int, message: dict):
        data = json.dumps(message, default=str)
        for ws in list(self.connections.get(user_id, ())):
            try:
                await ws.send_text(data)
            except Exception:
                self.disconnect(user_id, ws)

    async def send_to_user(self, user_id: int, message: dict):
        await self._send(user_id, message)

    async def send_to_roles(self, roles: tuple[str, ...], message: dict):
        for uid, role in list(self.roles.items()):
            if role in roles:
                await self._send(uid, message)

    # Sync helpers so regular (threadpool) route handlers can push events.
    def push_user(self, user_id: int, message: dict):
        if self.loop and user_id in self.connections:
            asyncio.run_coroutine_threadsafe(self._send(user_id, message), self.loop)

    def push_roles(self, roles: tuple[str, ...], message: dict):
        if self.loop:
            asyncio.run_coroutine_threadsafe(self.send_to_roles(roles, message), self.loop)


manager = ConnectionManager()
