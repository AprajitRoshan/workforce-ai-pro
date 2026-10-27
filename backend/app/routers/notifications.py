from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Notification, User
from ..schemas import BroadcastIn
from ..security import HR_ROLES, MGMT_ROLES, get_current_user, require_roles
from ..services.alert_engine import run_alert_engine
from ..services.events import log_activity, notification_dict, notify_roles
from ..utils import paginate

router = APIRouter(prefix="/api/notifications", tags=["Notifications & Alerts"])
alerts_router = APIRouter(prefix="/api/alerts", tags=["Notifications & Alerts"])


@router.get("")
def list_notifications(unread_only: bool = False, category: str | None = None, priority: str | None = None,
                       page: int = 1, size: int = 20, user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    q = db.query(Notification).filter(Notification.user_id == user.id)
    if unread_only:
        q = q.filter(Notification.is_read.is_(False))
    if category:
        q = q.filter(Notification.category == category)
    if priority:
        q = q.filter(Notification.priority == priority)
    return paginate(q.order_by(Notification.created_at.desc(), Notification.id.desc()), page, size, notification_dict)


@router.get("/unread-count")
def unread_count(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Notification.priority, func.count()).filter(
        Notification.user_id == user.id, Notification.is_read.is_(False)).group_by(Notification.priority).all()
    return {"total": sum(c for _, c in rows), "by_priority": dict(rows)}


def _own(db: Session, user: User, nid: int) -> Notification:
    n = db.get(Notification, nid)
    if not n or n.user_id != user.id:
        raise HTTPException(404, "Notification not found")
    return n


@router.post("/{nid}/read")
def mark_read(nid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = _own(db, user, nid)
    n.is_read = True
    db.commit()
    return notification_dict(n)


@router.post("/{nid}/unread")
def mark_unread(nid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = _own(db, user, nid)
    n.is_read = False
    db.commit()
    return notification_dict(n)


@router.post("/read-all")
def read_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.query(Notification).filter_by(user_id=user.id, is_read=False).update({Notification.is_read: True})
    db.commit()
    return {"updated": n}


@router.delete("/{nid}")
def delete_notification(nid: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_own(db, user, nid))
    db.commit()
    return {"ok": True}


@router.post("/broadcast")
def broadcast(body: BroadcastIn, user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    sent = notify_roles(db, tuple(body.roles), body.title, body.message, type_="INFO", category="SYSTEM",
                        priority=body.priority)
    log_activity(db, user, "BROADCAST", "notification", None, f"Broadcast '{body.title}' to {len(sent)} user(s)")
    return {"sent": len(sent)}


# ---------------------------------------------------------------- smart alert engine
@alerts_router.get("")
def list_alerts(priority: str | None = None, page: int = 1, size: int = 20, user: User = Depends(require_roles(*MGMT_ROLES)),
                db: Session = Depends(get_db)):
    q = db.query(Notification).filter(Notification.user_id == user.id, Notification.is_ai.is_(True))
    if priority:
        q = q.filter(Notification.priority == priority)
    return paginate(q.order_by(Notification.created_at.desc()), page, size, notification_dict)


@alerts_router.get("/stats")
def alert_stats(user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    base = db.query(Notification).filter(Notification.user_id == user.id, Notification.is_ai.is_(True))
    return {"by_priority": dict(base.with_entities(Notification.priority, func.count()).group_by(Notification.priority).all()),
            "by_category": dict(base.with_entities(Notification.category, func.count()).group_by(Notification.category).all()),
            "unread": base.filter(Notification.is_read.is_(False)).count(),
            "escalated": base.filter(Notification.escalated.is_(True)).count()}


@alerts_router.post("/run")
def run_alerts(user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    result = run_alert_engine(db)
    log_activity(db, user, "RUN", "alert_engine", None, f"Alert engine scan raised {result['total']} alert(s)")
    return result
