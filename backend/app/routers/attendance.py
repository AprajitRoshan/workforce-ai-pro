from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import case, func
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import Attendance, Employee, Shift, ShiftAssignment, User
from ..schemas import ShiftAssignIn, ShiftIn
from ..security import HR_ROLES, get_current_user, require_roles, visible_employee_ids
from ..services.events import log_activity, notify
from ..utils import attendance_dict, client_ip, iso, paginate

router = APIRouter(prefix="/api/attendance", tags=["Attendance & Shifts"])
shifts_router = APIRouter(prefix="/api/shifts", tags=["Attendance & Shifts"])

DEFAULT_SHIFT = (time(9, 0), time(18, 0), 15)


def shift_for(db: Session, employee_id: int, day: date):
    a = db.query(ShiftAssignment).options(joinedload(ShiftAssignment.shift)).filter(
        ShiftAssignment.employee_id == employee_id, ShiftAssignment.start_date <= day,
        (ShiftAssignment.end_date.is_(None)) | (ShiftAssignment.end_date >= day),
    ).order_by(ShiftAssignment.start_date.desc()).first()
    if a:
        return a.shift.name, a.shift.start_time, a.shift.end_time, a.shift.grace_minutes
    return "General", *DEFAULT_SHIFT


def shift_hours(start: time, end: time) -> float:
    s, e = datetime.combine(date.today(), start), datetime.combine(date.today(), end)
    if e <= s:
        e += timedelta(days=1)  # overnight shift
    return (e - s).total_seconds() / 3600


def compute_hours(check_in: datetime, check_out: datetime, start: time, end: time):
    worked = max(0.0, (check_out - check_in).total_seconds() / 3600)
    overtime = max(0.0, worked - shift_hours(start, end))
    return round(worked, 2), round(overtime, 2)


def _me(user: User, db: Session) -> Employee:
    if not user.employee_id:
        raise HTTPException(400, "Your account is not linked to an employee record")
    return db.get(Employee, user.employee_id)


@router.get("/today")
def today_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not user.employee_id:
        return {"linked": False}
    rec = db.query(Attendance).filter_by(employee_id=user.employee_id, date=date.today()).first()
    name, start, end, grace = shift_for(db, user.employee_id, date.today())
    return {"linked": True, "record": attendance_dict(rec) if rec else None,
            "shift": {"name": name, "start": start.strftime("%H:%M"), "end": end.strftime("%H:%M"), "grace": grace}}


@router.post("/check-in")
def check_in(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    emp = _me(user, db)
    today, now = date.today(), datetime.now()
    rec = db.query(Attendance).filter_by(employee_id=emp.id, date=today).first()
    if rec and rec.check_in:
        raise HTTPException(400, "Already checked in today")
    _, start, _, grace = shift_for(db, emp.id, today)
    late = now > datetime.combine(today, start) + timedelta(minutes=grace)
    if not rec:
        rec = Attendance(employee_id=emp.id, date=today)
        db.add(rec)
    rec.check_in, rec.status = now, ("LATE" if late else "PRESENT")
    db.commit()
    log_activity(db, user, "CHECK_IN", "attendance", rec.id,
                 f"{emp.full_name} checked in{' (late)' if late else ''} at {now:%H:%M}", ip=client_ip(request))
    return attendance_dict(rec)


@router.post("/check-out")
def check_out(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    emp = _me(user, db)
    rec = db.query(Attendance).filter_by(employee_id=emp.id, date=date.today()).first()
    if not rec or not rec.check_in:
        raise HTTPException(400, "You have not checked in today")
    if rec.check_out:
        raise HTTPException(400, "Already checked out today")
    _, start, end, _ = shift_for(db, emp.id, rec.date)
    rec.check_out = datetime.now()
    rec.hours_worked, rec.overtime_hours = compute_hours(rec.check_in, rec.check_out, start, end)
    if rec.hours_worked < 4.5:
        rec.status = "HALF_DAY"
    db.commit()
    log_activity(db, user, "CHECK_OUT", "attendance", rec.id,
                 f"{emp.full_name} checked out after {rec.hours_worked:.1f}h", ip=client_ip(request))
    if rec.overtime_hours >= 3:
        notify(db, [user.id], "Long working day", f"You logged {rec.overtime_hours:.1f}h overtime today. "
               "Remember to rest.", type_="WARNING", category="ATTENDANCE")
    return attendance_dict(rec)


def _scoped(db: Session, user: User, query, employee_id=None, department_id=None):
    ids = visible_employee_ids(db, user)
    if ids is not None:
        query = query.filter(Attendance.employee_id.in_(ids))
    if employee_id:
        query = query.filter(Attendance.employee_id == employee_id)
    if department_id:
        query = query.join(Employee, Employee.id == Attendance.employee_id).filter(Employee.department_id == department_id)
    return query


@router.get("")
def list_attendance(employee_id: int | None = None, department_id: int | None = None,
                    date_from: date | None = None, date_to: date | None = None,
                    status: list[str] | None = Query(None), page: int = 1, size: int = 25,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = _scoped(db, user, db.query(Attendance).options(joinedload(Attendance.employee)), employee_id, department_id)
    if date_from:
        q = q.filter(Attendance.date >= date_from)
    if date_to:
        q = q.filter(Attendance.date <= date_to)
    if status:
        q = q.filter(Attendance.status.in_(status))
    return paginate(q.order_by(Attendance.date.desc(), Attendance.id.desc()), page, size, attendance_dict)


@router.get("/report")
def attendance_report(date_from: date | None = None, date_to: date | None = None, department_id: int | None = None,
                      user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    date_to = date_to or date.today()
    date_from = date_from or date_to - timedelta(days=29)
    cnt = lambda s: func.sum(case((Attendance.status == s, 1), else_=0))  # noqa: E731
    q = db.query(Attendance.employee_id, cnt("PRESENT").label("present"), cnt("LATE").label("late"),
                 cnt("ABSENT").label("absent"), cnt("HALF_DAY").label("half_day"), cnt("ON_LEAVE").label("on_leave"),
                 func.sum(Attendance.hours_worked).label("hours"), func.sum(Attendance.overtime_hours).label("overtime"),
                 func.count(Attendance.id).label("days")) \
        .filter(Attendance.date.between(date_from, date_to))
    q = _scoped(db, user, q, department_id=department_id).group_by(Attendance.employee_id)
    rows = q.all()
    emps = {e.id: e for e in db.query(Employee).options(joinedload(Employee.department))
            .filter(Employee.id.in_([r.employee_id for r in rows])).all()}
    out = []
    for r in rows:
        e = emps.get(r.employee_id)
        worked_days = (r.present or 0) + (r.late or 0) + (r.half_day or 0)
        out.append({"employee_id": r.employee_id, "employee": e.full_name if e else None,
                    "employee_code": e.employee_code if e else None,
                    "department": e.department.name if e and e.department else None,
                    "present": r.present, "late": r.late, "absent": r.absent, "half_day": r.half_day,
                    "on_leave": r.on_leave, "total_hours": round(r.hours or 0, 1), "overtime_hours": round(r.overtime or 0, 1),
                    "avg_hours": round((r.hours or 0) / worked_days, 2) if worked_days else 0,
                    "attendance_rate": round(worked_days / r.days * 100, 1) if r.days else 0})
    out.sort(key=lambda x: x["employee"] or "")
    return {"from": iso(date_from), "to": iso(date_to), "rows": out}


@router.get("/summary")
def attendance_summary(days: int = 30, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    since = date.today() - timedelta(days=days - 1)
    q = db.query(Attendance.date, Attendance.status, func.count()).filter(Attendance.date >= since)
    q = _scoped(db, user, q).group_by(Attendance.date, Attendance.status)
    by_day: dict[str, dict] = {}
    for d, s, c in q.all():
        row = by_day.setdefault(iso(d), {"date": iso(d), "PRESENT": 0, "LATE": 0, "ABSENT": 0, "HALF_DAY": 0, "ON_LEAVE": 0})
        row[s] = c
    trend = sorted(by_day.values(), key=lambda r: r["date"])
    totals = {k: sum(r[k] for r in trend) for k in ("PRESENT", "LATE", "ABSENT", "HALF_DAY", "ON_LEAVE")}
    all_days = sum(totals.values()) or 1
    ot = _scoped(db, user, db.query(func.sum(Attendance.overtime_hours), func.avg(Attendance.hours_worked))
                 .filter(Attendance.date >= since, Attendance.hours_worked > 0)).first()
    return {"trend": trend, "totals": totals,
            "attendance_rate": round((totals["PRESENT"] + totals["LATE"] + totals["HALF_DAY"]) / all_days * 100, 1),
            "punctuality_rate": round(totals["PRESENT"] / max(1, totals["PRESENT"] + totals["LATE"]) * 100, 1),
            "total_overtime": round(ot[0] or 0, 1), "avg_hours": round(ot[1] or 0, 2)}


# ---------------------------------------------------------------- shifts
def _shift_dict(s: Shift, count: int = 0) -> dict:
    return {"id": s.id, "name": s.name, "start_time": s.start_time.strftime("%H:%M"),
            "end_time": s.end_time.strftime("%H:%M"), "grace_minutes": s.grace_minutes,
            "hours": round(shift_hours(s.start_time, s.end_time), 1), "employees": count}


@shifts_router.get("")
def list_shifts(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    today = date.today()
    counts = dict(db.query(ShiftAssignment.shift_id, func.count()).filter(
        ShiftAssignment.start_date <= today,
        (ShiftAssignment.end_date.is_(None)) | (ShiftAssignment.end_date >= today)).group_by(ShiftAssignment.shift_id).all())
    return [_shift_dict(s, counts.get(s.id, 0)) for s in db.query(Shift).order_by(Shift.start_time).all()]


@shifts_router.post("", status_code=201)
def create_shift(body: ShiftIn, user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    if db.query(Shift).filter_by(name=body.name).first():
        raise HTTPException(409, "Shift name already exists")
    s = Shift(**body.model_dump())
    db.add(s)
    db.commit()
    log_activity(db, user, "CREATE", "shift", s.id, f"Created shift {s.name}")
    return _shift_dict(s)


@shifts_router.put("/{shift_id}")
def update_shift(shift_id: int, body: ShiftIn, user: User = Depends(require_roles(*HR_ROLES)),
                 db: Session = Depends(get_db)):
    s = db.get(Shift, shift_id)
    if not s:
        raise HTTPException(404, "Shift not found")
    for k, v in body.model_dump().items():
        setattr(s, k, v)
    db.commit()
    log_activity(db, user, "UPDATE", "shift", s.id, f"Updated shift {s.name}")
    return _shift_dict(s)


@shifts_router.delete("/{shift_id}")
def delete_shift(shift_id: int, user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    s = db.get(Shift, shift_id)
    if not s:
        raise HTTPException(404, "Shift not found")
    db.delete(s)
    db.commit()
    log_activity(db, user, "DELETE", "shift", shift_id, f"Deleted shift {s.name}")
    return {"ok": True}


@shifts_router.post("/assign")
def assign_shift(body: ShiftAssignIn, user: User = Depends(require_roles("ADMIN", "HR", "MANAGER")),
                 db: Session = Depends(get_db)):
    shift = db.get(Shift, body.shift_id)
    if not shift:
        raise HTTPException(404, "Shift not found")
    ids = visible_employee_ids(db, user)
    targets = [i for i in body.employee_ids if ids is None or i in ids]
    for eid in targets:
        # close any open assignment that overlaps the new one
        for a in db.query(ShiftAssignment).filter(ShiftAssignment.employee_id == eid, ShiftAssignment.end_date.is_(None)).all():
            a.end_date = body.start_date - timedelta(days=1) if a.start_date < body.start_date else a.start_date
        db.add(ShiftAssignment(employee_id=eid, shift_id=shift.id, start_date=body.start_date, end_date=body.end_date))
    db.commit()
    log_activity(db, user, "ASSIGN", "shift", shift.id, f"Assigned {len(targets)} employee(s) to {shift.name} shift")
    linked = [u.id for u in db.query(User).filter(User.employee_id.in_(targets)).all()]
    notify(db, linked, "Shift assignment", f"You are assigned to the {shift.name} shift "
           f"({shift.start_time:%H:%M}-{shift.end_time:%H:%M}) from {body.start_date}.", category="ATTENDANCE")
    return {"assigned": len(targets)}


@shifts_router.get("/assignments")
def list_assignments(shift_id: int | None = None, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    today = date.today()
    q = db.query(ShiftAssignment).options(joinedload(ShiftAssignment.shift), joinedload(ShiftAssignment.employee)) \
        .filter((ShiftAssignment.end_date.is_(None)) | (ShiftAssignment.end_date >= today))
    ids = visible_employee_ids(db, user)
    if ids is not None:
        q = q.filter(ShiftAssignment.employee_id.in_(ids))
    if shift_id:
        q = q.filter(ShiftAssignment.shift_id == shift_id)
    return [{"id": a.id, "employee_id": a.employee_id, "employee": a.employee.full_name, "shift": a.shift.name,
             "shift_id": a.shift_id, "start_date": iso(a.start_date), "end_date": iso(a.end_date)}
            for a in q.order_by(ShiftAssignment.start_date.desc()).limit(500).all()]
