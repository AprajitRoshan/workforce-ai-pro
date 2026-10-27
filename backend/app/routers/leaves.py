from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import extract, func
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Attendance, Employee, LeavePolicy, LeaveRequest, User
from ..schemas import LeaveApplyIn, LeaveDecisionIn, LeavePolicyIn
from ..security import HR_ROLES, MGMT_ROLES, ensure_can_view_employee, get_current_user, require_roles, visible_employee_ids
from ..services.events import log_activity, notify, notify_roles
from ..utils import client_ip, leave_dict, paginate

router = APIRouter(prefix="/api/leaves", tags=["Leave Management"])

CARRY_FORWARD_CAP = 5


def business_days(start: date, end: date) -> int:
    n, d = 0, start
    while d <= end:
        if d.weekday() < 5:
            n += 1
        d += timedelta(days=1)
    return n


def _used(db: Session, employee_id: int, leave_type: str, year: int, statuses=("APPROVED",)) -> float:
    return db.query(func.coalesce(func.sum(LeaveRequest.days), 0)).filter(
        LeaveRequest.employee_id == employee_id, LeaveRequest.leave_type == leave_type,
        LeaveRequest.status.in_(statuses), extract("year", LeaveRequest.start_date) == year).scalar()


def leave_balance(db: Session, employee_id: int, year: int | None = None) -> list[dict]:
    year = year or date.today().year
    out = []
    for p in db.query(LeavePolicy).order_by(LeavePolicy.id).all():
        carried = 0.0
        if p.carry_forward:
            carried = min(CARRY_FORWARD_CAP, max(0.0, p.annual_quota - _used(db, employee_id, p.leave_type, year - 1)))
        used = _used(db, employee_id, p.leave_type, year)
        pending = _used(db, employee_id, p.leave_type, year, ("PENDING",))
        entitled = p.annual_quota + carried
        out.append({"leave_type": p.leave_type, "quota": p.annual_quota, "carried_forward": carried,
                    "entitled": entitled, "used": used, "pending": pending,
                    "remaining": None if p.leave_type == "UNPAID" else round(entitled - used - pending, 1)})
    return out


@router.get("/policies")
def policies(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [{"id": p.id, "leave_type": p.leave_type, "annual_quota": p.annual_quota, "carry_forward": p.carry_forward,
             "max_consecutive_days": p.max_consecutive_days, "requires_document": p.requires_document,
             "description": p.description} for p in db.query(LeavePolicy).order_by(LeavePolicy.id).all()]


@router.post("/policies", status_code=201)
def upsert_policy(body: LeavePolicyIn, user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    p = db.query(LeavePolicy).filter_by(leave_type=body.leave_type.upper()).first()
    action = "UPDATE" if p else "CREATE"
    if not p:
        p = LeavePolicy(leave_type=body.leave_type.upper())
        db.add(p)
    for k, v in body.model_dump(exclude={"leave_type"}).items():
        setattr(p, k, v)
    db.commit()
    log_activity(db, user, action, "leave_policy", p.id, f"{action.title()}d leave policy {p.leave_type}")
    return {"id": p.id, "leave_type": p.leave_type}


@router.delete("/policies/{policy_id}")
def delete_policy(policy_id: int, user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    p = db.get(LeavePolicy, policy_id)
    if not p:
        raise HTTPException(404, "Policy not found")
    db.delete(p)
    db.commit()
    log_activity(db, user, "DELETE", "leave_policy", policy_id, f"Deleted leave policy {p.leave_type}")
    return {"ok": True}


@router.get("/balance")
def balance(employee_id: int | None = None, year: int | None = None, user: User = Depends(get_current_user),
            db: Session = Depends(get_db)):
    eid = employee_id or user.employee_id
    if not eid:
        raise HTTPException(400, "No employee selected")
    ensure_can_view_employee(db, user, eid)
    return leave_balance(db, eid, year)


@router.post("", status_code=201)
def apply_leave(body: LeaveApplyIn, request: Request, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    if not user.employee_id:
        raise HTTPException(400, "Your account is not linked to an employee record")
    emp = db.get(Employee, user.employee_id)
    if body.end_date < body.start_date:
        raise HTTPException(400, "End date must be on or after start date")
    if body.start_date < date.today() - timedelta(days=30):
        raise HTTPException(400, "Cannot apply for leave more than 30 days in the past")
    policy = db.query(LeavePolicy).filter_by(leave_type=body.leave_type.upper()).first()
    if not policy:
        raise HTTPException(400, f"Unknown leave type {body.leave_type}")
    days = business_days(body.start_date, body.end_date)
    if days == 0:
        raise HTTPException(400, "Selected range contains no working days")
    if days > policy.max_consecutive_days:
        raise HTTPException(400, f"{policy.leave_type} leave allows at most {policy.max_consecutive_days} consecutive days")
    overlap = db.query(LeaveRequest).filter(
        LeaveRequest.employee_id == emp.id, LeaveRequest.status.in_(["PENDING", "APPROVED"]),
        LeaveRequest.start_date <= body.end_date, LeaveRequest.end_date >= body.start_date).first()
    if overlap:
        raise HTTPException(409, f"Overlaps with an existing {overlap.status.lower()} request ({overlap.start_date} – {overlap.end_date})")
    if policy.leave_type != "UNPAID":
        bal = next(b for b in leave_balance(db, emp.id, body.start_date.year) if b["leave_type"] == policy.leave_type)
        if days > bal["remaining"]:
            raise HTTPException(400, f"Insufficient {policy.leave_type} balance: {bal['remaining']} day(s) remaining")
    lr = LeaveRequest(employee_id=emp.id, leave_type=policy.leave_type, start_date=body.start_date,
                      end_date=body.end_date, days=days, reason=body.reason)
    db.add(lr)
    db.commit()
    log_activity(db, user, "CREATE", "leave", lr.id, f"{emp.full_name} applied for {days}d {policy.leave_type} leave",
                 ip=client_ip(request))
    approvers = {u.id for u in db.query(User).filter(User.role.in_(HR_ROLES)).all()}
    if emp.manager_id:
        mgr_user = db.query(User).filter_by(employee_id=emp.manager_id).first()
        if mgr_user:
            approvers.add(mgr_user.id)
    notify(db, approvers - {user.id}, "Leave approval needed",
           f"{emp.full_name} requested {days} day(s) of {policy.leave_type} leave from {body.start_date}.",
           category="LEAVE", priority="MEDIUM", link="/leaves?tab=approvals")
    return leave_dict(lr)


@router.get("")
def list_leaves(scope: str = "mine", status: list[str] | None = Query(None), leave_type: str | None = None,
                employee_id: int | None = None, department_id: int | None = None,
                date_from: date | None = None, date_to: date | None = None, page: int = 1, size: int = 20,
                user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(LeaveRequest).options(joinedload(LeaveRequest.employee).joinedload(Employee.department),
                                       joinedload(LeaveRequest.approver))
    if scope == "mine":
        q = q.filter(LeaveRequest.employee_id == (user.employee_id or -1))
    else:
        ids = visible_employee_ids(db, user)
        if ids is not None:
            q = q.filter(LeaveRequest.employee_id.in_(ids))
        if scope == "approvals":
            q = q.filter(LeaveRequest.employee_id != (user.employee_id or -1))
    if status:
        q = q.filter(LeaveRequest.status.in_(status))
    if leave_type:
        q = q.filter(LeaveRequest.leave_type == leave_type)
    if employee_id:
        q = q.filter(LeaveRequest.employee_id == employee_id)
    if department_id:
        q = q.join(Employee, Employee.id == LeaveRequest.employee_id).filter(Employee.department_id == department_id)
    if date_from:
        q = q.filter(LeaveRequest.end_date >= date_from)
    if date_to:
        q = q.filter(LeaveRequest.start_date <= date_to)
    return paginate(q.order_by(LeaveRequest.created_at.desc()), page, size, leave_dict)


@router.post("/{leave_id}/decision")
def decide(leave_id: int, body: LeaveDecisionIn, request: Request, user: User = Depends(require_roles(*MGMT_ROLES)),
           db: Session = Depends(get_db)):
    lr = db.get(LeaveRequest, leave_id)
    if not lr:
        raise HTTPException(404, "Leave request not found")
    ensure_can_view_employee(db, user, lr.employee_id)
    if lr.employee_id == user.employee_id:
        raise HTTPException(403, "You cannot approve your own leave")
    if lr.status != "PENDING":
        raise HTTPException(400, f"Request already {lr.status.lower()}")
    lr.status = "APPROVED" if body.approve else "REJECTED"
    lr.approver_id, lr.approver_comment, lr.decided_at = user.id, body.comment, datetime.now()
    if body.approve:  # reflect approved leave in attendance
        d = lr.start_date
        while d <= lr.end_date:
            if d.weekday() < 5:
                rec = db.query(Attendance).filter_by(employee_id=lr.employee_id, date=d).first()
                if not rec:
                    db.add(Attendance(employee_id=lr.employee_id, date=d, status="ON_LEAVE"))
                elif not rec.check_in:
                    rec.status = "ON_LEAVE"
            d += timedelta(days=1)
    db.commit()
    emp = lr.employee
    log_activity(db, user, lr.status, "leave", lr.id, f"{user.full_name} {lr.status.lower()} leave for {emp.full_name}",
                 ip=client_ip(request))
    owner = db.query(User).filter_by(employee_id=lr.employee_id).first()
    if owner:
        notify(db, [owner.id], f"Leave {lr.status.lower()}",
               f"Your {lr.leave_type} leave ({lr.start_date} – {lr.end_date}) was {lr.status.lower()}"
               + (f": {body.comment}" if body.comment else "."),
               type_="SUCCESS" if body.approve else "WARNING", category="LEAVE", link="/leaves")
    return leave_dict(lr)


@router.post("/{leave_id}/cancel")
def cancel(leave_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    lr = db.get(LeaveRequest, leave_id)
    if not lr or lr.employee_id != user.employee_id:
        raise HTTPException(404, "Leave request not found")
    if lr.status not in ("PENDING", "APPROVED") or (lr.status == "APPROVED" and lr.start_date <= date.today()):
        raise HTTPException(400, "Only pending or future approved leave can be cancelled")
    if lr.status == "APPROVED":
        db.query(Attendance).filter(Attendance.employee_id == lr.employee_id, Attendance.status == "ON_LEAVE",
                                    Attendance.date.between(lr.start_date, lr.end_date)).delete()
    lr.status = "CANCELLED"
    db.commit()
    log_activity(db, user, "CANCEL", "leave", lr.id, f"{user.full_name} cancelled a leave request")
    return leave_dict(lr)


@router.get("/report")
def leave_report(year: int | None = None, user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    year = year or date.today().year
    base = db.query(LeaveRequest).join(Employee, Employee.id == LeaveRequest.employee_id).filter(
        extract("year", LeaveRequest.start_date) == year)
    ids = visible_employee_ids(db, user)
    if ids is not None:
        base = base.filter(LeaveRequest.employee_id.in_(ids))
    by_status = dict(base.with_entities(LeaveRequest.status, func.count()).group_by(LeaveRequest.status).all())
    approved = base.filter(LeaveRequest.status == "APPROVED")
    by_type = [{"leave_type": t, "days": float(d), "requests": c} for t, d, c in approved.with_entities(
        LeaveRequest.leave_type, func.sum(LeaveRequest.days), func.count()).group_by(LeaveRequest.leave_type).all()]
    from ..models import Department
    by_dept = [{"department": n, "days": float(d)} for n, d in approved.join(Department, Department.id == Employee.department_id)
               .with_entities(Department.name, func.sum(LeaveRequest.days)).group_by(Department.name).all()]
    by_month = {m: 0.0 for m in range(1, 13)}
    for m, d in approved.with_entities(extract("month", LeaveRequest.start_date), func.sum(LeaveRequest.days)) \
            .group_by(extract("month", LeaveRequest.start_date)).all():
        by_month[int(m)] = float(d)
    return {"year": year, "by_status": by_status, "by_type": by_type, "by_department": by_dept,
            "by_month": [{"month": m, "days": d} for m, d in by_month.items()],
            "pending": by_status.get("PENDING", 0)}
