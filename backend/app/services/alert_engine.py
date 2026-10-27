"""Smart notification & alert engine (Module 17).

Scans workforce signals and raises prioritised, de-duplicated AI alerts:
  * risk escalation    – CRITICAL employees with no open intervention escalate to ADMIN
  * burnout            – sustained overtime over the last 14 days
  * absenteeism        – absence spikes over the last 14 days
  * stale approvals    – leave requests pending > 3 days
  * overdue tasks      – HR tasks past their due date
  * department instability – a department with a high share of high-risk staff
"""
from datetime import date, datetime, timedelta

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from ..models import Attendance, Department, Employee, Intervention, LeaveRequest, Notification, Task, User
from .events import notify_roles

DEDUP_HOURS = 24


def _recent(db: Session, title: str) -> bool:
    since = datetime.now() - timedelta(hours=DEDUP_HOURS)
    return db.query(Notification.id).filter(Notification.title == title, Notification.created_at >= since).first() is not None


def _raise(db: Session, roles, title, message, priority, category="RISK", link=None, escalated=False) -> int:
    if _recent(db, title):
        return 0
    created = notify_roles(db, roles, title, message, type_="ALERT" if priority in ("HIGH", "CRITICAL") else "WARNING",
                           category=category, priority=priority, link=link, is_ai=True, commit=False)
    for n in created:
        n.escalated = escalated
    db.commit()
    return 1


def risk_alert_for(db: Session, emp: Employee, old_level: str | None, new_level: str, score: float) -> int:
    """Called by the prediction engine whenever an employee's risk level rises into HIGH/CRITICAL."""
    order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    if new_level not in ("HIGH", "CRITICAL") or (old_level and order.index(new_level) <= order.index(old_level)):
        return 0
    title = f"{'Critical' if new_level == 'CRITICAL' else 'High'} attrition risk: {emp.full_name}"
    msg = (f"{emp.full_name} ({emp.department.name if emp.department else 'No dept'}) moved "
           f"{'from ' + old_level + ' ' if old_level else ''}to {new_level} risk ({score:.0f}%). Review recommended actions.")
    n = _raise(db, ("ADMIN", "HR"), title, msg, new_level, link=f"/ai/risk?employee={emp.id}")
    if emp.manager_id:
        mgr = db.query(User).filter_by(employee_id=emp.manager_id).first()
        if mgr and not _recent(db, title + " (team)"):
            from .events import notify
            notify(db, [mgr.id], title + " (team)", msg, type_="ALERT", category="RISK", priority=new_level,
                   link=f"/ai/risk?employee={emp.id}", is_ai=True)
    return n


def run_alert_engine(db: Session) -> dict:
    counts = {"escalations": 0, "burnout": 0, "absenteeism": 0, "stale_leaves": 0, "overdue_tasks": 0, "instability": 0}
    today = date.today()

    # 1. escalate CRITICAL risk without an active intervention
    open_iv = {eid for (eid,) in db.query(Intervention.employee_id).filter(Intervention.status.in_(["OPEN", "IN_PROGRESS"])).all()}
    for e in db.query(Employee).filter(Employee.risk_level == "CRITICAL", Employee.status == "ACTIVE").all():
        if e.id not in open_iv:
            counts["escalations"] += _raise(
                db, ("ADMIN",), f"Escalation: no intervention for {e.full_name}",
                f"{e.full_name} is at CRITICAL attrition risk ({e.risk_score:.0f}%) with no retention action in progress.",
                "CRITICAL", link=f"/ai/interventions?employee={e.id}", escalated=True)

    # 2/3. burnout & absenteeism over the last 14 days
    since = today - timedelta(days=14)
    rows = db.query(Attendance.employee_id, func.sum(Attendance.overtime_hours),
                    func.sum(case((Attendance.status == "ABSENT", 1), else_=0)), func.count()) \
        .filter(Attendance.date >= since).group_by(Attendance.employee_id).all()
    emps = {e.id: e for e in db.query(Employee).filter(Employee.id.in_([r[0] for r in rows])).all()}
    for eid, ot, absent, days in rows:
        e = emps.get(eid)
        if not e or e.status != "ACTIVE":
            continue
        if (ot or 0) >= 25:
            counts["burnout"] += _raise(db, ("ADMIN", "HR"), f"Burnout risk: {e.full_name}",
                                        f"{e.full_name} logged {ot:.0f}h overtime in the last 14 days.", "HIGH",
                                        category="ATTENDANCE", link=f"/employees/{e.id}")
        if days and (absent or 0) / days >= 0.3:
            counts["absenteeism"] += _raise(db, ("ADMIN", "HR"), f"Absence spike: {e.full_name}",
                                            f"{e.full_name} was absent {absent} of {days} recorded days recently.",
                                            "MEDIUM", category="ATTENDANCE", link=f"/employees/{e.id}")

    # 4. leave requests waiting too long
    stale = db.query(LeaveRequest).filter(LeaveRequest.status == "PENDING",
                                          LeaveRequest.created_at <= datetime.now() - timedelta(days=3)).count()
    if stale:
        counts["stale_leaves"] += _raise(db, ("ADMIN", "HR", "MANAGER"), f"{stale} leave request(s) awaiting decision",
                                         f"{stale} leave request(s) have been pending for more than 3 days.", "MEDIUM",
                                         category="LEAVE", link="/leaves?tab=approvals")

    # 5. overdue tasks
    overdue = db.query(Task).filter(Task.status != "DONE", Task.due_date < today).count()
    if overdue:
        counts["overdue_tasks"] += _raise(db, ("ADMIN", "HR"), f"{overdue} overdue HR task(s)",
                                          f"{overdue} task(s) are past their due date.", "MEDIUM", category="TASK",
                                          link="/tasks?overdue=1")

    # 6. department instability
    for d in db.query(Department).all():
        active = db.query(Employee).filter(Employee.department_id == d.id, Employee.status == "ACTIVE")
        total = active.count()
        high = active.filter(Employee.risk_level.in_(["HIGH", "CRITICAL"])).count()
        if total >= 5 and high / total >= 0.25:
            counts["instability"] += _raise(db, ("ADMIN", "HR"), f"Workforce instability in {d.name}",
                                            f"{high} of {total} employees in {d.name} are high/critical attrition risk.",
                                            "HIGH", link="/ai/forecasting")

    counts["total"] = sum(counts.values())
    return counts
