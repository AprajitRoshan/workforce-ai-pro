from datetime import date, datetime, time

from sqlalchemy import (JSON, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text,
                        Time, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def now():
    return datetime.now()


# ---------------------------------------------------------------- Auth / RBAC
class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(20), default="EMPLOYEE", index=True)  # ADMIN|HR|MANAGER|EMPLOYEE
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    employee_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), nullable=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)  # bump to invalidate all sessions
    reset_token: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    reset_token_expires: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_login: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employee: Mapped["Employee | None"] = relationship(foreign_keys=[employee_id])


# ---------------------------------------------------------------- Org structure
class Department(Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    code: Mapped[str] = mapped_column(String(10), unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    head_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL", use_alter=True), nullable=True)
    budget: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employees: Mapped[list["Employee"]] = relationship(back_populates="department", foreign_keys="Employee.department_id")
    head: Mapped["Employee | None"] = relationship(foreign_keys=[head_id], post_update=True)


class JobRole(Base):
    __tablename__ = "job_roles"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(80))
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"), nullable=True)
    level: Mapped[int] = mapped_column(Integer, default=1)  # 1 junior .. 5 executive
    min_salary: Mapped[float] = mapped_column(Float, default=0)
    max_salary: Mapped[float] = mapped_column(Float, default=0)

    department: Mapped["Department | None"] = relationship()


class Employee(Base):
    __tablename__ = "employees"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    first_name: Mapped[str] = mapped_column(String(60))
    last_name: Mapped[str] = mapped_column(String(60))
    email: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    gender: Mapped[str | None] = mapped_column(String(10), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    marital_status: Mapped[str] = mapped_column(String(12), default="Single")
    education: Mapped[int] = mapped_column(Integer, default=3)  # 1..5
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    hire_date: Mapped[date] = mapped_column(Date, index=True)
    termination_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    termination_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(15), default="ACTIVE", index=True)  # ACTIVE|ON_LEAVE|RESIGNED|TERMINATED
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"), nullable=True, index=True)
    job_role_id: Mapped[int | None] = mapped_column(ForeignKey("job_roles.id", ondelete="SET NULL"), nullable=True)
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True)
    salary: Mapped[float] = mapped_column(Float, default=0)  # monthly CTC
    # Engagement signals used by the attrition model (1 = low .. 4 = high)
    job_satisfaction: Mapped[int] = mapped_column(Integer, default=3)
    environment_satisfaction: Mapped[int] = mapped_column(Integer, default=3)
    work_life_balance: Mapped[int] = mapped_column(Integer, default=3)
    job_involvement: Mapped[int] = mapped_column(Integer, default=3)
    distance_from_home: Mapped[int] = mapped_column(Integer, default=10)  # km
    num_companies_worked: Mapped[int] = mapped_column(Integer, default=1)
    years_since_last_promotion: Mapped[int] = mapped_column(Integer, default=1)
    training_times_last_year: Mapped[int] = mapped_column(Integer, default=2)
    stock_option_level: Mapped[int] = mapped_column(Integer, default=0)
    # Cached latest AI risk (denormalised for fast filtering)
    risk_score: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    risk_level: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    department: Mapped["Department | None"] = relationship(back_populates="employees", foreign_keys=[department_id])
    job_role: Mapped["JobRole | None"] = relationship()
    manager: Mapped["Employee | None"] = relationship(remote_side=[id])

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


# ---------------------------------------------------------------- Attendance & shifts
class Shift(Base):
    __tablename__ = "shifts"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40), unique=True)
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    grace_minutes: Mapped[int] = mapped_column(Integer, default=15)


class ShiftAssignment(Base):
    __tablename__ = "shift_assignments"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    shift_id: Mapped[int] = mapped_column(ForeignKey("shifts.id", ondelete="CASCADE"))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    shift: Mapped["Shift"] = relationship()
    employee: Mapped["Employee"] = relationship()


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("employee_id", "date"), Index("ix_att_date_status", "date", "status"))
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    check_in: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    check_out: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    hours_worked: Mapped[float] = mapped_column(Float, default=0)
    overtime_hours: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(12), default="PRESENT")  # PRESENT|LATE|ABSENT|HALF_DAY|ON_LEAVE

    employee: Mapped["Employee"] = relationship()


# ---------------------------------------------------------------- Leave
class LeavePolicy(Base):
    __tablename__ = "leave_policies"
    id: Mapped[int] = mapped_column(primary_key=True)
    leave_type: Mapped[str] = mapped_column(String(20), unique=True)  # ANNUAL|SICK|CASUAL|UNPAID|MATERNITY
    annual_quota: Mapped[int] = mapped_column(Integer, default=12)
    carry_forward: Mapped[bool] = mapped_column(Boolean, default=False)
    max_consecutive_days: Mapped[int] = mapped_column(Integer, default=10)
    requires_document: Mapped[bool] = mapped_column(Boolean, default=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class LeaveRequest(Base):
    __tablename__ = "leave_requests"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    leave_type: Mapped[str] = mapped_column(String(20))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    days: Mapped[float] = mapped_column(Float)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="PENDING", index=True)  # PENDING|APPROVED|REJECTED|CANCELLED
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approver_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employee: Mapped["Employee"] = relationship()
    approver: Mapped["User | None"] = relationship()


# ---------------------------------------------------------------- Payroll
class BonusEntry(Base):
    __tablename__ = "bonus_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)  # YYYY-MM
    kind: Mapped[str] = mapped_column(String(12), default="BONUS")  # BONUS|INCENTIVE
    amount: Mapped[float] = mapped_column(Float)
    reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employee: Mapped["Employee"] = relationship()


class Payroll(Base):
    __tablename__ = "payrolls"
    __table_args__ = (UniqueConstraint("employee_id", "period"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)
    basic: Mapped[float] = mapped_column(Float)
    hra: Mapped[float] = mapped_column(Float)
    allowances: Mapped[float] = mapped_column(Float)
    overtime_pay: Mapped[float] = mapped_column(Float, default=0)
    bonus: Mapped[float] = mapped_column(Float, default=0)
    incentives: Mapped[float] = mapped_column(Float, default=0)
    gross: Mapped[float] = mapped_column(Float)
    tax: Mapped[float] = mapped_column(Float)
    pf: Mapped[float] = mapped_column(Float)
    unpaid_leave_deduction: Mapped[float] = mapped_column(Float, default=0)
    total_deductions: Mapped[float] = mapped_column(Float)
    net: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(10), default="GENERATED")  # GENERATED|PAID
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employee: Mapped["Employee"] = relationship()


# ---------------------------------------------------------------- Notifications & chat
class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notif_user_read", "user_id", "is_read"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(150))
    message: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(10), default="INFO")  # INFO|SUCCESS|WARNING|ALERT
    category: Mapped[str] = mapped_column(String(12), default="SYSTEM")  # SYSTEM|LEAVE|PAYROLL|RISK|TASK|CHAT|ATTENDANCE
    priority: Mapped[str] = mapped_column(String(10), default="LOW")  # LOW|MEDIUM|HIGH|CRITICAL
    link: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    is_ai: Mapped[bool] = mapped_column(Boolean, default=False)
    escalated: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (Index("ix_chat_pair", "sender_id", "receiver_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    receiver_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ---------------------------------------------------------------- Documents
class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    doc_type: Mapped[str] = mapped_column(String(20), default="OTHER")  # ID_PROOF|CONTRACT|CERTIFICATE|PAYSLIP|OTHER
    title: Mapped[str] = mapped_column(String(150))
    original_name: Mapped[str] = mapped_column(String(200))
    stored_name: Mapped[str] = mapped_column(String(200))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    checksum: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employee: Mapped["Employee"] = relationship()


# ---------------------------------------------------------------- AI: datasets, models, predictions
class Dataset(Base):
    __tablename__ = "datasets"
    __table_args__ = (UniqueConstraint("name", "version"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    filename: Mapped[str] = mapped_column(String(200))
    checksum: Mapped[str] = mapped_column(String(64))
    total_records: Mapped[int] = mapped_column(Integer, default=0)
    valid_records: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_records: Mapped[int] = mapped_column(Integer, default=0)
    failed_records: Mapped[int] = mapped_column(Integer, default=0)
    attrition_rate: Mapped[float] = mapped_column(Float, default=0)
    status: Mapped[str] = mapped_column(String(12), default="VALIDATED")  # VALIDATED|TRAINED|REJECTED
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class DatasetFailedRecord(Base):
    __tablename__ = "dataset_failed_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_id: Mapped[int] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True)
    row_number: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(10), default="INVALID")  # INVALID|DUPLICATE
    reason: Mapped[str] = mapped_column(Text)
    raw: Mapped[dict] = mapped_column(JSON, default=dict)


class ModelVersion(Base):
    __tablename__ = "model_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(Integer, unique=True)
    dataset_id: Mapped[int | None] = mapped_column(ForeignKey("datasets.id", ondelete="SET NULL"), nullable=True)
    algorithm: Mapped[str] = mapped_column(String(60))
    path: Mapped[str] = mapped_column(String(300))
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    feature_importance: Mapped[dict] = mapped_column(JSON, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    trained_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Prediction(Base):
    __tablename__ = "predictions"
    __table_args__ = (Index("ix_pred_emp_created", "employee_id", "created_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"))
    model_version: Mapped[int] = mapped_column(Integer)
    risk_score: Mapped[float] = mapped_column(Float)  # 0..100 probability of leaving
    risk_level: Mapped[str] = mapped_column(String(10), index=True)
    confidence: Mapped[float] = mapped_column(Float)  # 0..100
    top_factors: Mapped[list] = mapped_column(JSON, default=list)
    batch_id: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employee: Mapped["Employee"] = relationship()


class RiskLog(Base):
    __tablename__ = "risk_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    old_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    new_score: Mapped[float] = mapped_column(Float)
    old_level: Mapped[str | None] = mapped_column(String(10), nullable=True)
    new_level: Mapped[str] = mapped_column(String(10))
    change: Mapped[float] = mapped_column(Float, default=0)
    event: Mapped[str] = mapped_column(String(20), default="RESCORED")  # RESCORED|ESCALATED|DEESCALATED|NEW_HIGH_RISK
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)

    employee: Mapped["Employee"] = relationship()


class Intervention(Base):
    __tablename__ = "interventions"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action_type: Mapped[str] = mapped_column(String(30))  # ONE_ON_ONE|COMPENSATION_REVIEW|CAREER_PATH|WORKLOAD|TRAINING|RECOGNITION|FLEXIBLE_WORK
    recommendation: Mapped[str] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="OPEN", index=True)  # OPEN|IN_PROGRESS|COMPLETED|CANCELLED
    follow_up_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    risk_at_creation: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    employee: Mapped["Employee"] = relationship()
    owner: Mapped["User | None"] = relationship(foreign_keys=[owner_id])


# ---------------------------------------------------------------- Audit & activity
class ActivityLog(Base):
    __tablename__ = "activity_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(40), index=True)  # CREATE|UPDATE|DELETE|LOGIN|CHECK_IN|...
    entity_type: Mapped[str] = mapped_column(String(30), index=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    summary: Mapped[str] = mapped_column(String(300))
    changes: Mapped[dict] = mapped_column(JSON, default=dict)  # {"field": [old, new]}
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)

    user: Mapped["User | None"] = relationship()


# ---------------------------------------------------------------- Tasks & performance
class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    workflow: Mapped[str] = mapped_column(String(20), default="GENERAL")  # GENERAL|ONBOARDING|OFFBOARDING|REVIEW|RETENTION
    assignee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    assigned_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(12), default="TODO", index=True)  # TODO|IN_PROGRESS|BLOCKED|DONE
    priority: Mapped[str] = mapped_column(String(10), default="MEDIUM")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    assignee: Mapped["Employee"] = relationship()


class PerformanceReview(Base):
    __tablename__ = "performance_reviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    period: Mapped[str] = mapped_column(String(10))  # e.g. 2026-H1
    rating: Mapped[float] = mapped_column(Float)  # 1..5
    quality: Mapped[int] = mapped_column(Integer, default=3)
    productivity: Mapped[int] = mapped_column(Integer, default=3)
    teamwork: Mapped[int] = mapped_column(Integer, default=3)
    strengths: Mapped[str | None] = mapped_column(Text, nullable=True)
    improvements: Mapped[str | None] = mapped_column(Text, nullable=True)
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    employee: Mapped["Employee"] = relationship()
    reviewer: Mapped["User | None"] = relationship()


class Goal(Base):
    __tablename__ = "goals"
    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(ForeignKey("employees.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(150))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(12), default="ACTIVE")  # ACTIVE|ACHIEVED|MISSED
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
