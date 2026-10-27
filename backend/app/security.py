import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import Employee, User

ROLES = ("ADMIN", "HR", "MANAGER", "EMPLOYEE")
_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=10)).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def _create_token(user: User, kind: str, expires: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "type": kind,
        "tv": user.token_version,
        "iat": now,
        "exp": now + expires,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_access_token(user: User) -> str:
    return _create_token(user, "access", timedelta(minutes=settings.ACCESS_TOKEN_MINUTES))


def create_refresh_token(user: User) -> str:
    return _create_token(user, "refresh", timedelta(days=settings.REFRESH_TOKEN_DAYS))


def new_reset_token() -> str:
    return secrets.token_urlsafe(32)


def decode_token(token: str, expected_type: str = "access") -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired", headers={"X-Token-Expired": "1"})
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    if payload.get("type") != expected_type:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    return payload


def user_from_token(db: Session, token: str, expected_type: str = "access") -> User:
    payload = decode_token(token, expected_type)
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User inactive or not found")
    if payload.get("tv") != user.token_version:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session revoked")
    return user


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer), db: Session = Depends(get_db)
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    return user_from_token(db, creds.credentials)


def require_roles(*roles: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role: {', '.join(roles)}")
        return user

    return checker


HR_ROLES = ("ADMIN", "HR")
MGMT_ROLES = ("ADMIN", "HR", "MANAGER")


def visible_employee_ids(db: Session, user: User) -> list[int] | None:
    """Row-level scoping. None = unrestricted (ADMIN/HR)."""
    if user.role in HR_ROLES:
        return None
    if user.role == "MANAGER" and user.employee_id:
        me = db.get(Employee, user.employee_id)
        conds = [Employee.manager_id == user.employee_id]
        if me and me.department_id:
            conds.append(Employee.department_id == me.department_id)
        q = db.query(Employee.id).filter(or_(*conds))
        return list({r[0] for r in q.all()} | {user.employee_id})
    return [user.employee_id] if user.employee_id else []


def ensure_can_view_employee(db: Session, user: User, employee_id: int):
    ids = visible_employee_ids(db, user)
    if ids is not None and employee_id not in ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot access this employee's data")
