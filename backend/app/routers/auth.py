from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Employee, User
from ..schemas import (ChangePasswordIn, ForgotIn, LoginIn, RefreshIn, RegisterIn, ResetIn, UserCreateIn,
                       UserUpdateIn)
from ..security import (create_access_token, create_refresh_token, get_current_user, hash_password,
                        new_reset_token, require_roles, user_from_token, verify_password)
from ..services.events import diff, log_activity, notify_roles
from ..utils import client_ip, employee_brief, paginate, user_dict

router = APIRouter(prefix="/api/auth", tags=["Auth"])
users_router = APIRouter(prefix="/api/users", tags=["Users & RBAC"])

PERMISSIONS = {
    "ADMIN": ["*"],
    "HR": ["employees:*", "departments:*", "attendance:*", "leave:*", "payroll:*", "documents:*", "ai:*",
           "reports:*", "tasks:*", "reviews:*", "audit:read", "notifications:broadcast"],
    "MANAGER": ["employees:team", "attendance:team", "leave:approve-team", "ai:team", "tasks:team",
                "reviews:team", "reports:team"],
    "EMPLOYEE": ["profile:self", "attendance:self", "leave:self", "payroll:self", "documents:self", "tasks:self",
                 "chat:*"],
}


def _session_payload(user: User, db: Session) -> dict:
    emp = db.get(Employee, user.employee_id) if user.employee_id else None
    return {"user": {**user_dict(user), "employee": employee_brief(emp), "permissions": PERMISSIONS[user.role]}}


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "An account with this email already exists")
    emp = db.query(Employee).filter(Employee.email == email).first()  # auto-link to HR record if one exists
    user = User(email=email, full_name=body.full_name, password_hash=hash_password(body.password),
                role="EMPLOYEE", employee_id=emp.id if emp else None)
    db.add(user)
    db.commit()
    log_activity(db, user, "REGISTER", "user", user.id, f"{user.full_name} registered", ip=client_ip(request))
    notify_roles(db, ("ADMIN",), "New user registered", f"{user.full_name} ({user.email}) created an account.",
                 category="SYSTEM")
    return {"access_token": create_access_token(user), "refresh_token": create_refresh_token(user),
            "token_type": "bearer", **_session_payload(user, db)}


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        log_activity(db, user, "LOGIN_FAILED", "user", user.id if user else None,
                     f"Failed login for {body.email}", ip=client_ip(request))
        raise HTTPException(401, "Invalid email or password")
    if not user.is_active:
        raise HTTPException(403, "Account is deactivated. Contact an administrator.")
    user.last_login = datetime.now()
    db.commit()
    log_activity(db, user, "LOGIN", "user", user.id, f"{user.full_name} logged in", ip=client_ip(request))
    return {"access_token": create_access_token(user), "refresh_token": create_refresh_token(user),
            "token_type": "bearer", "expires_in": settings.ACCESS_TOKEN_MINUTES * 60, **_session_payload(user, db)}


@router.post("/refresh")
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    user = user_from_token(db, body.refresh_token, expected_type="refresh")
    return {"access_token": create_access_token(user), "refresh_token": create_refresh_token(user),
            "token_type": "bearer", "expires_in": settings.ACCESS_TOKEN_MINUTES * 60}


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Session validation endpoint — returns 401 if the token is expired or revoked."""
    return _session_payload(user, db)


@router.post("/logout")
def logout(request: Request, all_devices: bool = False, user: User = Depends(get_current_user),
           db: Session = Depends(get_db)):
    if all_devices:
        user.token_version += 1  # invalidates every outstanding access/refresh token
        db.commit()
    log_activity(db, user, "LOGOUT", "user", user.id, f"{user.full_name} logged out", ip=client_ip(request))
    return {"ok": True}


@router.post("/forgot-password")
def forgot_password(body: ForgotIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower()).first()
    resp = {"message": "If that email is registered, a reset link has been sent."}
    if user:
        user.reset_token = new_reset_token()
        user.reset_token_expires = datetime.now() + timedelta(minutes=settings.RESET_TOKEN_MINUTES)
        db.commit()
        log_activity(db, user, "PASSWORD_RESET_REQUEST", "user", user.id, f"Password reset requested by {user.email}")
        if settings.DEV_MODE:  # no SMTP configured in development: hand the token back so the flow is testable
            resp["dev_reset_token"] = user.reset_token
    return resp


@router.post("/reset-password")
def reset_password(body: ResetIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.reset_token == body.token).first()
    if not user or not user.reset_token_expires or user.reset_token_expires < datetime.now():
        raise HTTPException(400, "Reset link is invalid or has expired")
    user.password_hash = hash_password(body.new_password)
    user.reset_token = None
    user.reset_token_expires = None
    user.token_version += 1
    db.commit()
    log_activity(db, user, "PASSWORD_RESET", "user", user.id, f"{user.email} reset their password")
    return {"message": "Password updated. Please sign in."}


@router.post("/change-password")
def change_password(body: ChangePasswordIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1
    db.commit()
    log_activity(db, user, "PASSWORD_CHANGE", "user", user.id, f"{user.full_name} changed password")
    return {"access_token": create_access_token(user), "refresh_token": create_refresh_token(user)}


# ---------------------------------------------------------------- user administration (RBAC)
@users_router.get("/roles")
def roles(_: User = Depends(get_current_user)):
    return [{"role": r, "permissions": p} for r, p in PERMISSIONS.items()]


@users_router.get("")
def list_users(q: str | None = None, role: str | None = None, page: int = 1, size: int = 20,
               _: User = Depends(require_roles("ADMIN", "HR")), db: Session = Depends(get_db)):
    query = db.query(User)
    if q:
        like = f"%{q}%"
        query = query.filter(User.full_name.ilike(like) | User.email.ilike(like))
    if role:
        query = query.filter(User.role == role)
    return paginate(query.order_by(User.created_at.desc()), page, size, user_dict)


@users_router.get("/directory")
def directory(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Lightweight list of active users (for chat contacts / owner pickers)."""
    rows = db.query(User).filter(User.is_active.is_(True), User.id != user.id).order_by(User.full_name).all()
    out = []
    for u in rows:
        emp = u.employee
        out.append({"id": u.id, "full_name": u.full_name, "role": u.role, "email": u.email,
                    "department": emp.department.name if emp and emp.department else None,
                    "job_title": emp.job_role.title if emp and emp.job_role else None})
    return out


@users_router.post("", status_code=201)
def create_user(body: UserCreateIn, admin: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email.lower()).first():
        raise HTTPException(409, "Email already in use")
    u = User(email=body.email.lower(), full_name=body.full_name, password_hash=hash_password(body.password),
             role=body.role, employee_id=body.employee_id)
    db.add(u)
    db.commit()
    log_activity(db, admin, "CREATE", "user", u.id, f"Created user {u.email} with role {u.role}")
    return user_dict(u)


@users_router.patch("/{user_id}")
def update_user(user_id: int, body: UserUpdateIn, admin: User = Depends(require_roles("ADMIN")),
                db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "User not found")
    data = body.model_dump(exclude_unset=True)
    if u.id == admin.id and (data.get("role", "ADMIN") != "ADMIN" or data.get("is_active") is False):
        raise HTTPException(400, "You cannot demote or deactivate your own account")
    changes = diff(u, data)
    for k, v in data.items():
        setattr(u, k, v)
    if "role" in changes or data.get("is_active") is False:
        u.token_version += 1  # force re-login so new permissions apply
    db.commit()
    log_activity(db, admin, "UPDATE", "user", u.id, f"Updated user {u.email}", changes)
    return user_dict(u)
