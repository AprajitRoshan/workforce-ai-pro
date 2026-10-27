from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import ActivityLog, Employee, Goal, Payroll, PerformanceReview, Task, User
from ..schemas import GoalIn, GoalUpdate, ReviewIn, TaskIn, TaskUpdate
from ..security import HR_ROLES, MGMT_ROLES, ensure_can_view_employee, get_current_user, require_roles, visible_employee_ids
from ..services.exporters import table_pdf, table_xlsx
from ..services.events import diff, log_activity, notify
from ..utils import activity_dict, client_ip, goal_dict, iso, paginate, payroll_dict, review_dict, task_dict
from .analytics import attrition_analytics
from .attendance import attendance_report
from .employees import search_employees

router = APIRouter(prefix="/api", tags=["Enterprise"])

# ================================================================ reports & export (Module 19)
REPORTS = {
    "employees": [("employee_code", "Code"), ("full_name", "Name"), ("department", "Department"), ("job_title", "Title"),
                  ("status", "Status"), ("hire_date", "Hired"), ("tenure_years", "Tenure (y)"), ("salary", "Monthly CTC"),
                  ("risk_level", "Risk")],
    "attendance": [("employee_code", "Code"), ("employee", "Name"), ("department", "Department"), ("present", "Present"),
                   ("late", "Late"), ("absent", "Absent"), ("half_day", "Half"), ("on_leave", "Leave"),
                   ("total_hours", "Hours"), ("overtime_hours", "OT Hours"), ("attendance_rate", "Rate %")],
    "payroll": [("employee_code", "Code"), ("employee", "Name"), ("department", "Department"), ("period", "Period"),
                ("gross", "Gross"), ("tax", "Tax"), ("pf", "PF"), ("total_deductions", "Deductions"), ("net", "Net"),
                ("status", "Status")],
    "attrition": [("employee_code", "Code"), ("full_name", "Name"), ("department", "Department"),
                  ("job_title", "Title"), ("risk_score", "Risk %"), ("risk_level", "Level"), ("tenure", "Tenure (y)"),
                  ("termination_date", "Left on"), ("reason", "Exit reason")],
}


def _report_rows(kind: str, db: Session, user: User, period: str | None, department_id: int | None,
                 date_from: date | None, date_to: date | None):
    from ..utils import employee_dict
    if kind == "employees":
        q = search_employees(db, user, department_id=[department_id] if department_id else None)
        return [employee_dict(e) for e in q.all()], ""
    if kind == "attendance":
        rep = attendance_report(date_from, date_to, department_id, user, db)
        return rep["rows"], f"Period {rep['from']} to {rep['to']}."
    if kind == "payroll":
        if user.role not in HR_ROLES:
            raise HTTPException(403, "Payroll reports require HR access")
        period = period or db.query(func.max(Payroll.period)).scalar()
        q = db.query(Payroll).options(joinedload(Payroll.employee).joinedload(Employee.department)).filter(Payroll.period == period)
        if department_id:
            q = q.join(Employee, Employee.id == Payroll.employee_id).filter(Employee.department_id == department_id)
        return [payroll_dict(p) for p in q.all()], f"Period {period}."
    if kind == "attrition":
        data = attrition_analytics(24, department_id, user, db)
        at_risk = [e for e in search_employees(db, user, risk_level=["HIGH", "CRITICAL"], status=["ACTIVE"],
                                               department_id=[department_id] if department_id else None,
                                               sort_by="risk_score", sort_dir="desc").all()]
        rows = [{"employee_code": e.employee_code, "full_name": e.full_name,
                 "department": e.department.name if e.department else None, "job_title": e.job_role.title if e.job_role else None,
                 "risk_score": e.risk_score, "risk_level": e.risk_level,
                 "tenure": round((date.today() - e.hire_date).days / 365.25, 1)} for e in at_risk]
        rows += [{**r, "risk_score": None, "risk_level": "LEFT", "termination_date": r["termination_date"]}
                 for r in data["recent_leavers"]]
        s = data["summary"]
        return rows, f"12-month attrition {s['attrition_rate_12m']}% ({s['exits_12m']} exits). At-risk: {s['at_risk']}."
    raise HTTPException(404, "Unknown report")


@router.get("/reports/{kind}")
def export_report(kind: str, request: Request, format: str = "json", period: str | None = None,
                  department_id: int | None = None, date_from: date | None = None, date_to: date | None = None,
                  user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    if kind not in REPORTS:
        raise HTTPException(404, "Unknown report")
    rows, subtitle = _report_rows(kind, db, user, period, department_id, date_from, date_to)
    cols = REPORTS[kind]
    title = f"{kind.title()} Report"
    if format == "json":
        return {"title": title, "subtitle": subtitle, "columns": [{"key": k, "label": l} for k, l in cols], "rows": rows}
    log_activity(db, user, "EXPORT", "report", None, f"Exported {kind} report as {format.upper()}", ip=client_ip(request))
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    if format == "pdf":
        return Response(table_pdf(title, cols, rows, subtitle), media_type="application/pdf",
                        headers={"Content-Disposition": f'attachment; filename="{kind}_report_{stamp}.pdf"'})
    if format == "xlsx":
        return Response(table_xlsx(title, cols, rows),
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        headers={"Content-Disposition": f'attachment; filename="{kind}_report_{stamp}.xlsx"'})
    raise HTTPException(400, "format must be json, pdf or xlsx")


# ================================================================ audit (Module 20)
@router.get("/audit")
def audit_logs(user_id: int | None = None, action: str | None = None, entity_type: str | None = None,
               q: str | None = None, date_from: date | None = None, date_to: date | None = None,
               page: int = 1, size: int = 30, _: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    query = db.query(ActivityLog).options(joinedload(ActivityLog.user))
    if user_id:
        query = query.filter(ActivityLog.user_id == user_id)
    if action:
        query = query.filter(ActivityLog.action == action)
    if entity_type:
        query = query.filter(ActivityLog.entity_type == entity_type)
    if q:
        query = query.filter(ActivityLog.summary.ilike(f"%{q}%"))
    if date_from:
        query = query.filter(ActivityLog.created_at >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        query = query.filter(ActivityLog.created_at < datetime.combine(date_to + timedelta(days=1), datetime.min.time()))
    return paginate(query.order_by(ActivityLog.id.desc()), page, size, activity_dict)


@router.get("/audit/stats")
def audit_stats(days: int = 14, _: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    since = datetime.now() - timedelta(days=days)
    base = db.query(ActivityLog).filter(ActivityLog.created_at >= since)
    by_action = dict(base.with_entities(ActivityLog.action, func.count()).group_by(ActivityLog.action).all())
    by_entity = dict(base.with_entities(ActivityLog.entity_type, func.count()).group_by(ActivityLog.entity_type).all())
    daily = [{"date": str(d), "events": c} for d, c in base.with_entities(func.date(ActivityLog.created_at), func.count())
             .group_by(func.date(ActivityLog.created_at)).order_by(func.date(ActivityLog.created_at)).all()]
    top = [{"user": n, "events": c} for n, c in base.join(User, User.id == ActivityLog.user_id)
           .with_entities(User.full_name, func.count()).group_by(User.full_name).order_by(func.count().desc()).limit(8).all()]
    return {"by_action": by_action, "by_entity": by_entity, "daily": daily, "top_users": top,
            "failed_logins": by_action.get("LOGIN_FAILED", 0), "changes": sum(by_action.get(a, 0) for a in ("CREATE", "UPDATE", "DELETE"))}


@router.get("/audit/entity/{entity_type}/{entity_id}")
def entity_history(entity_type: str, entity_id: int, _: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    rows = db.query(ActivityLog).options(joinedload(ActivityLog.user)).filter_by(entity_type=entity_type, entity_id=entity_id) \
        .order_by(ActivityLog.id.desc()).limit(200).all()
    return [activity_dict(a) for a in rows]


# ================================================================ tasks & workflows (Module 21)
WORKFLOW_TEMPLATES = {
    "ONBOARDING": [("Prepare laptop & accounts", 0), ("Share employee handbook", 1), ("Assign onboarding buddy", 1),
                   ("Complete compliance training", 7), ("30-day check-in with manager", 30)],
    "OFFBOARDING": [("Collect company assets", 0), ("Revoke system access", 0), ("Knowledge transfer session", 3),
                    ("Exit interview", 5), ("Final settlement", 10)],
    "REVIEW": [("Self-assessment", 7), ("Manager assessment", 14), ("Calibration meeting", 21), ("Share review outcome", 28)],
    "RETENTION": [("Stay interview", 3), ("Compensation benchmark", 7), ("Career development plan", 14), ("Follow-up check-in", 30)],
}


def _task_scope(db: Session, user: User, q):
    ids = visible_employee_ids(db, user)
    return q.filter(Task.assignee_id.in_(ids)) if ids is not None else q


@router.get("/tasks")
def list_tasks(status: list[str] | None = Query(None), assignee_id: int | None = None, workflow: str | None = None,
               priority: str | None = None, overdue: bool = False, mine: bool = False, q: str | None = None,
               page: int = 1, size: int = 50, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = _task_scope(db, user, db.query(Task).options(joinedload(Task.assignee)))
    if mine:
        query = query.filter(Task.assignee_id == (user.employee_id or -1))
    if status:
        query = query.filter(Task.status.in_(status))
    if assignee_id:
        query = query.filter(Task.assignee_id == assignee_id)
    if workflow:
        query = query.filter(Task.workflow == workflow)
    if priority:
        query = query.filter(Task.priority == priority)
    if overdue:
        query = query.filter(Task.status != "DONE", Task.due_date < date.today())
    if q:
        query = query.filter(Task.title.ilike(f"%{q}%"))
    return paginate(query.order_by(Task.due_date.is_(None), Task.due_date, Task.id.desc()), page, size, task_dict)


@router.get("/tasks/stats")
def task_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    base = _task_scope(db, user, db.query(Task))
    today = date.today()
    return {"by_status": dict(base.with_entities(Task.status, func.count()).group_by(Task.status).all()),
            "by_workflow": dict(base.with_entities(Task.workflow, func.count()).group_by(Task.workflow).all()),
            "overdue": base.filter(Task.status != "DONE", Task.due_date < today).count(),
            "due_this_week": base.filter(Task.status != "DONE", Task.due_date.between(today, today + timedelta(days=7))).count()}


@router.post("/tasks", status_code=201)
def create_task(body: TaskIn, user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    ensure_can_view_employee(db, user, body.assignee_id)
    t = Task(**body.model_dump(), assigned_by=user.id)
    db.add(t)
    db.commit()
    log_activity(db, user, "CREATE", "task", t.id, f"Assigned task '{t.title}' to {t.assignee.full_name}")
    owner = db.query(User).filter_by(employee_id=t.assignee_id).first()
    if owner:
        notify(db, [owner.id], "New task assigned", f"{user.full_name} assigned you: {t.title}"
               + (f" (due {t.due_date})" if t.due_date else ""), category="TASK", priority=t.priority if t.priority != "CRITICAL" else "HIGH",
               link="/tasks")
    return task_dict(t)


@router.post("/tasks/workflow")
def start_workflow(employee_id: int, workflow: str, owner_employee_id: int | None = None,
                   user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    if workflow not in WORKFLOW_TEMPLATES:
        raise HTTPException(400, f"workflow must be one of {', '.join(WORKFLOW_TEMPLATES)}")
    e = db.get(Employee, employee_id)
    if not e:
        raise HTTPException(404, "Employee not found")
    assignee = owner_employee_id or e.manager_id or e.id
    for title, offset in WORKFLOW_TEMPLATES[workflow]:
        db.add(Task(title=f"{title} — {e.full_name}", workflow=workflow, assignee_id=assignee, assigned_by=user.id,
                    due_date=date.today() + timedelta(days=offset), priority="MEDIUM",
                    description=f"{workflow.title()} workflow step for {e.full_name}"))
    db.commit()
    log_activity(db, user, "WORKFLOW", "task", None, f"Started {workflow.lower()} workflow for {e.full_name}")
    return {"created": len(WORKFLOW_TEMPLATES[workflow])}


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, body: TaskUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    data = body.model_dump(exclude_unset=True)
    if user.role == "EMPLOYEE":
        if t.assignee_id != user.employee_id:
            raise HTTPException(403, "Not your task")
        data = {k: v for k, v in data.items() if k == "status"}  # employees may only move their own task's status
    else:
        ensure_can_view_employee(db, user, t.assignee_id)
    if data.get("status") == "DONE" and t.status != "DONE":
        t.completed_at = datetime.now()
    elif data.get("status") and data["status"] != "DONE":
        t.completed_at = None
    changes = diff(t, data)
    for k, v in data.items():
        setattr(t, k, v)
    db.commit()
    if changes:
        log_activity(db, user, "UPDATE", "task", t.id, f"Updated task '{t.title}'", changes)
        if "status" in changes and t.assigned_by and t.assigned_by != user.id:
            notify(db, [t.assigned_by], "Task status changed", f"'{t.title}' is now {t.status.replace('_', ' ').lower()}.",
                   category="TASK", link="/tasks")
    return task_dict(t)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: int, user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    t = db.get(Task, task_id)
    if not t:
        raise HTTPException(404, "Task not found")
    db.delete(t)
    db.commit()
    log_activity(db, user, "DELETE", "task", task_id, f"Deleted task '{t.title}'")
    return {"ok": True}


# ================================================================ performance (Module 22)
@router.get("/reviews")
def list_reviews(employee_id: int | None = None, period: str | None = None, page: int = 1, size: int = 20,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(PerformanceReview).options(joinedload(PerformanceReview.employee), joinedload(PerformanceReview.reviewer))
    ids = visible_employee_ids(db, user)
    if ids is not None:
        q = q.filter(PerformanceReview.employee_id.in_(ids))
    if employee_id:
        q = q.filter(PerformanceReview.employee_id == employee_id)
    if period:
        q = q.filter(PerformanceReview.period == period)
    return paginate(q.order_by(PerformanceReview.created_at.desc()), page, size, review_dict)


@router.get("/reviews/stats")
def review_stats(user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    from ..models import Department
    dist = {int(r): c for r, c in db.query(func.round(PerformanceReview.rating), func.count())
            .group_by(func.round(PerformanceReview.rating)).all()}
    by_dept = [{"department": n, "avg_rating": round(a, 2), "reviews": c}
               for n, a, c in db.query(Department.name, func.avg(PerformanceReview.rating), func.count())
               .join(Employee, Employee.department_id == Department.id)
               .join(PerformanceReview, PerformanceReview.employee_id == Employee.id).group_by(Department.name).all()]
    by_period = [{"period": p, "avg_rating": round(a, 2), "reviews": c}
                 for p, a, c in db.query(PerformanceReview.period, func.avg(PerformanceReview.rating), func.count())
                 .group_by(PerformanceReview.period).order_by(PerformanceReview.period).all()]
    goals = dict(db.query(Goal.status, func.count()).group_by(Goal.status).all())
    return {"distribution": [{"rating": r, "count": dist.get(r, 0)} for r in range(1, 6)], "by_department": by_dept,
            "by_period": by_period, "goals": goals,
            "avg_goal_progress": round(db.query(func.avg(Goal.progress)).filter(Goal.status == "ACTIVE").scalar() or 0, 1)}


@router.post("/reviews", status_code=201)
def create_review(body: ReviewIn, user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    ensure_can_view_employee(db, user, body.employee_id)
    if body.employee_id == user.employee_id:
        raise HTTPException(403, "You cannot review yourself")
    r = PerformanceReview(**body.model_dump(), reviewer_id=user.id)
    db.add(r)
    db.commit()
    log_activity(db, user, "CREATE", "review", r.id, f"Reviewed {r.employee.full_name} for {r.period}: {r.rating}/5")
    owner = db.query(User).filter_by(employee_id=r.employee_id).first()
    if owner:
        notify(db, [owner.id], "Performance review published", f"Your {r.period} review is available.",
               type_="SUCCESS", category="SYSTEM", link="/performance")
    return review_dict(r)


@router.get("/goals")
def list_goals(employee_id: int | None = None, status: str | None = None, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    eid = employee_id or user.employee_id
    if not eid:
        return []
    ensure_can_view_employee(db, user, eid)
    q = db.query(Goal).filter_by(employee_id=eid)
    if status:
        q = q.filter(Goal.status == status)
    return [goal_dict(g) for g in q.order_by(Goal.created_at.desc()).all()]


@router.post("/goals", status_code=201)
def create_goal(body: GoalIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role == "EMPLOYEE" and body.employee_id != user.employee_id:
        raise HTTPException(403, "You can only set your own goals")
    ensure_can_view_employee(db, user, body.employee_id)
    g = Goal(**body.model_dump())
    db.add(g)
    db.commit()
    log_activity(db, user, "CREATE", "goal", g.id, f"Created goal '{g.title}'")
    return goal_dict(g)


@router.patch("/goals/{goal_id}")
def update_goal(goal_id: int, body: GoalUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    g = db.get(Goal, goal_id)
    if not g:
        raise HTTPException(404, "Goal not found")
    ensure_can_view_employee(db, user, g.employee_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("progress") == 100 and "status" not in data:
        data["status"] = "ACHIEVED"
    changes = diff(g, data)
    for k, v in data.items():
        setattr(g, k, v)
    db.commit()
    log_activity(db, user, "UPDATE", "goal", g.id, f"Updated goal '{g.title}'", changes)
    return goal_dict(g)
