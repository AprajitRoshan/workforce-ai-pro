from collections import Counter
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import (ActivityLog, Attendance, Department, Document, Employee, Goal, Intervention, JobRole,
                      LeaveRequest, Notification, Payroll, Prediction, Task, User)
from ..security import HR_ROLES, MGMT_ROLES, get_current_user, require_roles, visible_employee_ids
from ..services import ai
from ..services.realtime import manager
from ..utils import activity_dict, employee_brief, iso, paginate, task_dict
from .leaves import leave_balance

router = APIRouter(prefix="/api", tags=["Analytics, Forecasting & Monitoring"])


# ================================================================ dashboard (Module 10)
@router.get("/dashboard")
def dashboard(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    today = date.today()
    if user.role == "EMPLOYEE":
        return _employee_dashboard(db, user, today)
    scope = visible_employee_ids(db, user)
    emp_q = db.query(Employee)
    if scope is not None:
        emp_q = emp_q.filter(Employee.id.in_(scope))
    active = emp_q.filter(Employee.status.in_(["ACTIVE", "ON_LEAVE"]))
    month_ago = today - timedelta(days=30)
    status_counts = dict(emp_q.with_entities(Employee.status, func.count()).group_by(Employee.status).all())
    gender = dict(active.with_entities(Employee.gender, func.count()).group_by(Employee.gender).all())

    att_today = dict(db.query(Attendance.status, func.count()).filter(
        Attendance.date == today, *( [Attendance.employee_id.in_(scope)] if scope is not None else [])
    ).group_by(Attendance.status).all())
    headcount = active.count()
    checked_in = sum(att_today.get(s, 0) for s in ("PRESENT", "LATE", "HALF_DAY"))
    trend = []
    rows = db.query(Attendance.date, Attendance.status, func.count()).filter(
        Attendance.date >= today - timedelta(days=13), *([Attendance.employee_id.in_(scope)] if scope is not None else [])
    ).group_by(Attendance.date, Attendance.status).all()
    by_day = {}
    for d, s, c in rows:
        by_day.setdefault(d, Counter())[s] += c
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        c = by_day.get(d, Counter())
        if d.weekday() < 5:
            trend.append({"date": d.strftime("%d %b"), "present": c["PRESENT"] + c["HALF_DAY"], "late": c["LATE"],
                          "absent": c["ABSENT"], "on_leave": c["ON_LEAVE"]})

    dept_rows = []
    for d in db.query(Department).order_by(Department.name).all():
        dq = active.filter(Employee.department_id == d.id)
        n = dq.count()
        if n:
            dept_rows.append({"department": d.name, "headcount": n,
                              "avg_risk": round(dq.with_entities(func.avg(Employee.risk_score)).scalar() or 0, 1),
                              "avg_salary": round(dq.with_entities(func.avg(Employee.salary)).scalar() or 0)})

    payroll = None
    if user.role in HR_ROLES:
        last_period = db.query(func.max(Payroll.period)).scalar()
        if last_period:
            g, n, t, c = db.query(func.sum(Payroll.gross), func.sum(Payroll.net), func.sum(Payroll.tax), func.count()) \
                .filter(Payroll.period == last_period).first()
            ptrend = [{"period": p, "net": round(v or 0)} for p, v in db.query(Payroll.period, func.sum(Payroll.net))
                      .group_by(Payroll.period).order_by(Payroll.period.desc()).limit(6).all()][::-1]
            payroll = {"period": last_period, "gross": round(g or 0), "net": round(n or 0), "tax": round(t or 0),
                       "payslips": c, "trend": ptrend}

    risk = dict(active.with_entities(Employee.risk_level, func.count()).group_by(Employee.risk_level).all())
    pend_leaves = db.query(LeaveRequest).filter(LeaveRequest.status == "PENDING",
                                                *([LeaveRequest.employee_id.in_(scope)] if scope is not None else [])).count()
    recent = db.query(ActivityLog).options(joinedload(ActivityLog.user)).order_by(ActivityLog.id.desc()).limit(8).all()
    return {
        "role": user.role,
        "employees": {"total": sum(status_counts.values()), "active": headcount, "by_status": status_counts,
                      "new_hires_30d": emp_q.filter(Employee.hire_date >= month_ago).count(),
                      "exits_30d": emp_q.filter(Employee.termination_date >= month_ago).count(), "gender": gender},
        "attendance": {"today": att_today, "checked_in": checked_in,
                       "rate_today": round(checked_in / headcount * 100, 1) if headcount else 0, "trend": trend},
        "payroll": payroll,
        "departments": dept_rows,
        "risk": {lv: risk.get(lv, 0) for lv in ("LOW", "MEDIUM", "HIGH", "CRITICAL")},
        "pending_leaves": pend_leaves,
        "open_interventions": db.query(Intervention).filter(Intervention.status.in_(["OPEN", "IN_PROGRESS"])).count(),
        "open_tasks": db.query(Task).filter(Task.status != "DONE").count(),
        "overdue_tasks": db.query(Task).filter(Task.status != "DONE", Task.due_date < today).count(),
        "online_users": len(manager.online_user_ids()),
        "recent_activity": [activity_dict(a) for a in recent] if user.role in HR_ROLES else [],
    }


def _employee_dashboard(db: Session, user: User, today: date) -> dict:
    eid = user.employee_id
    if not eid:
        return {"role": "EMPLOYEE", "linked": False}
    e = db.get(Employee, eid)
    month_ago = today - timedelta(days=30)
    att = db.query(Attendance).filter(Attendance.employee_id == eid, Attendance.date >= month_ago).all()
    worked = [a for a in att if a.status in ("PRESENT", "LATE", "HALF_DAY")]
    pay = db.query(Payroll).filter_by(employee_id=eid).order_by(Payroll.period.desc()).limit(6).all()
    tasks = db.query(Task).filter(Task.assignee_id == eid, Task.status != "DONE").order_by(Task.due_date).limit(6).all()
    goals = db.query(Goal).filter_by(employee_id=eid, status="ACTIVE").all()
    return {
        "role": "EMPLOYEE", "linked": True, "employee": employee_brief(e),
        "today": next(({"status": a.status, "check_in": iso(a.check_in), "check_out": iso(a.check_out)}
                       for a in att if a.date == today), None),
        "attendance": {"rate_30d": round(len(worked) / len(att) * 100, 1) if att else None,
                       "hours_30d": round(sum(a.hours_worked for a in att), 1),
                       "overtime_30d": round(sum(a.overtime_hours for a in att), 1),
                       "late_30d": sum(1 for a in att if a.status == "LATE"),
                       "trend": [{"date": a.date.strftime("%d %b"), "hours": a.hours_worked}
                                 for a in sorted(att, key=lambda a: a.date)[-14:]]},
        "leave_balance": leave_balance(db, eid),
        "payroll": [{"id": p.id, "period": p.period, "net": p.net, "gross": p.gross} for p in pay][::-1],
        "tasks": [task_dict(t) for t in tasks],
        "goals": [{"id": g.id, "title": g.title, "progress": g.progress, "target_date": iso(g.target_date)} for g in goals],
        "unread_notifications": db.query(Notification).filter_by(user_id=user.id, is_read=False).count(),
    }


# ================================================================ attrition analytics (Module 15)
@router.get("/analytics/attrition")
def attrition_analytics(months: int = 24, department_id: int | None = None, _: User = Depends(require_roles(*MGMT_ROLES)),
                        db: Session = Depends(get_db)):
    today = date.today()
    year_ago = today - timedelta(days=365)
    q = db.query(Employee).options(joinedload(Employee.department), joinedload(Employee.job_role))
    if department_id:
        q = q.filter(Employee.department_id == department_id)
    everyone = q.all()
    leavers = [e for e in everyone if e.termination_date]
    leavers_12m = [e for e in leavers if e.termination_date >= year_ago]
    active = [e for e in everyone if e.status in ("ACTIVE", "ON_LEAVE")]
    avg_hc = len(active) + len(leavers_12m) / 2 or 1
    history = ai.headcount_history(db, months, department_id)

    def band(years):
        return "<1y" if years < 1 else "1-3y" if years < 3 else "3-5y" if years < 5 else "5-10y" if years < 10 else "10y+"

    def tenure(e):
        return ((e.termination_date or today) - e.hire_date).days / 365.25

    def salary_band(s):
        return "<40k" if s < 40000 else "40-70k" if s < 70000 else "70-110k" if s < 110000 else "110-170k" if s < 170000 else "170k+"

    def breakdown(keyfn, order=None):
        tot, left = Counter(), Counter()
        for e in active + leavers_12m:
            tot[keyfn(e)] += 1
        for e in leavers_12m:
            left[keyfn(e)] += 1
        keys = order or sorted(tot)
        return [{"group": k, "employees": tot[k], "exits": left[k], "attrition_rate": round(left[k] / tot[k] * 100, 1) if tot[k] else 0}
                for k in keys if tot[k]]

    by_dept = breakdown(lambda e: e.department.name if e.department else "Unassigned")
    for row in by_dept:
        members = [e for e in active if (e.department.name if e.department else "Unassigned") == row["group"]]
        row["avg_risk"] = round(sum(e.risk_score or 0 for e in members) / len(members), 1) if members else None
    reasons = Counter(e.termination_reason or "Not specified" for e in leavers_12m)
    trend = []
    for d, avg, n in db.query(func.date(Prediction.created_at), func.avg(Prediction.risk_score), func.count()) \
            .group_by(func.date(Prediction.created_at)).order_by(func.date(Prediction.created_at)).all():
        trend.append({"date": str(d), "avg_risk": round(avg, 1), "scored": n})
    return {
        "summary": {"exits_12m": len(leavers_12m), "attrition_rate_12m": round(len(leavers_12m) / avg_hc * 100, 1),
                    "voluntary_12m": sum(1 for e in leavers_12m if e.status == "RESIGNED"),
                    "involuntary_12m": sum(1 for e in leavers_12m if e.status == "TERMINATED"),
                    "avg_tenure_leavers": round(sum(tenure(e) for e in leavers_12m) / len(leavers_12m), 1) if leavers_12m else None,
                    "active": len(active), "at_risk": sum(1 for e in active if e.risk_level in ("HIGH", "CRITICAL")),
                    "early_exits_12m": sum(1 for e in leavers_12m if tenure(e) < 1)},
        "turnover": history,
        "by_department": sorted(by_dept, key=lambda r: -r["attrition_rate"]),
        "by_tenure": breakdown(lambda e: band(tenure(e)), ["<1y", "1-3y", "3-5y", "5-10y", "10y+"]),
        "by_job_level": breakdown(lambda e: f"L{e.job_role.level}" if e.job_role else "L?"),
        "by_salary_band": breakdown(lambda e: salary_band(e.salary), ["<40k", "40-70k", "70-110k", "110-170k", "170k+"]),
        "exit_reasons": [{"reason": r, "count": c} for r, c in reasons.most_common()],
        "risk_trend": trend,
        "recent_leavers": [{**employee_brief(e), "termination_date": iso(e.termination_date),
                            "reason": e.termination_reason, "tenure": round(tenure(e), 1)}
                           for e in sorted(leavers, key=lambda e: e.termination_date, reverse=True)[:15]],
    }


# ================================================================ forecasting & stability (Modules 14, 27)
@router.get("/forecast")
def workforce_forecast(horizon: int = 12, department_id: int | None = None, _: User = Depends(require_roles(*MGMT_ROLES)),
                       db: Session = Depends(get_db)):
    return ai.forecast(db, max(3, min(horizon, 36)), department_id)


@router.get("/stability")
def workforce_stability(_: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    depts = ai.stability(db)
    fc = ai.forecast(db, 12)
    total = sum(d["headcount"] for d in depts) or 1
    overall = sum(d["stability_score"] * d["headcount"] for d in depts) / total
    return {"overall_score": round(overall, 1), "growth_rate_12m": fc["growth_rate_12m"],
            "retention_rate_12m": fc["retention_rate_12m"], "departments": depts,
            "growth": [{"department": d["department"], "current": d["headcount"],
                        "projected_12m": round(ai.forecast(db, 12, d["department_id"])["forecast"][-1]["headcount"], 1)}
                       for d in depts]}


# ================================================================ real-time monitoring (Module 18)
@router.get("/monitoring/live")
def live_monitoring(user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    today = date.today()
    scope = visible_employee_ids(db, user)
    act_q = db.query(Employee).filter(Employee.status.in_(["ACTIVE", "ON_LEAVE"]))
    if scope is not None:
        act_q = act_q.filter(Employee.id.in_(scope))
    active = {e.id: e for e in act_q.options(joinedload(Employee.department)).all()}
    recs = {a.employee_id: a for a in db.query(Attendance).filter(Attendance.date == today,
                                                                  Attendance.employee_id.in_(list(active))).all()}
    working = [a for a in recs.values() if a.check_in and not a.check_out]
    done = [a for a in recs.values() if a.check_out]
    late = [a for a in recs.values() if a.status == "LATE"]
    leave = [a for a in recs.values() if a.status == "ON_LEAVE"]
    not_in = [e for eid, e in active.items() if eid not in recs or recs[eid].status == "ABSENT"]
    n = len(active) or 1

    # 30-day baseline for instability detection
    since = today - timedelta(days=30)
    base = db.query(Attendance.date, Attendance.status, func.count()).filter(
        Attendance.date >= since, Attendance.date < today, Attendance.employee_id.in_(list(active))
    ).group_by(Attendance.date, Attendance.status).all()
    days = {d for d, _, _ in base} or {today}
    avg_absent = sum(c for _, s, c in base if s == "ABSENT") / len(days)
    avg_late = sum(c for _, s, c in base if s == "LATE") / len(days)
    absent_today = sum(1 for a in recs.values() if a.status == "ABSENT")
    signals = []
    if datetime.now().hour >= 11 and len(not_in) > max(3, 1.5 * avg_absent + 2):
        signals.append({"level": "HIGH", "signal": "Absence spike",
                        "detail": f"{len(not_in)} employees not checked in vs. {avg_absent:.1f}/day baseline."})
    if len(late) > max(3, 1.5 * avg_late + 1):
        signals.append({"level": "MEDIUM", "signal": "Late arrivals spike",
                        "detail": f"{len(late)} late arrivals today vs. {avg_late:.1f}/day baseline."})
    hr_absent = [e for e in not_in if e.risk_level in ("HIGH", "CRITICAL")]
    if hr_absent:
        signals.append({"level": "HIGH", "signal": "High-risk employees absent",
                        "detail": ", ".join(e.full_name for e in hr_absent[:5]) + (" …" if len(hr_absent) > 5 else "")})
    pend = db.query(LeaveRequest).filter(LeaveRequest.status == "PENDING", LeaveRequest.created_at >= datetime.now() - timedelta(days=7)).count()
    if pend >= 8:
        signals.append({"level": "MEDIUM", "signal": "Leave request surge", "detail": f"{pend} leave requests raised in the last 7 days."})
    for s in ai.stability(db):
        if s["status"] == "UNSTABLE":
            signals.append({"level": "HIGH", "signal": f"{s['department']} unstable",
                            "detail": f"Stability score {s['stability_score']} — {s['high_risk_share']}% high-risk staff."})
    by_dept = Counter(active[a.employee_id].department.name if active[a.employee_id].department else "—" for a in working)
    feed = db.query(ActivityLog).options(joinedload(ActivityLog.user)).order_by(ActivityLog.id.desc()).limit(30).all()
    return {
        "timestamp": datetime.now().isoformat(), "headcount": len(active),
        "working_now": len(working), "checked_out": len(done), "late": len(late), "on_leave": len(leave),
        "not_checked_in": len(not_in), "absent_marked": absent_today, "online_users": len(manager.online_user_ids()),
        "presence_rate": round((len(working) + len(done)) / n * 100, 1),
        "working_by_department": [{"department": k, "count": v} for k, v in by_dept.most_common()],
        "working": [{"employee_id": a.employee_id, "employee": active[a.employee_id].full_name,
                     "department": active[a.employee_id].department.name if active[a.employee_id].department else None,
                     "check_in": iso(a.check_in), "status": a.status} for a in sorted(working, key=lambda a: a.check_in)][:100],
        "instability_signals": signals,
        "feed": [activity_dict(a) for a in feed],
    }


@router.get("/monitoring/activity")
def activity_feed(action: str | None = None, entity_type: str | None = None, page: int = 1, size: int = 30,
                  _: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    q = db.query(ActivityLog).options(joinedload(ActivityLog.user))
    if action:
        q = q.filter(ActivityLog.action == action)
    if entity_type:
        q = q.filter(ActivityLog.entity_type == entity_type)
    return paginate(q.order_by(ActivityLog.id.desc()), page, size, activity_dict)


# ================================================================ global search (Module 24)
@router.get("/search")
def global_search(q: str = Query(min_length=1), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    like = f"%{q.strip()}%"
    scope = visible_employee_ids(db, user)
    eq = db.query(Employee).options(joinedload(Employee.department), joinedload(Employee.job_role)).filter(
        or_(Employee.first_name.ilike(like), Employee.last_name.ilike(like), Employee.email.ilike(like),
            Employee.employee_code.ilike(like), (Employee.first_name + " " + Employee.last_name).ilike(like)))
    if scope is not None:
        eq = eq.filter(Employee.id.in_(scope))
    depts = db.query(Department).filter(or_(Department.name.ilike(like), Department.code.ilike(like))).limit(5).all()
    roles = db.query(JobRole).filter(JobRole.title.ilike(like)).limit(5).all()
    dq = db.query(Document).filter(Document.title.ilike(like))
    tq = db.query(Task).filter(Task.title.ilike(like))
    if user.role not in HR_ROLES:
        dq = dq.filter(Document.employee_id == (user.employee_id or -1))
        tq = tq.filter(Task.assignee_id.in_(scope or [-1]))
    return {"employees": [employee_brief(e) for e in eq.limit(8).all()],
            "departments": [{"id": d.id, "name": d.name, "code": d.code} for d in depts],
            "job_roles": [{"id": r.id, "title": r.title} for r in roles],
            "documents": [{"id": d.id, "title": d.title, "employee_id": d.employee_id} for d in dq.limit(5).all()],
            "tasks": [{"id": t.id, "title": t.title, "status": t.status} for t in tq.limit(5).all()]}
