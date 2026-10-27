import math
from datetime import date, datetime

from fastapi import Request

from . import models as m


def iso(v):
    return v.isoformat() if isinstance(v, (date, datetime)) else v


def paginate(query, page: int = 1, size: int = 20, serializer=None):
    page, size = max(1, page), max(1, min(size, 500))
    total = query.order_by(None).count()
    rows = query.offset((page - 1) * size).limit(size).all()
    return {"items": [serializer(r) if serializer else r for r in rows], "total": total, "page": page,
            "size": size, "pages": max(1, math.ceil(total / size))}


def client_ip(request: Request) -> str | None:
    return request.client.host if request and request.client else None


def user_dict(u: m.User) -> dict:
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role, "is_active": u.is_active,
            "employee_id": u.employee_id, "last_login": iso(u.last_login), "created_at": iso(u.created_at)}


def employee_brief(e: m.Employee | None) -> dict | None:
    if e is None:
        return None
    return {"id": e.id, "employee_code": e.employee_code, "full_name": e.full_name, "email": e.email,
            "department": e.department.name if e.department else None,
            "job_title": e.job_role.title if e.job_role else None, "status": e.status,
            "risk_score": e.risk_score, "risk_level": e.risk_level}


def employee_dict(e: m.Employee, include_sensitive: bool = True) -> dict:
    d = {
        "id": e.id, "employee_code": e.employee_code, "first_name": e.first_name, "last_name": e.last_name,
        "full_name": e.full_name, "email": e.email, "phone": e.phone, "gender": e.gender,
        "date_of_birth": iso(e.date_of_birth), "marital_status": e.marital_status, "education": e.education,
        "address": e.address, "hire_date": iso(e.hire_date), "termination_date": iso(e.termination_date),
        "termination_reason": e.termination_reason, "status": e.status,
        "department_id": e.department_id, "department": e.department.name if e.department else None,
        "job_role_id": e.job_role_id, "job_title": e.job_role.title if e.job_role else None,
        "job_level": e.job_role.level if e.job_role else None,
        "manager_id": e.manager_id, "manager": e.manager.full_name if e.manager else None,
        "tenure_years": round(((e.termination_date or date.today()) - e.hire_date).days / 365.25, 1),
        "created_at": iso(e.created_at), "updated_at": iso(e.updated_at),
    }
    if include_sensitive:
        d.update({
            "salary": e.salary, "job_satisfaction": e.job_satisfaction,
            "environment_satisfaction": e.environment_satisfaction, "work_life_balance": e.work_life_balance,
            "job_involvement": e.job_involvement, "distance_from_home": e.distance_from_home,
            "num_companies_worked": e.num_companies_worked,
            "years_since_last_promotion": e.years_since_last_promotion,
            "training_times_last_year": e.training_times_last_year, "stock_option_level": e.stock_option_level,
            "risk_score": e.risk_score, "risk_level": e.risk_level,
        })
    return d


def department_dict(d: m.Department) -> dict:
    return {"id": d.id, "name": d.name, "code": d.code, "description": d.description, "head_id": d.head_id,
            "head": d.head.full_name if d.head else None, "budget": d.budget, "created_at": iso(d.created_at)}


def job_role_dict(r: m.JobRole) -> dict:
    return {"id": r.id, "title": r.title, "department_id": r.department_id,
            "department": r.department.name if r.department else None, "level": r.level,
            "min_salary": r.min_salary, "max_salary": r.max_salary}


def attendance_dict(a: m.Attendance) -> dict:
    return {"id": a.id, "employee_id": a.employee_id, "employee": a.employee.full_name if a.employee else None,
            "date": iso(a.date), "check_in": iso(a.check_in), "check_out": iso(a.check_out),
            "hours_worked": a.hours_worked, "overtime_hours": a.overtime_hours, "status": a.status}


def leave_dict(l: m.LeaveRequest) -> dict:
    return {"id": l.id, "employee_id": l.employee_id, "employee": l.employee.full_name if l.employee else None,
            "department": l.employee.department.name if l.employee and l.employee.department else None,
            "leave_type": l.leave_type, "start_date": iso(l.start_date), "end_date": iso(l.end_date),
            "days": l.days, "reason": l.reason, "status": l.status,
            "approver": l.approver.full_name if l.approver else None, "approver_comment": l.approver_comment,
            "decided_at": iso(l.decided_at), "created_at": iso(l.created_at)}


def payroll_dict(p: m.Payroll) -> dict:
    return {"id": p.id, "employee_id": p.employee_id, "employee": p.employee.full_name if p.employee else None,
            "employee_code": p.employee.employee_code if p.employee else None,
            "department": p.employee.department.name if p.employee and p.employee.department else None,
            "period": p.period, "basic": p.basic, "hra": p.hra, "allowances": p.allowances,
            "overtime_pay": p.overtime_pay, "bonus": p.bonus, "incentives": p.incentives, "gross": p.gross,
            "tax": p.tax, "pf": p.pf, "unpaid_leave_deduction": p.unpaid_leave_deduction,
            "total_deductions": p.total_deductions, "net": p.net, "status": p.status,
            "generated_at": iso(p.generated_at)}


def document_dict(d: m.Document) -> dict:
    return {"id": d.id, "employee_id": d.employee_id, "employee": d.employee.full_name if d.employee else None,
            "doc_type": d.doc_type, "title": d.title, "original_name": d.original_name,
            "content_type": d.content_type, "size": d.size, "created_at": iso(d.created_at)}


def prediction_dict(p: m.Prediction) -> dict:
    return {"id": p.id, "employee_id": p.employee_id, "employee": employee_brief(p.employee),
            "model_version": p.model_version, "risk_score": p.risk_score, "risk_level": p.risk_level,
            "confidence": p.confidence, "top_factors": p.top_factors, "created_at": iso(p.created_at)}


def intervention_dict(i: m.Intervention) -> dict:
    return {"id": i.id, "employee_id": i.employee_id, "employee": employee_brief(i.employee),
            "action_type": i.action_type, "recommendation": i.recommendation, "notes": i.notes,
            "status": i.status, "follow_up_date": iso(i.follow_up_date), "outcome": i.outcome,
            "owner_id": i.owner_id, "owner": i.owner.full_name if i.owner else None,
            "risk_at_creation": i.risk_at_creation, "created_at": iso(i.created_at), "updated_at": iso(i.updated_at)}


def task_dict(t: m.Task) -> dict:
    overdue = bool(t.due_date and t.status != "DONE" and t.due_date < date.today())
    return {"id": t.id, "title": t.title, "description": t.description, "workflow": t.workflow,
            "assignee_id": t.assignee_id, "assignee": t.assignee.full_name if t.assignee else None,
            "status": t.status, "priority": t.priority, "due_date": iso(t.due_date), "overdue": overdue,
            "completed_at": iso(t.completed_at), "created_at": iso(t.created_at)}


def review_dict(r: m.PerformanceReview) -> dict:
    return {"id": r.id, "employee_id": r.employee_id, "employee": r.employee.full_name if r.employee else None,
            "reviewer": r.reviewer.full_name if r.reviewer else None, "period": r.period, "rating": r.rating,
            "quality": r.quality, "productivity": r.productivity, "teamwork": r.teamwork,
            "strengths": r.strengths, "improvements": r.improvements, "comments": r.comments,
            "created_at": iso(r.created_at)}


def goal_dict(g: m.Goal) -> dict:
    return {"id": g.id, "employee_id": g.employee_id, "title": g.title, "description": g.description,
            "target_date": iso(g.target_date), "progress": g.progress, "status": g.status,
            "created_at": iso(g.created_at)}


def activity_dict(a: m.ActivityLog) -> dict:
    return {"id": a.id, "user_id": a.user_id, "user": a.user.full_name if a.user else "System",
            "role": a.user.role if a.user else None, "action": a.action, "entity_type": a.entity_type,
            "entity_id": a.entity_id, "summary": a.summary, "changes": a.changes, "ip_address": a.ip_address,
            "created_at": iso(a.created_at)}
