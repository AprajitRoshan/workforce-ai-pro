from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..models import ChatMessage, User
from ..schemas import ChatSendIn
from ..security import HR_ROLES, get_current_user, require_roles, user_from_token
from ..services.realtime import manager
from ..utils import iso

router = APIRouter(prefix="/api/chat", tags=["Chat & Communication"])
ws_router = APIRouter(tags=["Realtime"])


def message_dict(m: ChatMessage) -> dict:
    return {"id": m.id, "sender_id": m.sender_id, "receiver_id": m.receiver_id, "content": m.content,
            "created_at": iso(m.created_at), "delivered_at": iso(m.delivered_at), "read_at": iso(m.read_at)}


def _pair(a: int, b: int):
    return or_(and_(ChatMessage.sender_id == a, ChatMessage.receiver_id == b),
               and_(ChatMessage.sender_id == b, ChatMessage.receiver_id == a))


def send_message(db: Session, sender: User, receiver_id: int, content: str) -> dict:
    receiver = db.get(User, receiver_id)
    if not receiver or not receiver.is_active or receiver.id == sender.id:
        raise HTTPException(400, "Invalid recipient")
    msg = ChatMessage(sender_id=sender.id, receiver_id=receiver_id, content=content.strip())
    if receiver_id in manager.connections:
        msg.delivered_at = datetime.now()
    db.add(msg)
    db.commit()
    data = {**message_dict(msg), "sender_name": sender.full_name}
    manager.push_user(receiver_id, {"type": "chat", "data": data})
    manager.push_user(sender.id, {"type": "chat", "data": data})
    return data


def mark_read(db: Session, reader: User, peer_id: int) -> int:
    now = datetime.now()
    n = db.query(ChatMessage).filter(ChatMessage.sender_id == peer_id, ChatMessage.receiver_id == reader.id,
                                     ChatMessage.read_at.is_(None)).update({ChatMessage.read_at: now})
    db.commit()
    if n:
        manager.push_user(peer_id, {"type": "read_receipt", "data": {"reader_id": reader.id, "read_at": now.isoformat()}})
    return n


@router.get("/conversations")
def conversations(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    msgs = db.query(ChatMessage).filter(or_(ChatMessage.sender_id == user.id, ChatMessage.receiver_id == user.id)) \
        .order_by(ChatMessage.created_at.desc()).limit(2000).all()
    convs: dict[int, dict] = {}
    for m in msgs:
        peer = m.receiver_id if m.sender_id == user.id else m.sender_id
        c = convs.setdefault(peer, {"peer_id": peer, "last_message": message_dict(m), "unread": 0})
        if m.receiver_id == user.id and m.read_at is None:
            c["unread"] += 1
    peers = {u.id: u for u in db.query(User).filter(User.id.in_(list(convs))).all()}
    online = set(manager.online_user_ids())
    out = []
    for pid, c in convs.items():
        p = peers.get(pid)
        if p:
            out.append({**c, "peer_name": p.full_name, "peer_role": p.role, "online": pid in online,
                        "last_seen": iso(p.last_seen)})
    return out


@router.get("/online")
def online(_: User = Depends(get_current_user)):
    return manager.online_user_ids()


@router.get("/messages/{peer_id}")
def history(peer_id: int, before_id: int | None = None, limit: int = 50, user: User = Depends(get_current_user),
            db: Session = Depends(get_db)):
    q = db.query(ChatMessage).filter(_pair(user.id, peer_id))
    if before_id:
        q = q.filter(ChatMessage.id < before_id)
    rows = q.order_by(ChatMessage.id.desc()).limit(min(limit, 200)).all()
    return [message_dict(m) for m in reversed(rows)]


@router.post("/messages", status_code=201)
def post_message(body: ChatSendIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return send_message(db, user, body.receiver_id, body.content)


@router.post("/read/{peer_id}")
def read(peer_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"updated": mark_read(db, user, peer_id)}


@router.get("/unread-count")
def unread(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"total": db.query(ChatMessage).filter(ChatMessage.receiver_id == user.id, ChatMessage.read_at.is_(None)).count()}


@router.get("/logs")
def communication_logs(days: int = 30, _: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    """Communication metadata for compliance (who talked to whom, how often) — message bodies are never exposed."""
    since = datetime.now() - timedelta(days=days)
    rows = db.query(ChatMessage.sender_id, ChatMessage.receiver_id, func.count(), func.max(ChatMessage.created_at)) \
        .filter(ChatMessage.created_at >= since).group_by(ChatMessage.sender_id, ChatMessage.receiver_id).all()
    pairs: dict[tuple, dict] = {}
    for s, r, c, last in rows:
        key = tuple(sorted((s, r)))
        p = pairs.setdefault(key, {"messages": 0, "last_at": last})
        p["messages"] += c
        p["last_at"] = max(p["last_at"], last)
    names = {u.id: u.full_name for u in db.query(User).all()}
    daily = {}
    for d, c in db.query(func.date(ChatMessage.created_at), func.count()).filter(ChatMessage.created_at >= since) \
            .group_by(func.date(ChatMessage.created_at)).all():
        daily[str(d)] = c
    return {"pairs": sorted([{"user_a": names.get(a), "user_b": names.get(b), "messages": v["messages"],
                              "last_at": iso(v["last_at"])} for (a, b), v in pairs.items()], key=lambda x: -x["messages"]),
            "daily": [{"date": k, "messages": v} for k, v in sorted(daily.items())],
            "total": sum(v["messages"] for v in pairs.values())}


# ---------------------------------------------------------------- websocket
@ws_router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str):
    db = SessionLocal()
    try:
        user = user_from_token(db, token)
    except HTTPException:
        await ws.close(code=4401)
        db.close()
        return
    await manager.connect(user.id, user.role, ws)
    await manager.send_to_roles(("ADMIN", "HR", "MANAGER", "EMPLOYEE"),
                                {"type": "presence", "data": {"user_id": user.id, "online": True}})
    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            if kind == "ping":
                await ws.send_json({"type": "pong"})
            elif kind == "chat" and msg.get("content"):
                try:
                    send_message(db, user, int(msg["receiver_id"]), str(msg["content"])[:4000])
                except HTTPException as e:
                    await ws.send_json({"type": "error", "data": e.detail})
            elif kind == "read":
                mark_read(db, user, int(msg["peer_id"]))
            elif kind == "typing":
                await manager.send_to_user(int(msg["peer_id"]), {"type": "typing", "data": {"user_id": user.id}})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        manager.disconnect(user.id, ws)
        u = db.get(User, user.id)
        if u:
            u.last_seen = datetime.now()
            db.commit()
        db.close()
        if user.id not in manager.connections:
            await manager.send_to_roles(("ADMIN", "HR", "MANAGER", "EMPLOYEE"),
                                        {"type": "presence", "data": {"user_id": user.id, "online": False}})
