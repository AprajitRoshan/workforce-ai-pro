# Database Schema

Generated from the SQLAlchemy models in `backend/app/models.py`. Works on SQLite (default) and MySQL 8.

**24 tables**

## `departments`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| name | VARCHAR(80) | no | UNIQUE |  |
| code | VARCHAR(10) | no | UNIQUE |  |
| description | TEXT | yes |  |  |
| head_id | INTEGER | yes |  | employees.id |
| budget | FLOAT | no |  |  |
| created_at | DATETIME | no |  |  |

UNIQUE(name) · UNIQUE(code)

## `leave_policies`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| leave_type | VARCHAR(20) | no | UNIQUE |  |
| annual_quota | INTEGER | no |  |  |
| carry_forward | BOOLEAN | no |  |  |
| max_consecutive_days | INTEGER | no |  |  |
| requires_document | BOOLEAN | no |  |  |
| description | TEXT | yes |  |  |

UNIQUE(leave_type)

## `shifts`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| name | VARCHAR(40) | no | UNIQUE |  |
| start_time | TIME | no |  |  |
| end_time | TIME | no |  |  |
| grace_minutes | INTEGER | no |  |  |

UNIQUE(name)

## `job_roles`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| title | VARCHAR(80) | no |  |  |
| department_id | INTEGER | yes |  | departments.id |
| level | INTEGER | no |  |  |
| min_salary | FLOAT | no |  |  |
| max_salary | FLOAT | no |  |  |

## `employees`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| employee_code | VARCHAR(20) | no | UNIQUE |  |
| first_name | VARCHAR(60) | no |  |  |
| last_name | VARCHAR(60) | no |  |  |
| email | VARCHAR(120) | no | UNIQUE |  |
| phone | VARCHAR(30) | yes |  |  |
| gender | VARCHAR(10) | yes |  |  |
| date_of_birth | DATE | yes |  |  |
| marital_status | VARCHAR(12) | no |  |  |
| education | INTEGER | no |  |  |
| address | TEXT | yes |  |  |
| hire_date | DATE | no | INDEX |  |
| termination_date | DATE | yes | INDEX |  |
| termination_reason | VARCHAR(120) | yes |  |  |
| status | VARCHAR(15) | no | INDEX |  |
| department_id | INTEGER | yes | INDEX | departments.id |
| job_role_id | INTEGER | yes |  | job_roles.id |
| manager_id | INTEGER | yes | INDEX | employees.id |
| salary | FLOAT | no |  |  |
| job_satisfaction | INTEGER | no |  |  |
| environment_satisfaction | INTEGER | no |  |  |
| work_life_balance | INTEGER | no |  |  |
| job_involvement | INTEGER | no |  |  |
| distance_from_home | INTEGER | no |  |  |
| num_companies_worked | INTEGER | no |  |  |
| years_since_last_promotion | INTEGER | no |  |  |
| training_times_last_year | INTEGER | no |  |  |
| stock_option_level | INTEGER | no |  |  |
| risk_score | FLOAT | yes | INDEX |  |
| risk_level | VARCHAR(10) | yes | INDEX |  |
| created_at | DATETIME | no |  |  |
| updated_at | DATETIME | no |  |  |

## `attendance`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| employee_id | INTEGER | no | INDEX | employees.id |
| date | DATE | no | INDEX |  |
| check_in | DATETIME | yes |  |  |
| check_out | DATETIME | yes |  |  |
| hours_worked | FLOAT | no |  |  |
| overtime_hours | FLOAT | no |  |  |
| status | VARCHAR(12) | no |  |  |

UNIQUE(employee_id, date) · INDEX ix_att_date_status(date, status)

## `bonus_entries`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| employee_id | INTEGER | no | INDEX | employees.id |
| period | VARCHAR(7) | no | INDEX |  |
| kind | VARCHAR(12) | no |  |  |
| amount | FLOAT | no |  |  |
| reason | VARCHAR(200) | yes |  |  |
| created_at | DATETIME | no |  |  |

## `goals`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| employee_id | INTEGER | no | INDEX | employees.id |
| title | VARCHAR(150) | no |  |  |
| description | TEXT | yes |  |  |
| target_date | DATE | yes |  |  |
| progress | INTEGER | no |  |  |
| status | VARCHAR(12) | no |  |  |
| created_at | DATETIME | no |  |  |

## `payrolls`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| employee_id | INTEGER | no | INDEX | employees.id |
| period | VARCHAR(7) | no | INDEX |  |
| basic | FLOAT | no |  |  |
| hra | FLOAT | no |  |  |
| allowances | FLOAT | no |  |  |
| overtime_pay | FLOAT | no |  |  |
| bonus | FLOAT | no |  |  |
| incentives | FLOAT | no |  |  |
| gross | FLOAT | no |  |  |
| tax | FLOAT | no |  |  |
| pf | FLOAT | no |  |  |
| unpaid_leave_deduction | FLOAT | no |  |  |
| total_deductions | FLOAT | no |  |  |
| net | FLOAT | no |  |  |
| status | VARCHAR(10) | no |  |  |
| generated_at | DATETIME | no |  |  |

UNIQUE(employee_id, period)

## `predictions`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| employee_id | INTEGER | no |  | employees.id |
| model_version | INTEGER | no |  |  |
| risk_score | FLOAT | no |  |  |
| risk_level | VARCHAR(10) | no | INDEX |  |
| confidence | FLOAT | no |  |  |
| top_factors | JSON | no |  |  |
| batch_id | VARCHAR(40) | yes | INDEX |  |
| created_at | DATETIME | no |  |  |

INDEX ix_pred_emp_created(employee_id, created_at)

## `risk_logs`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| employee_id | INTEGER | no | INDEX | employees.id |
| old_score | FLOAT | yes |  |  |
| new_score | FLOAT | no |  |  |
| old_level | VARCHAR(10) | yes |  |  |
| new_level | VARCHAR(10) | no |  |  |
| change | FLOAT | no |  |  |
| event | VARCHAR(20) | no |  |  |
| created_at | DATETIME | no | INDEX |  |

## `shift_assignments`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| employee_id | INTEGER | no | INDEX | employees.id |
| shift_id | INTEGER | no |  | shifts.id |
| start_date | DATE | no |  |  |
| end_date | DATE | yes |  |  |

## `users`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| email | VARCHAR(120) | no | UNIQUE |  |
| full_name | VARCHAR(120) | no |  |  |
| password_hash | VARCHAR(128) | no |  |  |
| role | VARCHAR(20) | no | INDEX |  |
| is_active | BOOLEAN | no |  |  |
| employee_id | INTEGER | yes |  | employees.id |
| token_version | INTEGER | no |  |  |
| reset_token | VARCHAR(128) | yes | INDEX |  |
| reset_token_expires | DATETIME | yes |  |  |
| last_login | DATETIME | yes |  |  |
| last_seen | DATETIME | yes |  |  |
| created_at | DATETIME | no |  |  |

## `activity_logs`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| user_id | INTEGER | yes | INDEX | users.id |
| action | VARCHAR(40) | no | INDEX |  |
| entity_type | VARCHAR(30) | no | INDEX |  |
| entity_id | INTEGER | yes |  |  |
| summary | VARCHAR(300) | no |  |  |
| changes | JSON | no |  |  |
| ip_address | VARCHAR(45) | yes |  |  |
| created_at | DATETIME | no | INDEX |  |

## `chat_messages`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| sender_id | INTEGER | no |  | users.id |
| receiver_id | INTEGER | no | INDEX | users.id |
| content | TEXT | no |  |  |
| created_at | DATETIME | no | INDEX |  |
| delivered_at | DATETIME | yes |  |  |
| read_at | DATETIME | yes |  |  |

INDEX ix_chat_pair(sender_id, receiver_id)

## `datasets`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| name | VARCHAR(100) | no | INDEX |  |
| version | INTEGER | no |  |  |
| filename | VARCHAR(200) | no |  |  |
| checksum | VARCHAR(64) | no |  |  |
| total_records | INTEGER | no |  |  |
| valid_records | INTEGER | no |  |  |
| duplicate_records | INTEGER | no |  |  |
| failed_records | INTEGER | no |  |  |
| attrition_rate | FLOAT | no |  |  |
| status | VARCHAR(12) | no |  |  |
| notes | TEXT | yes |  |  |
| uploaded_by | INTEGER | yes |  | users.id |
| created_at | DATETIME | no |  |  |

UNIQUE(name, version)

## `documents`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| employee_id | INTEGER | no | INDEX | employees.id |
| uploaded_by | INTEGER | yes |  | users.id |
| doc_type | VARCHAR(20) | no |  |  |
| title | VARCHAR(150) | no |  |  |
| original_name | VARCHAR(200) | no |  |  |
| stored_name | VARCHAR(200) | no |  |  |
| content_type | VARCHAR(100) | no |  |  |
| size | INTEGER | no |  |  |
| checksum | VARCHAR(64) | no |  |  |
| created_at | DATETIME | no |  |  |

## `interventions`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| employee_id | INTEGER | no | INDEX | employees.id |
| created_by | INTEGER | yes |  | users.id |
| owner_id | INTEGER | yes |  | users.id |
| action_type | VARCHAR(30) | no |  |  |
| recommendation | TEXT | no |  |  |
| notes | TEXT | yes |  |  |
| status | VARCHAR(12) | no | INDEX |  |
| follow_up_date | DATE | yes |  |  |
| outcome | TEXT | yes |  |  |
| risk_at_creation | FLOAT | yes |  |  |
| created_at | DATETIME | no |  |  |
| updated_at | DATETIME | no |  |  |

## `leave_requests`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| employee_id | INTEGER | no | INDEX | employees.id |
| leave_type | VARCHAR(20) | no |  |  |
| start_date | DATE | no |  |  |
| end_date | DATE | no |  |  |
| days | FLOAT | no |  |  |
| reason | TEXT | yes |  |  |
| status | VARCHAR(12) | no | INDEX |  |
| approver_id | INTEGER | yes |  | users.id |
| approver_comment | TEXT | yes |  |  |
| decided_at | DATETIME | yes |  |  |
| created_at | DATETIME | no |  |  |

## `notifications`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| user_id | INTEGER | no |  | users.id |
| title | VARCHAR(150) | no |  |  |
| message | TEXT | no |  |  |
| type | VARCHAR(10) | no |  |  |
| category | VARCHAR(12) | no |  |  |
| priority | VARCHAR(10) | no |  |  |
| link | VARCHAR(200) | yes |  |  |
| is_read | BOOLEAN | no |  |  |
| is_ai | BOOLEAN | no |  |  |
| escalated | BOOLEAN | no |  |  |
| created_at | DATETIME | no | INDEX |  |

INDEX ix_notif_user_read(user_id, is_read)

## `performance_reviews`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| employee_id | INTEGER | no | INDEX | employees.id |
| reviewer_id | INTEGER | yes |  | users.id |
| period | VARCHAR(10) | no |  |  |
| rating | FLOAT | no |  |  |
| quality | INTEGER | no |  |  |
| productivity | INTEGER | no |  |  |
| teamwork | INTEGER | no |  |  |
| strengths | TEXT | yes |  |  |
| improvements | TEXT | yes |  |  |
| comments | TEXT | yes |  |  |
| created_at | DATETIME | no |  |  |

## `tasks`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| title | VARCHAR(150) | no |  |  |
| description | TEXT | yes |  |  |
| workflow | VARCHAR(20) | no |  |  |
| assignee_id | INTEGER | no | INDEX | employees.id |
| assigned_by | INTEGER | yes |  | users.id |
| status | VARCHAR(12) | no | INDEX |  |
| priority | VARCHAR(10) | no |  |  |
| due_date | DATE | yes | INDEX |  |
| completed_at | DATETIME | yes |  |  |
| created_at | DATETIME | no |  |  |

## `dataset_failed_records`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| dataset_id | INTEGER | no | INDEX | datasets.id |
| row_number | INTEGER | no |  |  |
| kind | VARCHAR(10) | no |  |  |
| reason | TEXT | no |  |  |
| raw | JSON | no |  |  |

## `model_versions`

| Column | Type | Null | Key | References |
|---|---|---|---|---|
| id | INTEGER | no | PK |  |
| version | INTEGER | no | UNIQUE |  |
| dataset_id | INTEGER | yes |  | datasets.id |
| algorithm | VARCHAR(60) | no |  |  |
| path | VARCHAR(300) | no |  |  |
| metrics | JSON | no |  |  |
| feature_importance | JSON | no |  |  |
| is_active | BOOLEAN | no |  |  |
| trained_at | DATETIME | no |  |  |

UNIQUE(version)

