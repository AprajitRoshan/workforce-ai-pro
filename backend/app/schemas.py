from datetime import date, time
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

Role = Literal["ADMIN", "HR", "MANAGER", "EMPLOYEE"]


def _strong_password(v: str) -> str:
    if len(v) < 8 or not any(c.isdigit() for c in v) or not any(c.isalpha() for c in v):
        raise ValueError("Password must be at least 8 characters and contain letters and numbers")
    return v


# ---------------------------------------------------------------- auth
class RegisterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str
    _pw = field_validator("password")(_strong_password)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    new_password: str
    _pw = field_validator("new_password")(_strong_password)


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str
    _pw = field_validator("new_password")(_strong_password)


class UserCreateIn(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    role: Role = "EMPLOYEE"
    employee_id: int | None = None
    _pw = field_validator("password")(_strong_password)


class UserUpdateIn(BaseModel):
    full_name: str | None = None
    role: Role | None = None
    is_active: bool | None = None
    employee_id: int | None = None


# ---------------------------------------------------------------- org
class DepartmentIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    code: str = Field(min_length=2, max_length=10)
    description: str | None = None
    head_id: int | None = None
    budget: float = 0


class JobRoleIn(BaseModel):
    title: str
    department_id: int | None = None
    level: int = Field(1, ge=1, le=5)
    min_salary: float = 0
    max_salary: float = 0


class EmployeeIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=60)
    last_name: str = Field(min_length=1, max_length=60)
    email: EmailStr
    phone: str | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    marital_status: str = "Single"
    education: int = Field(3, ge=1, le=5)
    address: str | None = None
    hire_date: date
    status: Literal["ACTIVE", "ON_LEAVE", "RESIGNED", "TERMINATED"] = "ACTIVE"
    department_id: int | None = None
    job_role_id: int | None = None
    manager_id: int | None = None
    salary: float = Field(0, ge=0)
    job_satisfaction: int = Field(3, ge=1, le=4)
    environment_satisfaction: int = Field(3, ge=1, le=4)
    work_life_balance: int = Field(3, ge=1, le=4)
    job_involvement: int = Field(3, ge=1, le=4)
    distance_from_home: int = Field(10, ge=0, le=200)
    num_companies_worked: int = Field(1, ge=0, le=30)
    years_since_last_promotion: int = Field(1, ge=0, le=40)
    training_times_last_year: int = Field(2, ge=0, le=20)
    stock_option_level: int = Field(0, ge=0, le=3)
    termination_date: date | None = None
    termination_reason: str | None = None


class EmployeeUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    gender: str | None = None
    date_of_birth: date | None = None
    marital_status: str | None = None
    education: int | None = Field(None, ge=1, le=5)
    address: str | None = None
    hire_date: date | None = None
    status: Literal["ACTIVE", "ON_LEAVE", "RESIGNED", "TERMINATED"] | None = None
    department_id: int | None = None
    job_role_id: int | None = None
    manager_id: int | None = None
    salary: float | None = Field(None, ge=0)
    job_satisfaction: int | None = Field(None, ge=1, le=4)
    environment_satisfaction: int | None = Field(None, ge=1, le=4)
    work_life_balance: int | None = Field(None, ge=1, le=4)
    job_involvement: int | None = Field(None, ge=1, le=4)
    distance_from_home: int | None = Field(None, ge=0, le=200)
    num_companies_worked: int | None = Field(None, ge=0, le=30)
    years_since_last_promotion: int | None = Field(None, ge=0, le=40)
    training_times_last_year: int | None = Field(None, ge=0, le=20)
    stock_option_level: int | None = Field(None, ge=0, le=3)
    termination_date: date | None = None
    termination_reason: str | None = None


class ProfileUpdate(BaseModel):
    """Fields an employee may edit on their own profile."""
    phone: str | None = None
    address: str | None = None
    marital_status: str | None = None


class AssignRoleIn(BaseModel):
    employee_ids: list[int]
    department_id: int | None = None
    job_role_id: int | None = None


# ---------------------------------------------------------------- attendance
class ShiftIn(BaseModel):
    name: str
    start_time: time
    end_time: time
    grace_minutes: int = 15


class ShiftAssignIn(BaseModel):
    employee_ids: list[int]
    shift_id: int
    start_date: date
    end_date: date | None = None


# ---------------------------------------------------------------- leave
class LeaveApplyIn(BaseModel):
    leave_type: str
    start_date: date
    end_date: date
    reason: str | None = None


class LeaveDecisionIn(BaseModel):
    approve: bool
    comment: str | None = None


class LeavePolicyIn(BaseModel):
    leave_type: str
    annual_quota: int = Field(ge=0, le=365)
    carry_forward: bool = False
    max_consecutive_days: int = 10
    requires_document: bool = False
    description: str | None = None


# ---------------------------------------------------------------- payroll
class PayrollGenerateIn(BaseModel):
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    employee_ids: list[int] | None = None


class BonusIn(BaseModel):
    employee_id: int
    period: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    kind: Literal["BONUS", "INCENTIVE"] = "BONUS"
    amount: float = Field(gt=0)
    reason: str | None = None


# ---------------------------------------------------------------- chat / notifications
class ChatSendIn(BaseModel):
    receiver_id: int
    content: str = Field(min_length=1, max_length=4000)


class BroadcastIn(BaseModel):
    title: str
    message: str
    roles: list[Role] = ["EMPLOYEE", "MANAGER", "HR", "ADMIN"]
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "MEDIUM"


# ---------------------------------------------------------------- AI
class PredictIn(BaseModel):
    employee_ids: list[int] | None = None
    department_id: int | None = None


class InterventionIn(BaseModel):
    employee_id: int
    action_type: str
    recommendation: str
    notes: str | None = None
    owner_id: int | None = None
    follow_up_date: date | None = None


class InterventionUpdate(BaseModel):
    status: Literal["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"] | None = None
    notes: str | None = None
    outcome: str | None = None
    follow_up_date: date | None = None
    owner_id: int | None = None


# ---------------------------------------------------------------- tasks / performance
class TaskIn(BaseModel):
    title: str = Field(min_length=2, max_length=150)
    description: str | None = None
    workflow: Literal["GENERAL", "ONBOARDING", "OFFBOARDING", "REVIEW", "RETENTION"] = "GENERAL"
    assignee_id: int
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "MEDIUM"
    due_date: date | None = None


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: Literal["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] | None = None
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] | None = None
    due_date: date | None = None
    assignee_id: int | None = None


class ReviewIn(BaseModel):
    employee_id: int
    period: str
    rating: float = Field(ge=1, le=5)
    quality: int = Field(3, ge=1, le=5)
    productivity: int = Field(3, ge=1, le=5)
    teamwork: int = Field(3, ge=1, le=5)
    strengths: str | None = None
    improvements: str | None = None
    comments: str | None = None


class GoalIn(BaseModel):
    employee_id: int
    title: str
    description: str | None = None
    target_date: date | None = None
    progress: int = Field(0, ge=0, le=100)


class GoalUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    target_date: date | None = None
    progress: int | None = Field(None, ge=0, le=100)
    status: Literal["ACTIVE", "ACHIEVED", "MISSED"] | None = None
