from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import (Attendance, Department, Document, Employee, Goal, JobRole, LeaveRequest, Payroll,
                      PerformanceReview, Prediction, Task, User)
from ..schemas import EmployeeIn, EmployeeUpdate, ProfileUpdate
from ..security import (HR_ROLES, MGMT_ROLES, ensure_can_view_employee, get_current_user, require_roles,
                        visible_employee_ids)
from ..services.events import diff, log_activity, notify_roles
from ..utils import client_ip, employee_brief, employee_dict, iso, paginate

router = APIRouter(prefix="/api/employees", tags=["Employees"])

SORTABLE = {"name": Employee.first_name, "hire_date": Employee.hire_date, "salary": Employee.salary,
            "risk_score": Employee.risk_score, "code": Employee.employee_code, "status": Employee.status}


def _next_code(db: Session) -> str:
    last = db.query(func.max(Employee.id)).scalar() or 0
    code = f"EMP{last + 1:04d}"
    while db.query(Employee.id).filter(Employee.employee_code == code).first():
        last += 1
        code = f"EMP{last + 1:04d}"
    return code


def attendance_rate_subquery(db: Session, days: int = 30):
    since = date.today() - timedelta(days=days)
    return (db.query(Attendance.employee_id.label("eid"),
                     (func.sum(case((Attendance.status.in_(["PRESENT", "LATE", "HALF_DAY"]), 1), else_=0)) * 100.0
                      / func.count(Attendance.id)).label("rate"))
            .filter(Attendance.date >= since).group_by(Attendance.employee_id).subquery())


def search_employees(db: Session, user: User, q=None, department_id=None, status=None, risk_level=None,
                     job_role_id=None, manager_id=None, salary_min=None, salary_max=None, hired_from=None,
                     hired_to=None, attendance_min=None, attendance_max=None, sort_by="name", sort_dir="asc"):
    query = db.query(Employee).options(joinedload(Employee.department), joinedload(Employee.job_role),
                                       joinedload(Employee.manager))
    ids = visible_employee_ids(db, user)
    if ids is not None:
        query = query.filter(Employee.id.in_(ids))
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(Employee.first_name.ilike(like), Employee.last_name.ilike(like),
                                 Employee.email.ilike(like), Employee.employee_code.ilike(like),
                                 (Employee.first_name + " " + Employee.last_name).ilike(like)))
    if department_id:
        query = query.filter(Employee.department_id.in_(department_id))
    if status:
        query = query.filter(Employee.status.in_(status))
    if risk_level:
        query = query.filter(Employee.risk_level.in_(risk_level))
    if job_role_id:
        query = query.filter(Employee.job_role_id == job_role_id)
    if manager_id:
        query = query.filter(Employee.manager_id == manager_id)
    if salary_min is not None:
        query = query.filter(Employee.salary >= salary_min)
    if salary_max is not None:
        query = query.filter(Employee.salary <= salary_max)
    if hired_from:
        query = query.filter(Employee.hire_date >= hired_from)
    if hired_to:
        query = query.filter(Employee.hire_date <= hired_to)
    if attendance_min is not None or attendance_max is not None:
        sub = attendance_rate_subquery(db)
        query = query.join(sub, sub.c.eid == Employee.id)
        if attendance_min is not None:
            query = query.filter(sub.c.rate >= attendance_min)
        if attendance_max is not None:
            query = query.filter(sub.c.rate <= attendance_max)
    col = SORTABLE.get(sort_by, Employee.first_name)
    query = query.order_by(col.desc().nulls_last() if sort_dir == "desc" else col.asc().nulls_last(), Employee.id)
    return query


@router.get("")
def list_employees(
    q: str | None = None,
    department_id: list[int] | None = Query(None),
    status: list[str] | None = Query(None),
    risk_level: list[str] | None = Query(None),
    job_role_id: int | None = None, manager_id: int | None = None,
    salary_min: float | None = None, salary_max: float | None = None,
    hired_from: date | None = None, hired_to: date | None = None,
    attendance_min: float | None = None, attendance_max: float | None = None,
    sort_by: str = "name", sort_dir: str = "asc", page: int = 1, size: int = 20,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    query = search_employees(db, user, q, department_id, status, risk_level, job_role_id, manager_id, salary_min,
                             salary_max, hired_from, hired_to, attendance_min, attendance_max, sort_by, sort_dir)
    sensitive = user.role in MGMT_ROLES
    return paginate(query, page, size, lambda e: employee_dict(e, sensitive))


@router.get("/options")
def employee_options(active_only: bool = True, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Employee).options(joinedload(Employee.department))
    ids = visible_employee_ids(db, user)
    if ids is not None:
        query = query.filter(Employee.id.in_(ids))
    if active_only:
        query = query.filter(Employee.status.in_(["ACTIVE", "ON_LEAVE"]))
    return [{"id": e.id, "label": f"{e.full_name} ({e.employee_code})",
             "department": e.department.name if e.department else None}
            for e in query.order_by(Employee.first_name).all()]


@router.get("/{employee_id}")
def get_employee(employee_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ensure_can_view_employee(db, user, employee_id)
    e = db.get(Employee, employee_id)
    if not e:
        raise HTTPException(404, "Employee not found")
    sensitive = user.role in MGMT_ROLES
    data = employee_dict(e, sensitive)
    if user.employee_id == e.id:
        data["salary"] = e.salary

    since = date.today() - timedelta(days=30)
    att = db.query(Attendance).filter(Attendance.employee_id == e.id, Attendance.date >= since).all()
    present = sum(1 for a in att if a.status in ("PRESENT", "LATE", "HALF_DAY"))
    data["summary"] = {
        "attendance_rate_30d": round(present / len(att) * 100, 1) if att else None,
        "hours_30d": round(sum(a.hours_worked for a in att), 1),
        "overtime_30d": round(sum(a.overtime_hours for a in att), 1),
        "late_days_30d": sum(1 for a in att if a.status == "LATE"),
        "pending_leaves": db.query(LeaveRequest).filter_by(employee_id=e.id, status="PENDING").count(),
        "documents": db.query(Document).filter_by(employee_id=e.id).count(),
        "open_tasks": db.query(Task).filter(Task.assignee_id == e.id, Task.status != "DONE").count(),
        "avg_rating": round(db.query(func.avg(PerformanceReview.rating)).filter_by(employee_id=e.id).scalar() or 0, 2),
        "active_goals": db.query(Goal).filter_by(employee_id=e.id, status="ACTIVE").count(),
        "direct_reports": db.query(Employee).filter_by(manager_id=e.id).count(),
    }
    last_pay = db.query(Payroll).filter_by(employee_id=e.id).order_by(Payroll.period.desc()).first()
    data["summary"]["last_net_pay"] = last_pay.net if last_pay and (sensitive or user.employee_id == e.id) else None
    if sensitive:
        pred = db.query(Prediction).filter_by(employee_id=e.id).order_by(Prediction.created_at.desc()).first()
        data["latest_prediction"] = {"risk_score": pred.risk_score, "risk_level": pred.risk_level,
                                     "confidence": pred.confidence, "top_factors": pred.top_factors,
                                     "created_at": iso(pred.created_at)} if pred else None
    return data


@router.post("", status_code=201)
def create_employee(body: EmployeeIn, request: Request, user: User = Depends(require_roles(*HR_ROLES)),
                    db: Session = Depends(get_db)):
    if db.query(Employee).filter(Employee.email == body.email.lower()).first():
        raise HTTPException(409, "An employee with this email already exists")
    e = Employee(**body.model_dump(), employee_code=_next_code(db))
    e.email = e.email.lower()
    db.add(e)
    db.flush()
    linked = db.query(User).filter(User.email == e.email, User.employee_id.is_(None)).first()
    if linked:
        linked.employee_id = e.id
    db.commit()
    log_activity(db, user, "CREATE", "employee", e.id, f"Added employee {e.full_name} ({e.employee_code})",
                 ip=client_ip(request))
    notify_roles(db, ("ADMIN", "HR"), "New employee onboarded",
                 f"{e.full_name} joined {e.department.name if e.department else 'the company'}.", category="SYSTEM",
                 link=f"/employees/{e.id}")
    return employee_dict(e)


@router.put("/{employee_id}")
@router.patch("/{employee_id}")
def update_employee(employee_id: int, body: EmployeeUpdate, request: Request,
                    user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    e = db.get(Employee, employee_id)
    if not e:
        raise HTTPException(404, "Employee not found")
    data = body.model_dump(exclude_unset=True)
    if "email" in data:
        data["email"] = data["email"].lower()
        clash = db.query(Employee).filter(Employee.email == data["email"], Employee.id != e.id).first()
        if clash:
            raise HTTPException(409, "Email already used by another employee")
    if data.get("manager_id") == e.id:
        raise HTTPException(400, "An employee cannot be their own manager")
    if data.get("status") in ("RESIGNED", "TERMINATED") and not data.get("termination_date") and not e.termination_date:
        data["termination_date"] = date.today()
    changes = diff(e, data)
    for k, v in data.items():
        setattr(e, k, v)
    db.commit()
    if changes:
        log_activity(db, user, "UPDATE", "employee", e.id, f"Updated {e.full_name}", changes, ip=client_ip(request))
    return employee_dict(e)


@router.patch("/me/profile")
def update_my_profile(body: ProfileUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not user.employee_id:
        raise HTTPException(400, "Your account is not linked to an employee record")
    e = db.get(Employee, user.employee_id)
    data = body.model_dump(exclude_unset=True)
    changes = diff(e, data)
    for k, v in data.items():
        setattr(e, k, v)
    db.commit()
    log_activity(db, user, "UPDATE", "employee", e.id, f"{e.full_name} updated own profile", changes)
    return employee_dict(e, include_sensitive=False)


@router.delete("/{employee_id}")
def delete_employee(employee_id: int, request: Request, user: User = Depends(require_roles("ADMIN")),
                    db: Session = Depends(get_db)):
    e = db.get(Employee, employee_id)
    if not e:
        raise HTTPException(404, "Employee not found")
    name, code = e.full_name, e.employee_code
    db.query(Department).filter(Department.head_id == e.id).update({Department.head_id: None})
    db.delete(e)
    db.commit()
    log_activity(db, user, "DELETE", "employee", employee_id, f"Deleted employee {name} ({code})", ip=client_ip(request))
    return {"ok": True}


@router.get("/{employee_id}/team")
def team(employee_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ensure_can_view_employee(db, user, employee_id)
    return [employee_brief(e) for e in db.query(Employee).filter_by(manager_id=employee_id).all()]


@router.get("/{employee_id}/predictions")
def employee_predictions(employee_id: int, user: User = Depends(require_roles(*MGMT_ROLES)),
                         db: Session = Depends(get_db)):
    ensure_can_view_employee(db, user, employee_id)
    rows = db.query(Prediction).filter_by(employee_id=employee_id).order_by(Prediction.created_at).all()
    return [{"risk_score": p.risk_score, "risk_level": p.risk_level, "confidence": p.confidence,
             "model_version": p.model_version, "created_at": iso(p.created_at)} for p in rows]


@router.get("/meta/job-roles")
def job_roles_for_select(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [{"id": r.id, "title": r.title, "department_id": r.department_id, "level": r.level}
            for r in db.query(JobRole).order_by(JobRole.title).all()]
