"""Seed WorkForce AI Pro with a realistic demo company.

    python seed.py            # create tables and seed (skips if data exists)
    python seed.py --reset    # drop everything and reseed

Demo accounts (all local test credentials):
    admin@workforce.ai     / Admin@123      ADMIN
    hr@workforce.ai        / Hr@12345       HR
    manager@workforce.ai   / Manager@123    MANAGER  (Head of Engineering)
    employee@workforce.ai  / Employee@123   EMPLOYEE (Software Engineer)
    other linked staff     / Welcome@123
"""
import random
import sys
from datetime import date, datetime, time, timedelta

import numpy as np

from app.database import Base, SessionLocal, engine
from app.ml import engine as ml
from app.models import (ActivityLog, Attendance, BonusEntry, ChatMessage, Department, Document, Employee, Goal,
                        Intervention, JobRole, LeavePolicy, LeaveRequest, Notification, Payroll, PerformanceReview,
                        Prediction, RiskLog, Shift, ShiftAssignment, Task, User)
from app.security import hash_password
from app.services import ai
from app.services.alert_engine import run_alert_engine
from app.services.payroll_calc import generate_payroll

RNG = np.random.default_rng(2026)
random.seed(2026)
TODAY = date.today()

DEPTS = [  # name, code, budget (annual), roles by level
    ("Engineering", "ENG", 90_000_000, ["Software Engineer", "Senior Software Engineer", "Tech Lead", "Engineering Manager", "Head of Engineering"]),
    ("Sales", "SAL", 45_000_000, ["Sales Associate", "Account Executive", "Senior Account Executive", "Sales Manager", "VP Sales"]),
    ("Marketing", "MKT", 25_000_000, ["Marketing Associate", "Marketing Specialist", "Senior Marketer", "Marketing Manager", "Head of Marketing"]),
    ("Human Resources", "HR", 15_000_000, ["HR Associate", "HR Generalist", "HR Business Partner", "HR Manager", "Head of People"]),
    ("Finance", "FIN", 25_000_000, ["Accounts Associate", "Financial Analyst", "Senior Analyst", "Finance Manager", "CFO"]),
    ("Operations", "OPS", 35_000_000, ["Operations Associate", "Operations Analyst", "Operations Lead", "Operations Manager", "COO"]),
    ("Customer Support", "SUP", 25_000_000, ["Support Agent", "Senior Support Agent", "Support Lead", "Support Manager", "Head of Support"]),
]
EXIT_REASONS_VOL = ["Better compensation elsewhere", "Career growth opportunity", "Relocation", "Work-life balance",
                    "Higher studies", "Manager relationship", "Burnout"]
EXIT_REASONS_INV = ["Performance", "Restructuring", "Policy violation"]
DEMO = {"admin": ("admin@workforce.ai", "Admin@123"), "hr": ("hr@workforce.ai", "Hr@12345"),
        "manager": ("manager@workforce.ai", "Manager@123"), "employee": ("employee@workforce.ai", "Employee@123")}
DEFAULT_PW = "Welcome@123"


def rand_date(start: date, end: date) -> date:
    return start + timedelta(days=int(RNG.integers(0, max(1, (end - start).days))))


def workdays(start: date, end: date):
    d = start
    while d <= end:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


def main(reset: bool):
    if reset:
        Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    if db.query(User).count():
        print("Database already seeded. Use --reset to reseed.")
        return

    # ---------------------------------------------------------------- org structure
    depts, roles = {}, {}
    for name, code, budget, titles in DEPTS:
        d = Department(name=name, code=code, budget=budget, description=f"{name} department")
        db.add(d)
        db.flush()
        depts[name] = d
        for lvl, t in enumerate(titles, start=1):
            r = JobRole(title=t, department_id=d.id, level=lvl, min_salary=ml.LEVEL_PAY[lvl] * 0.75,
                        max_salary=ml.LEVEL_PAY[lvl] * 1.35)
            db.add(r)
            db.flush()
            roles[(name, lvl)] = r
    shifts = [Shift(name="General", start_time=time(9, 0), end_time=time(18, 0)),
              Shift(name="Morning", start_time=time(6, 0), end_time=time(15, 0)),
              Shift(name="Evening", start_time=time(14, 0), end_time=time(23, 0))]
    db.add_all(shifts)
    db.add_all([
        LeavePolicy(leave_type="ANNUAL", annual_quota=18, carry_forward=True, max_consecutive_days=15, description="Paid annual vacation; up to 5 unused days carry forward."),
        LeavePolicy(leave_type="SICK", annual_quota=10, max_consecutive_days=10, requires_document=True, description="Medical certificate required beyond 2 days."),
        LeavePolicy(leave_type="CASUAL", annual_quota=8, max_consecutive_days=3, description="Short personal leave."),
        LeavePolicy(leave_type="UNPAID", annual_quota=0, max_consecutive_days=30, description="Leave without pay; deducted in payroll."),
    ])
    db.flush()

    # ---------------------------------------------------------------- employees
    used_emails, emps, profiles = set(), [], {}
    dept_names = [d[0] for d in DEPTS]

    def make_employee(dept: str, profile: dict, leaver: bool, force_level: int | None = None, email: str | None = None,
                      name: tuple[str, str] | None = None):
        gender = "Female" if RNG.random() < 0.45 else "Male"
        # role-based placeholder names instead of personal names
        first, last = name or ("Employee", f"{len(emps) + 1:03d}")
        em = email or f"{first}.{last}".lower().replace(" ", "") + "@workforce.ai"
        used_emails.add(em)
        level = force_level or profile["job_level"]
        profile["job_level"] = level
        if force_level:
            profile["monthly_income"] = round(ml.LEVEL_PAY[level] * float(RNG.lognormal(0.05, 0.1)), -2)
        yac = profile["years_at_company"]
        if leaver:
            term = rand_date(TODAY - timedelta(days=720), TODAY - timedelta(days=5))
            hire = term - timedelta(days=max(60, int(yac * 365)))
        else:
            term = None
            hire = TODAY - timedelta(days=max(10, int(yac * 365)))
        age = int(np.clip(23 + level * 4 + yac * 0.6 + RNG.normal(0, 4), 21, 60))
        e = Employee(
            employee_code=f"EMP{len(emps) + 1:04d}", first_name=first, last_name=last, email=em,
            phone=f"+91 9{RNG.integers(100000000, 999999999)}", gender=gender,
            date_of_birth=TODAY - timedelta(days=age * 365 + int(RNG.integers(0, 364))),
            marital_status=random.choice(["Single", "Married", "Married", "Divorced"]), education=int(RNG.integers(2, 6)),
            address=f"{RNG.integers(1, 300)}, {random.choice(['MG Road', 'Park Street', 'Linking Road', 'Brigade Road', 'Anna Salai'])}, "
                    f"{random.choice(['Bengaluru', 'Mumbai', 'Pune', 'Hyderabad', 'Chennai', 'Delhi'])}",
            hire_date=hire, termination_date=term, status="ACTIVE",
            department_id=depts[dept].id, job_role_id=roles[(dept, level)].id, salary=profile["monthly_income"],
            job_satisfaction=profile["job_satisfaction"], environment_satisfaction=profile["environment_satisfaction"],
            work_life_balance=profile["work_life_balance"], job_involvement=profile["job_involvement"],
            distance_from_home=profile["distance_from_home"], num_companies_worked=profile["num_companies_worked"],
            years_since_last_promotion=int(profile["years_since_last_promotion"]),
            training_times_last_year=profile["training_times_last_year"], stock_option_level=profile["stock_option_level"],
        )
        if leaver:
            vol = RNG.random() < 0.8
            e.status = "RESIGNED" if vol else "TERMINATED"
            e.termination_reason = random.choice(EXIT_REASONS_VOL if vol else EXIT_REASONS_INV)
        db.add(e)
        db.flush()
        emps.append(e)
        profiles[e.id] = profile
        return e

    heads = {}
    special_email = {"Engineering": DEMO["manager"][0], "Human Resources": DEMO["hr"][0]}
    special_name = {"Engineering": ("Manager", "User"), "Human Resources": ("HR", "User")}
    for dept in dept_names:  # stable, senior department heads
        p = ml.synthetic_profile(RNG)
        p.update(job_satisfaction=4, environment_satisfaction=3, work_life_balance=3, years_at_company=round(float(RNG.uniform(4, 12)), 1),
                 overtime_hours=round(float(RNG.uniform(2, 9)), 1), absence_rate=1.0, stock_option_level=2,
                 years_since_last_promotion=1, performance_rating=4.0)
        heads[dept] = make_employee(dept, p, False, force_level=5, email=special_email.get(dept),
                                   name=special_name.get(dept, ("Manager", dept)))
        depts[dept].head_id = heads[dept].id

    dept_weights = [0.26, 0.18, 0.1, 0.07, 0.1, 0.15, 0.14]
    for i in range(143):
        p = ml.synthetic_profile(RNG)
        p["job_level"] = min(p["job_level"], 4)
        dept = dept_names[int(RNG.choice(len(dept_names), p=dept_weights))]
        p["department"] = dept
        prob = 1 / (1 + np.exp(-ml._attrition_logit(p, RNG)))
        leaving = RNG.random() < prob
        leaver = leaving and RNG.random() < 0.55
        e = make_employee(dept, p, leaver, email=DEMO["employee"][0] if i == 0 else None,
                          name=("Employee", "User") if i == 0 else None)
        if i == 0:  # the demo employee is an engineer
            e.department_id, e.job_role_id = depts["Engineering"].id, roles[("Engineering", 1)].id
            e.salary = profiles[e.id]["monthly_income"] = 38000.0
            e.status, e.termination_date, e.termination_reason = "ACTIVE", None, None
            e.hire_date = TODAY - timedelta(days=500)
        e.manager_id = heads[db.get(Department, e.department_id).name].id

    active = [e for e in emps if e.status == "ACTIVE"]
    print(f"Employees: {len(emps)} ({len(active)} active, {len(emps) - len(active)} left)")

    # ---------------------------------------------------------------- users
    def user(email, pw, name, role, emp=None):
        u = User(email=email, full_name=name, password_hash=hash_password(pw), role=role,
                 employee_id=emp.id if emp else None, last_login=datetime.now() - timedelta(hours=int(RNG.integers(1, 72))))
        db.add(u)
        db.flush()
        return u

    admin = user(*DEMO["admin"], "Admin User", "ADMIN")
    hr = user(*DEMO["hr"], heads["Human Resources"].full_name, "HR", heads["Human Resources"])
    mgr = user(*DEMO["manager"], heads["Engineering"].full_name, "MANAGER", heads["Engineering"])
    demo_emp = next(e for e in emps if e.email == DEMO["employee"][0])
    emp_user = user(*DEMO["employee"], demo_emp.full_name, "EMPLOYEE", demo_emp)
    extra_users = []
    for dept, h in heads.items():
        if dept not in ("Engineering", "Human Resources"):
            extra_users.append(user(h.email, DEFAULT_PW, h.full_name, "MANAGER", h))
    head_ids = {h.id for h in heads.values()}
    for e in [e for e in active if e.department_id == depts["Engineering"].id and e.id != demo_emp.id and e.id not in head_ids][:6]:
        extra_users.append(user(e.email, DEFAULT_PW, e.full_name, "EMPLOYEE", e))
    db.commit()

    # shift assignments: support works morning/evening rotations
    for e in active:
        if e.department_id == depts["Customer Support"].id:
            db.add(ShiftAssignment(employee_id=e.id, shift_id=shifts[1 if e.id % 2 else 2].id, start_date=TODAY - timedelta(days=90)))
        elif e.department_id == depts["Operations"].id and e.id % 3 == 0:
            db.add(ShiftAssignment(employee_id=e.id, shift_id=shifts[1].id, start_date=TODAY - timedelta(days=90)))

    # ---------------------------------------------------------------- leave requests
    leave_days = {}
    for e in random.sample(active, 55):
        lt = random.choice(["ANNUAL", "ANNUAL", "SICK", "CASUAL", "UNPAID"])
        start = rand_date(TODAY - timedelta(days=55), TODAY + timedelta(days=25))
        while start.weekday() >= 5:
            start += timedelta(days=1)
        length = int(RNG.integers(1, 4 if lt != "ANNUAL" else 6))
        end = start + timedelta(days=length - 1)
        days = sum(1 for _ in workdays(start, end))
        if not days:
            continue
        status = "PENDING" if start > TODAY - timedelta(days=2) and RNG.random() < 0.6 else random.choice(["APPROVED", "APPROVED", "APPROVED", "REJECTED"])
        lr = LeaveRequest(employee_id=e.id, leave_type=lt, start_date=start, end_date=end, days=days,
                          reason=random.choice(["Family function", "Medical appointment", "Personal work", "Vacation", "Feeling unwell"]),
                          status=status, created_at=datetime.combine(start - timedelta(days=int(RNG.integers(2, 10))), time(10)))
        if status != "PENDING":
            lr.approver_id, lr.decided_at = (mgr.id if e.department_id == depts["Engineering"].id else hr.id), lr.created_at + timedelta(days=1)
            if status == "REJECTED":
                lr.approver_comment = "Critical delivery timeline — please reschedule."
        db.add(lr)
        if status == "APPROVED":
            for d in workdays(start, end):
                leave_days[(e.id, d)] = True
    # pending requests in the manager's team for the approval demo
    for e in [e for e in active if e.department_id == depts["Engineering"].id and e.id != demo_emp.id and e.id not in {h.id for h in heads.values()}][:3]:
        s = TODAY + timedelta(days=int(RNG.integers(5, 20)))
        while s.weekday() >= 5:
            s += timedelta(days=1)
        db.add(LeaveRequest(employee_id=e.id, leave_type="ANNUAL", start_date=s, end_date=s + timedelta(days=1),
                            days=sum(1 for _ in workdays(s, s + timedelta(days=1))), reason="Short vacation", status="PENDING",
                            created_at=datetime.now() - timedelta(days=int(RNG.integers(1, 5)))))
    db.commit()

    # ---------------------------------------------------------------- attendance (60 days + today)
    now = datetime.now()
    att_rows = []
    for e in active:
        p = profiles[e.id]
        start_t = time(9, 0)
        sa = db.query(ShiftAssignment).filter_by(employee_id=e.id).first()
        if sa:
            start_t = db.get(Shift, sa.shift_id).start_time
        absent_p = p["absence_rate"] / 100
        daily_ot = p["overtime_hours"] / 21
        begin = max(e.hire_date, TODAY - timedelta(days=60))
        for d in workdays(begin, TODAY - timedelta(days=1)):
            if leave_days.get((e.id, d)):
                att_rows.append(dict(employee_id=e.id, date=d, status="ON_LEAVE"))
                continue
            if RNG.random() < absent_p:
                att_rows.append(dict(employee_id=e.id, date=d, status="ABSENT"))
                continue
            delay = float(RNG.normal(-5, 12))
            ci = datetime.combine(d, start_t) + timedelta(minutes=delay)
            worked = 9 + max(0.0, float(RNG.normal(daily_ot, daily_ot * 0.6 + 0.1))) + float(RNG.normal(0, 0.25))
            half = RNG.random() < 0.02
            if half:
                worked = float(RNG.uniform(3.5, 4.4))
            co = ci + timedelta(hours=worked)
            status = "HALF_DAY" if half else ("LATE" if delay > 15 else "PRESENT")
            att_rows.append(dict(employee_id=e.id, date=d, check_in=ci, check_out=co, hours_worked=round(worked, 2),
                                 overtime_hours=round(max(0, worked - 9), 2), status=status))
        # today: a live picture for the monitoring dashboard (the demo employee checks in themselves)
        if TODAY.weekday() < 5 and e.id != demo_emp.id and not leave_days.get((e.id, TODAY)):
            ci = datetime.combine(TODAY, start_t) + timedelta(minutes=float(RNG.normal(-5, 14)))
            if ci < now and RNG.random() > absent_p + 0.08:
                rec = dict(employee_id=e.id, date=TODAY, check_in=ci, status="LATE" if ci > datetime.combine(TODAY, start_t) + timedelta(minutes=15) else "PRESENT")
                if now > ci + timedelta(hours=9.2) and RNG.random() < 0.7:
                    co = ci + timedelta(hours=float(RNG.uniform(9, 10.5)))
                    rec.update(check_out=co, hours_worked=round((co - ci).total_seconds() / 3600, 2),
                               overtime_hours=round(max(0, (co - ci).total_seconds() / 3600 - 9), 2))
                att_rows.append(rec)
        elif leave_days.get((e.id, TODAY)):
            att_rows.append(dict(employee_id=e.id, date=TODAY, status="ON_LEAVE"))
    db.bulk_insert_mappings(Attendance, att_rows)
    db.commit()
    print(f"Attendance rows: {len(att_rows)}")

    # ---------------------------------------------------------------- performance reviews & goals
    for e in active:
        p = profiles[e.id]
        reviewer = mgr if e.department_id == depts["Engineering"].id else hr
        for period, age in (("2025-H2", 200), ("2026-H1", 60)):
            if e.hire_date > TODAY - timedelta(days=age + 30):
                continue
            rating = p["performance_rating"] if period == "2026-H1" else float(np.clip(p["performance_rating"] + RNG.choice([-0.5, 0, 0.5]), 1, 5))
            db.add(PerformanceReview(
                employee_id=e.id, reviewer_id=reviewer.id, period=period, rating=rating,
                quality=int(np.clip(round(rating + RNG.normal(0, 0.5)), 1, 5)), productivity=int(np.clip(round(rating + RNG.normal(0, 0.6)), 1, 5)),
                teamwork=int(np.clip(round(rating + RNG.normal(0, 0.6)), 1, 5)),
                strengths=random.choice(["Strong ownership", "Great collaborator", "Fast learner", "Customer focused", "Detail oriented"]),
                improvements=random.choice(["Delegate more", "Improve estimation", "Proactive communication", "Deepen domain expertise", "Time management"]),
                created_at=datetime.now() - timedelta(days=age)))
        for _ in range(int(RNG.integers(0, 3))):
            prog = int(RNG.integers(0, 101))
            db.add(Goal(employee_id=e.id, title=random.choice(["Complete AWS certification", "Lead a cross-team project", "Improve CSAT to 95%",
                                                               "Mentor a new joiner", "Automate monthly reporting", "Close 20 enterprise deals"]),
                        target_date=TODAY + timedelta(days=int(RNG.integers(-20, 150))), progress=prog,
                        status="ACHIEVED" if prog == 100 else "ACTIVE"))
    db.commit()

    # ---------------------------------------------------------------- payroll (3 months) & bonuses
    periods = []
    y, m = TODAY.year, TODAY.month
    for _ in range(3):
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
        periods.append(f"{y}-{m:02d}")
    periods.reverse()
    for e in random.sample(active, 25):
        db.add(BonusEntry(employee_id=e.id, period=periods[-1], kind=random.choice(["BONUS", "INCENTIVE"]),
                          amount=round(float(RNG.uniform(3000, 25000)), -2), reason=random.choice(["Quarterly performance", "Spot award", "Sales target achieved"])))
    db.commit()
    for i, per in enumerate(periods):
        generate_payroll(db, per)
        if i < len(periods) - 1:
            db.query(Payroll).filter_by(period=per).update({Payroll.status: "PAID"})
    db.commit()

    # ---------------------------------------------------------------- tasks
    task_titles = ["Update employee handbook", "Prepare quarterly headcount report", "Conduct exit interview",
                   "Schedule team offsite", "Review overtime claims", "Organise compliance training", "Update job descriptions",
                   "Collect feedback survey", "Benchmark salaries", "Plan hiring for Q4"]
    for _ in range(36):
        e = random.choice(active)
        st = random.choice(["TODO", "IN_PROGRESS", "DONE", "DONE", "BLOCKED"])
        due = TODAY + timedelta(days=int(RNG.integers(-12, 30)))
        db.add(Task(title=random.choice(task_titles), assignee_id=e.id, assigned_by=random.choice([hr.id, admin.id, mgr.id]),
                    status=st, priority=random.choice(["LOW", "MEDIUM", "MEDIUM", "HIGH", "CRITICAL"]), due_date=due,
                    workflow=random.choice(["GENERAL", "GENERAL", "REVIEW", "RETENTION"]),
                    completed_at=datetime.now() - timedelta(days=int(RNG.integers(0, 10))) if st == "DONE" else None))
    for t, off, st in (("Complete security training", 3, "TODO"), ("Submit Q3 self-assessment", -2, "IN_PROGRESS"),
                       ("Update profile documents", 10, "TODO"), ("Code review guidelines read-through", -5, "DONE")):
        db.add(Task(title=t, assignee_id=demo_emp.id, assigned_by=mgr.id, status=st, priority="MEDIUM",
                    due_date=TODAY + timedelta(days=off), completed_at=datetime.now() if st == "DONE" else None))
    for e in [e for e in active if e.hire_date > TODAY - timedelta(days=40)][:3]:
        for title, off in (("Prepare laptop & accounts", 0), ("Assign onboarding buddy", 1), ("30-day check-in", 30)):
            db.add(Task(title=f"{title} — {e.full_name}", workflow="ONBOARDING", assignee_id=e.manager_id or e.id,
                        assigned_by=hr.id, due_date=e.hire_date + timedelta(days=off), status="DONE" if off == 0 else "TODO"))
    db.commit()

    # ---------------------------------------------------------------- AI: dataset → model → predictions with history
    df = ml.generate_synthetic_dataset(1500, seed=42)
    ds = ai.register_dataset(db, "IBM-style HR Attrition History", "hr_attrition_history.csv", df.to_csv(index=False).encode(), hr)
    mv = ai.train_from_dataset(db, ds)
    print(f"Model v{mv.version}: {mv.algorithm} AUC={mv.metrics['roc_auc']}")

    def backdate(days):
        when = datetime.now() - timedelta(days=days)
        db.query(Prediction).filter(Prediction.created_at > when + timedelta(days=1)).update({Prediction.created_at: when})
        db.query(RiskLog).filter(RiskLog.created_at > when + timedelta(days=1)).update({RiskLog.created_at: when})
        db.commit()

    ai.run_predictions(db, raise_alerts=False)
    backdate(60)
    drifters = random.sample(active, 30)
    for e in drifters[:18]:  # engagement worsened for some …
        e.job_satisfaction = max(1, e.job_satisfaction - 1)
        e.work_life_balance = max(1, e.work_life_balance - 1)
    for e in drifters[18:]:  # … and improved for others
        e.job_satisfaction = min(4, e.job_satisfaction + 1)
    db.commit()
    ai.run_predictions(db, raise_alerts=False)
    backdate(30)
    for e in drifters[:8]:
        e.environment_satisfaction = max(1, e.environment_satisfaction - 1)
        e.years_since_last_promotion += 1
    db.commit()
    summary = ai.run_predictions(db, raise_alerts=True)
    print(f"Predictions: {summary}")

    # ---------------------------------------------------------------- interventions for top-risk employees
    top = db.query(Employee).filter(Employee.status == "ACTIVE", Employee.risk_level.in_(["HIGH", "CRITICAL"])) \
        .order_by(Employee.risk_score.desc()).all()
    preds = ai.latest_predictions(db, [e.id for e in top])
    for i, e in enumerate(top[1:9]):  # leave the very top one without action so escalation fires
        recs = ai.employee_recommendations(preds.get(e.id)) or [{"action_type": "ONE_ON_ONE", "recommendation": "Schedule a stay interview."}]
        r = recs[0]
        st = ["OPEN", "IN_PROGRESS", "IN_PROGRESS", "COMPLETED", "OPEN", "COMPLETED", "IN_PROGRESS", "OPEN"][i]
        db.add(Intervention(employee_id=e.id, created_by=hr.id, owner_id=hr.id if i % 2 else mgr.id, action_type=r["action_type"],
                            recommendation=r["recommendation"], status=st, risk_at_creation=(e.risk_score or 0) + (6 if st == "COMPLETED" else 0),
                            notes="Discussed concerns; agreed on next steps." if st != "OPEN" else None,
                            outcome="Employee confirmed renewed commitment." if st == "COMPLETED" else None,
                            follow_up_date=TODAY + timedelta(days=int(RNG.integers(-6, 21))),
                            created_at=datetime.now() - timedelta(days=int(RNG.integers(1, 25)))))
    db.commit()

    # ---------------------------------------------------------------- documents (small generated PDFs)
    from app.config import UPLOAD_DIR
    from app.services.exporters import table_pdf
    import hashlib
    import uuid
    for e, title, kind in ((demo_emp, "Offer Letter", "CONTRACT"), (demo_emp, "PAN Card", "ID_PROOF"),
                           (heads["Engineering"], "Employment Contract", "CONTRACT"), (heads["Human Resources"], "SHRM Certificate", "CERTIFICATE")):
        content = table_pdf(title, [("k", "Field"), ("v", "Value")],
                            [{"k": "Employee", "v": e.full_name}, {"k": "Code", "v": e.employee_code}, {"k": "Document", "v": title}])
        stored = f"{uuid.uuid4().hex}.pdf"
        (UPLOAD_DIR / stored).write_bytes(content)
        db.add(Document(employee_id=e.id, uploaded_by=hr.id, doc_type=kind, title=title, original_name=f"{title.replace(' ', '_')}.pdf",
                        stored_name=stored, content_type="application/pdf", size=len(content), checksum=hashlib.sha256(content).hexdigest()))
    db.commit()

    # ---------------------------------------------------------------- chat history
    convo = [(mgr, emp_user, "Hi! How is the payments API migration going?"), (emp_user, mgr, "Going well — about 70% done. Should wrap up Thursday."),
             (mgr, emp_user, "Great. Ping me if you need help with the load tests."), (emp_user, mgr, "Will do, thanks!"),
             (hr, mgr, "Reminder: mid-year reviews for your team are due Friday."), (mgr, hr, "Noted, 6 of 9 are done."),
             (hr, emp_user, "Welcome aboard officially! Your PF account is now active."), (admin, hr, "Can you share the Q3 attrition report?"),
             (hr, admin, "Sure, exporting it from Reports now.")]
    t0 = datetime.now() - timedelta(hours=30)
    for i, (s, r, text) in enumerate(convo):
        ts = t0 + timedelta(minutes=37 * i)
        db.add(ChatMessage(sender_id=s.id, receiver_id=r.id, content=text, created_at=ts, delivered_at=ts,
                           read_at=ts + timedelta(minutes=3) if i < len(convo) - 2 else None))
    for u in extra_users[:5]:
        db.add(ChatMessage(sender_id=u.id, receiver_id=hr.id, content="Hi, could you confirm my leave balance?",
                           created_at=datetime.now() - timedelta(hours=int(RNG.integers(2, 48)))))
    db.commit()

    # ---------------------------------------------------------------- activity history & notifications
    actions = [("LOGIN", "user", "{u} logged in"), ("UPDATE", "employee", "{u} updated an employee profile"),
               ("CHECK_IN", "attendance", "{u} checked in"), ("APPROVED", "leave", "{u} approved a leave request"),
               ("EXPORT", "report", "{u} exported a payroll report"), ("CREATE", "task", "{u} assigned a task")]
    for _ in range(160):
        u = random.choice([admin, hr, mgr, emp_user] + extra_users)
        a, ent, txt = random.choice(actions)
        db.add(ActivityLog(user_id=u.id, action=a, entity_type=ent, summary=txt.format(u=u.full_name), ip_address="127.0.0.1",
                           created_at=datetime.now() - timedelta(minutes=int(RNG.integers(5, 60 * 24 * 14)))))
    db.add(ActivityLog(user_id=None, action="LOGIN_FAILED", entity_type="user", summary="Failed login for unknown@workforce.ai",
                       ip_address="10.0.0.23", created_at=datetime.now() - timedelta(hours=5)))
    for u in (admin, hr, mgr, emp_user):
        db.add(Notification(user_id=u.id, title="Welcome to WorkForce AI Pro", message="Your workspace is ready. Explore the dashboard to get started.",
                            type="SUCCESS", category="SYSTEM", is_read=True, created_at=datetime.now() - timedelta(days=3)))
    db.commit()
    alerts = run_alert_engine(db)
    print(f"Alert engine: {alerts}")
    print("Seed complete. Demo accounts are listed at the top of seed.py and in README.md")
    db.close()


if __name__ == "__main__":
    main("--reset" in sys.argv)
