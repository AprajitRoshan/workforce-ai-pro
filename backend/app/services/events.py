"""Audit logging, activity feed and notification helpers shared by all routers."""
from datetime import date, datetime

from sqlalchemy.orm import Session

from ..models import ActivityLog, Notification, User
from .realtime import manager

FEED_ROLES = ("ADMIN", "HR", "MANAGER")


def _jsonable(v):
    if isinstance(v, (date, datetime)):
        return v.isoformat()
    return v


def diff(obj, data: dict) -> dict:
    """Return {field: [old, new]} for fields that change; used for change monitoring."""
    changes = {}
    for k, new in data.items():
        old = getattr(obj, k, None)
        if old != new:
            changes[k] = [_jsonable(old), _jsonable(new)]
    return changes


def log_activity(db: Session, user: User | None, action: str, entity_type: str, entity_id: int | None,
                 summary: str, changes: dict | None = None, ip: str | None = None, commit: bool = True):
    entry = ActivityLog(user_id=user.id if user else None, action=action, entity_type=entity_type,
                        entity_id=entity_id, summary=summary, changes=changes or {}, ip_address=ip)
    db.add(entry)
    if commit:
        db.commit()
    manager.push_roles(FEED_ROLES, {
        "type": "activity",
        "data": {"id": entry.id, "action": action, "entity_type": entity_type, "entity_id": entity_id,
                 "summary": summary, "user": user.full_name if user else "System",
                 "created_at": datetime.now().isoformat()},
    })
    return entry


def notify(db: Session, user_ids, title: str, message: str, type_: str = "INFO", category: str = "SYSTEM",
           priority: str = "LOW", link: str | None = None, is_ai: bool = False, commit: bool = True):
    created = []
    for uid in set(user_ids):
        n = Notification(user_id=uid, title=title, message=message, type=type_, category=category,
                         priority=priority, link=link, is_ai=is_ai)
        db.add(n)
        created.append(n)
    if commit:
        db.commit()
    else:
        db.flush()
    for n in created:
        manager.push_user(n.user_id, {"type": "notification", "data": notification_dict(n)})
    return created


def notify_roles(db: Session, roles: tuple[str, ...], *args, **kwargs):
    ids = [u.id for u in db.query(User.id).filter(User.role.in_(roles), User.is_active.is_(True)).all()]
    return notify(db, ids, *args, **kwargs)


def notification_dict(n: Notification) -> dict:
    return {"id": n.id, "title": n.title, "message": n.message, "type": n.type, "category": n.category,
            "priority": n.priority, "link": n.link, "is_read": n.is_read, "is_ai": n.is_ai,
            "escalated": n.escalated, "created_at": n.created_at.isoformat() if n.created_at else None}
