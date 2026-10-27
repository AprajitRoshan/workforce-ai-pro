from datetime import datetime, timedelta, timezone

import jwt

from app.config import settings


def test_register_login_me_refresh(client):
    r = client.post("/api/auth/register", json={"full_name": "Test User", "email": "t.user@example.com", "password": "Passw0rd!"})
    assert r.status_code == 201
    assert r.json()["user"]["role"] == "EMPLOYEE"
    r = client.post("/api/auth/login", json={"email": "t.user@example.com", "password": "Passw0rd!"})
    assert r.status_code == 200
    tokens = r.json()
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert me.json()["user"]["email"] == "t.user@example.com"
    ref = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert ref.status_code == 200 and ref.json()["access_token"]


def test_register_validation(client):
    assert client.post("/api/auth/register", json={"full_name": "W", "email": "weak@example.com", "password": "short"}).status_code == 422
    assert client.post("/api/auth/register", json={"full_name": "Dup", "email": "admin@workforce.ai", "password": "Passw0rd!"}).status_code == 409


def test_wrong_password_and_missing_token(client):
    assert client.post("/api/auth/login", json={"email": "admin@workforce.ai", "password": "nope12345"}).status_code == 401
    assert client.get("/api/auth/me").status_code == 401


def test_expired_token_is_rejected(client):
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    token = jwt.encode({"sub": "1", "role": "ADMIN", "type": "access", "tv": 0, "iat": past, "exp": past + timedelta(minutes=1)},
                       settings.JWT_SECRET, algorithm="HS256")
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401 and r.headers.get("x-token-expired") == "1"


def test_refresh_token_cannot_be_used_as_access(client):
    r = client.post("/api/auth/login", json={"email": "hr@workforce.ai", "password": "Hr@12345"})
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['refresh_token']}"}).status_code == 401


def test_forgot_and_reset_password_revokes_sessions(client):
    client.post("/api/auth/register", json={"full_name": "Reset Me", "email": "reset.me@example.com", "password": "Passw0rd!"})
    old = client.post("/api/auth/login", json={"email": "reset.me@example.com", "password": "Passw0rd!"}).json()["access_token"]
    r = client.post("/api/auth/forgot-password", json={"email": "reset.me@example.com"})
    token = r.json()["dev_reset_token"]
    assert client.post("/api/auth/reset-password", json={"token": "bad", "new_password": "NewPassw0rd"}).status_code == 400
    assert client.post("/api/auth/reset-password", json={"token": token, "new_password": "NewPassw0rd"}).status_code == 200
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {old}"}).status_code == 401  # session revoked
    assert client.post("/api/auth/login", json={"email": "reset.me@example.com", "password": "NewPassw0rd"}).status_code == 200
    # unknown emails get the same generic answer (no account enumeration)
    assert "dev_reset_token" not in client.post("/api/auth/forgot-password", json={"email": "ghost@example.com"}).json()


def test_rbac_employee_restrictions(client, employee):
    assert client.get("/api/users", headers=employee).status_code == 403
    assert client.get("/api/ai/risk/overview", headers=employee).status_code == 403
    assert client.post("/api/employees", headers=employee, json={}).status_code in (403, 422)
    items = client.get("/api/employees", headers=employee).json()["items"]
    assert len(items) == 1 and "risk_score" not in items[0]  # only self, without AI risk


def test_rbac_manager_sees_only_team(client, manager, hr):
    team = client.get("/api/employees?size=500", headers=manager).json()
    everyone = client.get("/api/employees?size=500", headers=hr).json()
    assert 0 < team["total"] < everyone["total"]
    assert {e["department"] for e in team["items"]} == {"Engineering"}
    outsider = next(e for e in everyone["items"] if e["department"] != "Engineering")
    assert client.get(f"/api/employees/{outsider['id']}", headers=manager).status_code == 403


def test_admin_role_change_forces_relogin(client, admin):
    r = client.post("/api/auth/register", json={"full_name": "Promote Me", "email": "promote@example.com", "password": "Passw0rd!"})
    uid, tok = r.json()["user"]["id"], r.json()["access_token"]
    assert client.patch(f"/api/users/{uid}", headers=admin, json={"role": "HR"}).json()["role"] == "HR"
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"}).status_code == 401
