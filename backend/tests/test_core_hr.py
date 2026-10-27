from datetime import date, timedelta

from app.services.payroll_calc import annual_tax


def _next_weekday(d: date) -> date:
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def test_employee_crud_search_and_audit(client, hr, admin):
    depts = client.get("/api/departments", headers=hr).json()
    body = {"first_name": "Jane", "last_name": "Tester", "email": "jane.tester@workforce.ai", "hire_date": "2026-01-10",
            "department_id": depts[0]["id"], "salary": 55000}
    r = client.post("/api/employees", headers=hr, json=body)
    assert r.status_code == 201
    emp = r.json()
    assert emp["employee_code"].startswith("EMP")
    assert client.post("/api/employees", headers=hr, json=body).status_code == 409
    upd = client.patch(f"/api/employees/{emp['id']}", headers=hr, json={"salary": 60000, "job_satisfaction": 2})
    assert upd.json()["salary"] == 60000
    found = client.get("/api/employees?q=jane tester", headers=hr).json()
    assert found["total"] == 1
    flt = client.get(f"/api/employees?department_id={depts[0]['id']}&salary_min=59000&salary_max=61000", headers=hr).json()
    assert any(e["id"] == emp["id"] for e in flt["items"])
    hist = client.get(f"/api/audit/entity/employee/{emp['id']}", headers=hr).json()
    assert hist[0]["changes"]["salary"] == [55000.0, 60000]
    assert client.delete(f"/api/employees/{emp['id']}", headers=hr).status_code == 403  # admin only
    assert client.delete(f"/api/employees/{emp['id']}", headers=admin).status_code == 200


def test_department_crud_and_stats(client, hr, admin):
    r = client.post("/api/departments", headers=hr, json={"name": "Research", "code": "rnd", "budget": 1000000})
    assert r.status_code == 201 and r.json()["code"] == "RND"
    stats = client.get("/api/departments/stats", headers=hr).json()
    eng = next(s for s in stats if s["name"] == "Engineering")
    assert eng["headcount"] > 0 and eng["attendance_rate"] is not None
    assert client.delete(f"/api/departments/{r.json()['id']}", headers=admin).status_code == 200


def test_attendance_check_in_out(client, employee):
    status = client.get("/api/attendance/today", headers=employee).json()
    if status["record"] is None:
        r = client.post("/api/attendance/check-in", headers=employee)
        assert r.status_code == 200 and r.json()["status"] in ("PRESENT", "LATE")
    assert client.post("/api/attendance/check-in", headers=employee).status_code == 400
    out = client.post("/api/attendance/check-out", headers=employee)
    assert out.status_code == 200 and out.json()["check_out"]
    assert client.post("/api/attendance/check-out", headers=employee).status_code == 400


def test_leave_workflow(client, employee, manager):
    bal_before = {b["leave_type"]: b for b in client.get("/api/leaves/balance", headers=employee).json()}
    start = _next_weekday(date.today() + timedelta(days=40))
    end = start + timedelta(days=1 if start.weekday() < 4 else 3)
    r = client.post("/api/leaves", headers=employee, json={"leave_type": "CASUAL", "start_date": str(start), "end_date": str(end), "reason": "Test"})
    assert r.status_code == 201, r.text
    lid = r.json()["id"]
    assert client.post("/api/leaves", headers=employee, json={"leave_type": "CASUAL", "start_date": str(start), "end_date": str(start)}).status_code == 409
    assert client.post("/api/leaves", headers=employee, json={"leave_type": "CASUAL", "start_date": str(end), "end_date": str(start)}).status_code == 400
    assert client.post(f"/api/leaves/{lid}/decision", headers=employee, json={"approve": True}).status_code == 403
    d = client.post(f"/api/leaves/{lid}/decision", headers=manager, json={"approve": True, "comment": "Enjoy"})
    assert d.json()["status"] == "APPROVED"
    bal_after = {b["leave_type"]: b for b in client.get("/api/leaves/balance", headers=employee).json()}
    assert bal_after["CASUAL"]["used"] == bal_before["CASUAL"]["used"] + 2
    assert client.post(f"/api/leaves/{lid}/cancel", headers=employee).json()["status"] == "CANCELLED"


def test_tax_slabs():
    assert annual_tax(200000) == 0
    assert round(annual_tax(500000), 2) == round(12500 * 1.04, 2)
    assert round(annual_tax(1200000), 2) == round((12500 + 100000 + 60000) * 1.04, 2)


def test_payroll_generation_and_payslip(client, hr, employee):
    r = client.post("/api/payroll/generate", headers=hr, json={"period": "2030-01"})
    assert r.status_code == 200 and r.json()["generated"] > 100
    slip = client.get("/api/payroll?period=2030-01&size=1", headers=hr).json()["items"][0]
    assert abs(slip["gross"] - slip["total_deductions"] - slip["net"]) < 0.01
    assert abs(slip["basic"] + slip["hra"] + slip["allowances"] + slip["overtime_pay"] + slip["bonus"] + slip["incentives"] - slip["gross"]) < 0.01
    mine = client.get("/api/payroll", headers=employee).json()["items"]
    assert mine and all(p["employee_code"] == mine[0]["employee_code"] for p in mine)
    pdf = client.get(f"/api/payroll/{mine[0]['id']}/pdf", headers=employee)
    assert pdf.content.startswith(b"%PDF")
    assert client.get(f"/api/payroll/{slip['id']}/pdf", headers=employee).status_code in (200, 403)
    assert client.post("/api/payroll/generate", headers=employee, json={"period": "2030-01"}).status_code == 403


def test_document_validation(client, employee):
    fake = client.post("/api/documents", headers=employee, files={"file": ("cv.pdf", b"not really a pdf", "application/pdf")},
                       data={"doc_type": "RESUME"})
    assert fake.status_code == 400
    exe = client.post("/api/documents", headers=employee, files={"file": ("x.exe", b"MZ...", "application/octet-stream")})
    assert exe.status_code == 400
    pdf = b"%PDF-1.4 test document"
    ok = client.post("/api/documents", headers=employee, files={"file": ("cv.pdf", pdf, "application/pdf")}, data={"doc_type": "RESUME", "title": "My CV"})
    assert ok.status_code == 201
    dup = client.post("/api/documents", headers=employee, files={"file": ("cv2.pdf", pdf, "application/pdf")})
    assert dup.status_code == 409
    did = ok.json()["id"]
    assert client.get(f"/api/documents/{did}/download", headers=employee).content == pdf
    assert client.delete(f"/api/documents/{did}", headers=employee).status_code == 200


def test_tasks_and_workflow(client, hr, employee):
    me = client.get("/api/auth/me", headers=employee).json()["user"]["employee_id"]
    t = client.post("/api/tasks", headers=hr, json={"title": "Read policy", "assignee_id": me, "due_date": str(date.today() - timedelta(days=1))})
    assert t.status_code == 201 and t.json()["overdue"]
    upd = client.patch(f"/api/tasks/{t.json()['id']}", headers=employee, json={"status": "DONE", "title": "hacked"})
    assert upd.json()["status"] == "DONE" and upd.json()["title"] == "Read policy"
    assert client.post(f"/api/tasks/workflow?employee_id={me}&workflow=ONBOARDING", headers=hr).json()["created"] == 5


def test_reviews_and_goals(client, manager, employee):
    me = client.get("/api/auth/me", headers=employee).json()["user"]["employee_id"]
    r = client.post("/api/reviews", headers=manager, json={"employee_id": me, "period": "2026-H2", "rating": 4.5})
    assert r.status_code == 201
    g = client.post("/api/goals", headers=employee, json={"employee_id": me, "title": "Ship v2"}).json()
    assert client.patch(f"/api/goals/{g['id']}", headers=employee, json={"progress": 100}).json()["status"] == "ACHIEVED"
