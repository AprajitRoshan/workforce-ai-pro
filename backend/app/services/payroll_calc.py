from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Attendance, BonusEntry, Employee, LeaveRequest, Payroll

WORKING_DAYS = 22


def period_bounds(period: str) -> tuple[date, date]:
    y, m = map(int, period.split("-"))
    start = date(y, m, 1)
    end = date(y + (m == 12), (m % 12) + 1, 1)
    return start, end


def annual_tax(annual_income: float) -> float:
    tax, lower = 0.0, 0.0
    for upper, rate in settings.TAX_SLABS:
        if annual_income > lower:
            tax += (min(annual_income, upper) - lower) * rate
        lower = upper
    return tax * 1.04  # 4% health & education cess


def compute_payroll(db: Session, emp: Employee, period: str) -> dict:
    start, end = period_bounds(period)
    ctc = emp.salary or 0
    basic, hra, allowances = round(ctc * 0.5, 2), round(ctc * 0.2, 2), round(ctc * 0.3, 2)

    ot_hours = db.query(func.coalesce(func.sum(Attendance.overtime_hours), 0)).filter(
        Attendance.employee_id == emp.id, Attendance.date >= start, Attendance.date < end).scalar()
    hourly = basic / (WORKING_DAYS * settings.STANDARD_HOURS)
    overtime_pay = round(min(ot_hours, 60) * hourly * 1.5, 2)  # capped at 60 OT hours / month

    extras = dict(db.query(BonusEntry.kind, func.sum(BonusEntry.amount)).filter(
        BonusEntry.employee_id == emp.id, BonusEntry.period == period).group_by(BonusEntry.kind).all())
    bonus, incentives = round(extras.get("BONUS", 0), 2), round(extras.get("INCENTIVE", 0), 2)

    unpaid_days = 0.0
    for lr in db.query(LeaveRequest).filter(LeaveRequest.employee_id == emp.id, LeaveRequest.leave_type == "UNPAID",
                                            LeaveRequest.status == "APPROVED", LeaveRequest.start_date < end,
                                            LeaveRequest.end_date >= start).all():
        unpaid_days += lr.days
    unpaid = round((basic + hra + allowances) / WORKING_DAYS * unpaid_days, 2)

    gross = round(basic + hra + allowances + overtime_pay + bonus + incentives, 2)
    pf = round(basic * settings.PF_RATE, 2)
    tax = round(annual_tax(max(0.0, (gross - pf) * 12 - 50000)) / 12, 2)  # 50k standard deduction
    deductions = round(tax + pf + unpaid, 2)
    return {"basic": basic, "hra": hra, "allowances": allowances, "overtime_pay": overtime_pay, "bonus": bonus,
            "incentives": incentives, "gross": gross, "tax": tax, "pf": pf, "unpaid_leave_deduction": unpaid,
            "total_deductions": deductions, "net": round(gross - deductions, 2)}


def generate_payroll(db: Session, period: str, employee_ids: list[int] | None = None) -> tuple[int, int]:
    q = db.query(Employee).filter(Employee.status.in_(["ACTIVE", "ON_LEAVE"]))
    if employee_ids:
        q = q.filter(Employee.id.in_(employee_ids))
    created = skipped = 0
    for emp in q.all():
        existing = db.query(Payroll).filter_by(employee_id=emp.id, period=period).first()
        if existing and existing.status == "PAID":
            skipped += 1
            continue
        values = compute_payroll(db, emp, period)
        if existing:
            for k, v in values.items():
                setattr(existing, k, v)
        else:
            db.add(Payroll(employee_id=emp.id, period=period, **values))
        created += 1
    db.commit()
    return created, skipped
