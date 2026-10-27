from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import BonusEntry, Department, Employee, Payroll, User
from ..schemas import BonusIn, PayrollGenerateIn
from ..security import HR_ROLES, ensure_can_view_employee, get_current_user, require_roles, visible_employee_ids
from ..services.events import log_activity, notify
from ..services.exporters import payslip_pdf
from ..services.payroll_calc import compute_payroll, generate_payroll
from ..utils import client_ip, employee_dict, iso, paginate, payroll_dict

router = APIRouter(prefix="/api/payroll", tags=["Payroll"])


@router.post("/generate")
def generate(body: PayrollGenerateIn, request: Request, user: User = Depends(require_roles(*HR_ROLES)),
             db: Session = Depends(get_db)):
    created, skipped = generate_payroll(db, body.period, body.employee_ids)
    log_activity(db, user, "GENERATE", "payroll", None, f"Generated payroll for {body.period}: {created} payslip(s)",
                 ip=client_ip(request))
    emp_ids = [p.employee_id for p in db.query(Payroll).filter_by(period=body.period).all()]
    recipients = [u.id for u in db.query(User).filter(User.employee_id.in_(emp_ids)).all()]
    notify(db, recipients, "Payslip available", f"Your payslip for {body.period} has been generated.",
           type_="SUCCESS", category="PAYROLL", link="/payroll")
    return {"generated": created, "skipped_paid": skipped, "period": body.period}


@router.get("/preview/{employee_id}")
def preview(employee_id: int, period: str, _: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    emp = db.get(Employee, employee_id)
    if not emp:
        raise HTTPException(404, "Employee not found")
    return {"employee": emp.full_name, "period": period, **compute_payroll(db, emp, period)}


@router.get("")
def list_payroll(period: str | None = None, department_id: int | None = None, employee_id: int | None = None,
                 status: str | None = None, q: str | None = None, net_min: float | None = None,
                 net_max: float | None = None, page: int = 1, size: int = 20,
                 user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Payroll).options(joinedload(Payroll.employee).joinedload(Employee.department)) \
        .join(Employee, Employee.id == Payroll.employee_id)
    if user.role not in HR_ROLES:  # managers and employees only see their own payslips
        query = query.filter(Payroll.employee_id == (user.employee_id or -1))
    if period:
        query = query.filter(Payroll.period == period)
    if department_id:
        query = query.filter(Employee.department_id == department_id)
    if employee_id:
        query = query.filter(Payroll.employee_id == employee_id)
    if status:
        query = query.filter(Payroll.status == status)
    if q:
        like = f"%{q}%"
        query = query.filter((Employee.first_name + " " + Employee.last_name).ilike(like) | Employee.employee_code.ilike(like))
    if net_min is not None:
        query = query.filter(Payroll.net >= net_min)
    if net_max is not None:
        query = query.filter(Payroll.net <= net_max)
    return paginate(query.order_by(Payroll.period.desc(), Employee.first_name), page, size, payroll_dict)


@router.get("/periods")
def periods(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [p for (p,) in db.query(Payroll.period).distinct().order_by(Payroll.period.desc()).all()]


@router.get("/summary")
def summary(period: str | None = None, _: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    period = period or db.query(func.max(Payroll.period)).scalar()
    agg = lambda q: q.with_entities(func.count(), func.sum(Payroll.gross), func.sum(Payroll.net),  # noqa: E731
                                    func.sum(Payroll.tax), func.sum(Payroll.pf), func.sum(Payroll.bonus + Payroll.incentives),
                                    func.sum(Payroll.overtime_pay)).first()
    c, gross, net, tax, pf, bonus, ot = agg(db.query(Payroll).filter(Payroll.period == period))
    by_dept = [{"department": n, "gross": round(g or 0), "net": round(nt or 0), "employees": cnt}
               for n, g, nt, cnt in db.query(Department.name, func.sum(Payroll.gross), func.sum(Payroll.net), func.count())
               .join(Employee, Employee.department_id == Department.id).join(Payroll, Payroll.employee_id == Employee.id)
               .filter(Payroll.period == period).group_by(Department.name).all()]
    trend = [{"period": p, "gross": round(g or 0), "net": round(n or 0), "tax": round(t or 0)}
             for p, g, n, t in db.query(Payroll.period, func.sum(Payroll.gross), func.sum(Payroll.net), func.sum(Payroll.tax))
             .group_by(Payroll.period).order_by(Payroll.period.desc()).limit(12).all()][::-1]
    paid = db.query(Payroll).filter_by(period=period, status="PAID").count()
    return {"period": period, "payslips": c or 0, "paid": paid, "gross": round(gross or 0), "net": round(net or 0),
            "tax": round(tax or 0), "pf": round(pf or 0), "bonus": round(bonus or 0), "overtime": round(ot or 0),
            "by_department": by_dept, "trend": trend}


@router.get("/bonuses")
def list_bonuses(period: str | None = None, _: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    q = db.query(BonusEntry).options(joinedload(BonusEntry.employee))
    if period:
        q = q.filter(BonusEntry.period == period)
    return [{"id": b.id, "employee_id": b.employee_id, "employee": b.employee.full_name, "period": b.period,
             "kind": b.kind, "amount": b.amount, "reason": b.reason, "created_at": iso(b.created_at)}
            for b in q.order_by(BonusEntry.created_at.desc()).limit(300).all()]


@router.post("/bonuses", status_code=201)
def add_bonus(body: BonusIn, user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    emp = db.get(Employee, body.employee_id)
    if not emp:
        raise HTTPException(404, "Employee not found")
    b = BonusEntry(**body.model_dump())
    db.add(b)
    db.commit()
    log_activity(db, user, "CREATE", "bonus", b.id, f"Added {b.kind.lower()} of {b.amount:,.0f} for {emp.full_name} ({b.period})")
    return {"id": b.id}


@router.delete("/bonuses/{bonus_id}")
def delete_bonus(bonus_id: int, user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    b = db.get(BonusEntry, bonus_id)
    if not b:
        raise HTTPException(404, "Not found")
    db.delete(b)
    db.commit()
    log_activity(db, user, "DELETE", "bonus", bonus_id, "Removed bonus entry")
    return {"ok": True}


@router.post("/mark-paid")
def mark_period_paid(period: str, user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    n = db.query(Payroll).filter_by(period=period, status="GENERATED").update({Payroll.status: "PAID"})
    db.commit()
    log_activity(db, user, "UPDATE", "payroll", None, f"Marked {n} payslip(s) for {period} as paid")
    return {"updated": n}


@router.get("/{payroll_id}")
def get_payslip(payroll_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Payroll, payroll_id)
    if not p:
        raise HTTPException(404, "Payslip not found")
    if user.role not in HR_ROLES and p.employee_id != user.employee_id:
        raise HTTPException(403, "Not allowed")
    return {**payroll_dict(p), "employee_detail": employee_dict(p.employee, include_sensitive=False)}


@router.get("/{payroll_id}/pdf")
def payslip_download(payroll_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = db.get(Payroll, payroll_id)
    if not p:
        raise HTTPException(404, "Payslip not found")
    if user.role not in HR_ROLES and p.employee_id != user.employee_id:
        raise HTTPException(403, "Not allowed")
    pdf = payslip_pdf(payroll_dict(p), employee_dict(p.employee, include_sensitive=False))
    fname = f"payslip_{p.employee.employee_code}_{p.period}.pdf"
    return Response(pdf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"'})
