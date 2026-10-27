import os
import sys
import tempfile
from pathlib import Path

import pytest

# Isolated database + storage for the test session (must be set before the app is imported).
_TMP = Path(tempfile.mkdtemp(prefix="wfai_test_"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["STORAGE_DIR"] = str(_TMP / "storage")
os.environ["DEV_MODE"] = "true"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import seed  # noqa: E402
from app.main import app  # noqa: E402

CREDS = {"ADMIN": ("admin@workforce.ai", "Admin@123"), "HR": ("hr@workforce.ai", "Hr@12345"),
         "MANAGER": ("manager@workforce.ai", "Manager@123"), "EMPLOYEE": ("employee@workforce.ai", "Employee@123")}


@pytest.fixture(scope="session")
def client():
    seed.main(reset=True)
    with TestClient(app) as c:
        yield c


def _login(client, role):
    email, pw = CREDS[role]
    r = client.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def admin(client):
    return _login(client, "ADMIN")


@pytest.fixture(scope="session")
def hr(client):
    return _login(client, "HR")


@pytest.fixture(scope="session")
def manager(client):
    return _login(client, "MANAGER")


@pytest.fixture(scope="session")
def employee(client):
    return _login(client, "EMPLOYEE")
