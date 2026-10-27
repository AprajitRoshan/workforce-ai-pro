from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Attendance, Department, Employee, JobRole, User
from ..schemas import AssignRoleIn, DepartmentIn, JobRoleIn
from ..security import HR_ROLES, get_current_user, require_roles
from ..services.events import diff, log_activity
from ..utils import client_ip, department_dict, job_role_dict

router = APIRouter(prefix="/api/departments", tags=["Departments & Roles"])
roles_router = APIRouter(prefix="/api/job-roles", tags=["Departments & Roles"])


def department_stats(db: Session) -> list[dict]:
    year_ago = date.today() - timedelta(days=365)
    month_ago = date.today() - timedelta(days=30)
    out = []
    for d in db.query(Department).order_by(Department.name).all():
        emps = db.query(Employee).filter(Employee.department_id == d.id)
        active = emps.filter(Employee.status.in_(["ACTIVE", "ON_LEAVE"]))
        headcount = active.count()
        left = emps.filter(Employee.termination_date >= year_ago).count()
        avg_salary = active.with_entities(func.avg(Employee.salary)).scalar() or 0
        payroll = active.with_entities(func.sum(Employee.salary)).scalar() or 0
        avg_risk = active.with_entities(func.avg(Employee.risk_score)).scalar()
        high_risk = active.filter(Employee.risk_level.in_(["HIGH", "CRITICAL"])).count()
        att = db.query(Attendance.status, func.count()).join(Employee, Employee.id == Attendance.employee_id) \
            .filter(Employee.department_id == d.id, Attendance.date >= month_ago).group_by(Attendance.status).all()
        att_total = sum(c for _, c in att)
        att_present = sum(c for s, c in att if s in ("PRESENT", "LATE", "HALF_DAY"))
        avg_headcount = headcount + left / 2 or 1
        out.append({
            **department_dict(d), "headcount": headcount, "left_last_12m": left,
            "attrition_rate": round(left / avg_headcount * 100, 1), "avg_salary": round(avg_salary),
            "monthly_payroll": round(payroll), "avg_risk": round(avg_risk, 1) if avg_risk is not None else None,
            "high_risk": high_risk, "attendance_rate": round(att_present / att_total * 100, 1) if att_total else None,
            "budget_utilisation": round(payroll * 12 / d.budget * 100, 1) if d.budget else None,
        })
    return out


@router.get("")
def list_departments(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    counts = dict(db.query(Employee.department_id, func.count()).filter(Employee.status.in_(["ACTIVE", "ON_LEAVE"]))
                  .group_by(Employee.department_id).all())
    return [{**department_dict(d), "headcount": counts.get(d.id, 0)}
            for d in db.query(Department).order_by(Department.name).all()]


@router.get("/stats")
def stats(_: User = Depends(require_roles("ADMIN", "HR", "MANAGER")), db: Session = Depends(get_db)):
    return department_stats(db)


@router.get("/{dept_id}")
def get_department(dept_id: int, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    d = db.get(Department, dept_id)
    if not d:
        raise HTTPException(404, "Department not found")
    stat = next((s for s in department_stats(db) if s["id"] == dept_id), {})
    members = db.query(Employee).filter(Employee.department_id == dept_id, Employee.status.in_(["ACTIVE", "ON_LEAVE"])) \
        .order_by(Employee.first_name).all()
    return {**stat, "roles": [job_role_dict(r) for r in db.query(JobRole).filter_by(department_id=dept_id).all()],
            "members": [{"id": e.id, "full_name": e.full_name, "job_title": e.job_role.title if e.job_role else None,
                         "risk_level": e.risk_level} for e in members]}


@router.post("", status_code=201)
def create_department(body: DepartmentIn, request: Request, user: User = Depends(require_roles(*HR_ROLES)),
                      db: Session = Depends(get_db)):
    if db.query(Department).filter((Department.name == body.name) | (Department.code == body.code.upper())).first():
        raise HTTPException(409, "Department name or code already exists")
    d = Department(**body.model_dump())
    d.code = d.code.upper()
    db.add(d)
    db.commit()
    log_activity(db, user, "CREATE", "department", d.id, f"Created department {d.name}", ip=client_ip(request))
    return department_dict(d)


@router.put("/{dept_id}")
def update_department(dept_id: int, body: DepartmentIn, request: Request,
                      user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    d = db.get(Department, dept_id)
    if not d:
        raise HTTPException(404, "Department not found")
    data = body.model_dump()
    data["code"] = data["code"].upper()
    changes = diff(d, data)
    for k, v in data.items():
        setattr(d, k, v)
    db.commit()
    log_activity(db, user, "UPDATE", "department", d.id, f"Updated department {d.name}", changes, ip=client_ip(request))
    return department_dict(d)


@router.delete("/{dept_id}")
def delete_department(dept_id: int, request: Request, user: User = Depends(require_roles("ADMIN")),
                      db: Session = Depends(get_db)):
    d = db.get(Department, dept_id)
    if not d:
        raise HTTPException(404, "Department not found")
    if db.query(Employee).filter(Employee.department_id == dept_id, Employee.status == "ACTIVE").count():
        raise HTTPException(400, "Reassign active employees before deleting this department")
    name = d.name
    db.delete(d)
    db.commit()
    log_activity(db, user, "DELETE", "department", dept_id, f"Deleted department {name}", ip=client_ip(request))
    return {"ok": True}


@router.post("/assign")
def assign(body: AssignRoleIn, request: Request, user: User = Depends(require_roles(*HR_ROLES)),
           db: Session = Depends(get_db)):
    """Bulk employee → department / job-role mapping."""
    updated = 0
    for e in db.query(Employee).filter(Employee.id.in_(body.employee_ids)).all():
        data = {}
        if body.department_id is not None:
            data["department_id"] = body.department_id
        if body.job_role_id is not None:
            data["job_role_id"] = body.job_role_id
        changes = diff(e, data)
        for k, v in data.items():
            setattr(e, k, v)
        if changes:
            updated += 1
            log_activity(db, user, "ASSIGN", "employee", e.id, f"Reassigned {e.full_name}", changes,
                         ip=client_ip(request), commit=False)
    db.commit()
    return {"updated": updated}


# ---------------------------------------------------------------- job roles
@roles_router.get("")
def list_roles(department_id: int | None = None, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = db.query(JobRole)
    if department_id:
        q = q.filter(JobRole.department_id == department_id)
    counts = dict(db.query(Employee.job_role_id, func.count()).group_by(Employee.job_role_id).all())
    return [{**job_role_dict(r), "employees": counts.get(r.id, 0)} for r in q.order_by(JobRole.level, JobRole.title).all()]


@roles_router.post("", status_code=201)
def create_role(body: JobRoleIn, user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    r = JobRole(**body.model_dump())
    db.add(r)
    db.commit()
    log_activity(db, user, "CREATE", "job_role", r.id, f"Created job role {r.title}")
    return job_role_dict(r)


@roles_router.put("/{role_id}")
def update_role(role_id: int, body: JobRoleIn, user: User = Depends(require_roles(*HR_ROLES)),
                db: Session = Depends(get_db)):
    r = db.get(JobRole, role_id)
    if not r:
        raise HTTPException(404, "Job role not found")
    changes = diff(r, body.model_dump())
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    db.commit()
    log_activity(db, user, "UPDATE", "job_role", r.id, f"Updated job role {r.title}", changes)
    return job_role_dict(r)


@roles_router.delete("/{role_id}")
def delete_role(role_id: int, user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    r = db.get(JobRole, role_id)
    if not r:
        raise HTTPException(404, "Job role not found")
    db.delete(r)
    db.commit()
    log_activity(db, user, "DELETE", "job_role", role_id, f"Deleted job role {r.title}")
    return {"ok": True}
