# WorkForce AI Pro

HR Attrition Prediction & Workforce Intelligence Platform: a full-stack HR system (employees, attendance, leave, payroll, documents, chat) with an explainable machine-learning engine that predicts attrition risk, forecasts headcount and recommends retention actions.

| Layer | Stack |
|---|---|
| Backend | FastAPI · SQLAlchemy 2 · Pydantic 2 · JWT (PyJWT) · bcrypt · WebSockets |
| Database | SQLite by default, MySQL 8 ready (one env var) |
| AI / analytics | scikit-learn (RandomForest / GradientBoosting / LogisticRegression, auto-selected by ROC-AUC) · pandas · numpy |
| Frontend | React 19 (Vite 7) · Tailwind CSS 4 · Axios · Recharts · React Router 7 |
| Exports | reportlab (PDF) · openpyxl (Excel) |

---

## Quick start (Windows)

Prerequisites: **Python 3.12+** and **Node.js 20+**.

```bat
start.bat
```

`start.bat` seeds demo data on first run, starts the API and web app in two windows, and opens http://localhost:5173.

### Manual setup

```bash
# backend
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python seed.py            # demo company (use --reset to rebuild)
.venv\Scripts\python -m uvicorn app.main:app --port 8000

# frontend (second terminal)
cd frontend
npm install
npm run dev                             # http://localhost:5173 (proxies /api and /ws to :8000)
```

- Web app: http://localhost:5173
- Interactive API docs (Swagger): http://localhost:8000/docs · ReDoc: http://localhost:8000/redoc

### Demo accounts (local test data from `backend/seed.py`)

| Role | Email | Password |
|---|---|---|
| Admin | admin@workforce.ai | Admin@123 |
| HR | hr@workforce.ai | Hr@12345 |
| Manager (Head of Engineering) | manager@workforce.ai | Manager@123 |
| Employee (Software Engineer) | employee@workforce.ai | Employee@123 |
| Other linked staff | *(see Users page)* | Welcome@123 |

In dev mode the login page has one-click buttons for these accounts. Change or remove them before any real deployment.

---

## Switching to MySQL

1. Install MySQL 8 and create a database: `CREATE DATABASE workforce_ai CHARACTER SET utf8mb4;`
2. Copy `backend/.env.example` to `backend/.env` and set
   `DATABASE_URL=mysql+pymysql://USER:PASSWORD@localhost:3306/workforce_ai`
3. Run `python seed.py` (tables are created automatically), then start the API.

All queries go through SQLAlchemy using portable constructs (`CASE`, `extract`, string lengths on every column), so no code changes are needed.

---

## Module map (all 30 modules)

| # | Module | Backend | Frontend |
|---|---|---|---|
| 1 | Authentication & Authorization | `routers/auth.py`, `security.py`: register, JWT login, refresh, forgot/reset password, `/auth/me` session validation, token versioning for revocation, expiry header | Login / Register / Forgot / Reset pages; Axios interceptor auto-refreshes on 401 plus a proactive refresh timer |
| 2 | Employee Management | `routers/employees.py`: CRUD, search, filters, self-service profile | Employees list, profile with tabs, create/edit form |
| 3 | Department & Role Management | `routers/departments.py`: department CRUD, job roles, bulk assignment, stats | Departments page (cards, roles catalogue, bulk assign) |
| 4 | Attendance & Shift Management | `routers/attendance.py`: check-in/out, late detection by shift and grace period, hours, overtime, reports, shifts | Check-in widget, records, reports, shift planner |
| 5 | Leave Management | `routers/leaves.py`: apply (balance, overlap, max-days validation), approval workflow, carry-forward balance, policies, reports | My leave, approvals, policies, reports |
| 6 | Payroll Management | `services/payroll_calc.py`: Basic/HRA/allowance split, overtime pay, bonuses, unpaid-leave deduction, PF, slab tax + cess; PDF payslips | Payroll overview, payslips, bonuses |
| 7 | Notifications & Alerts | `routers/notifications.py`: in-app, read/unread, history, broadcast | Bell dropdown, toast alerts, Notifications page |
| 8 | One-to-One Chat | `routers/chat.py`: WebSocket `/ws`, history, read receipts, typing, presence, metadata-only communication logs | Messages page |
| 9 | Document Management | `routers/documents.py`: upload with extension, size, magic-byte and duplicate checks; download; delete | Documents page with drag-and-drop |
| 10 | Dashboard & Analytics | `/api/dashboard` (role-aware) | Management and employee dashboards |
| 11 | Dataset Management | `/api/ai/datasets`: upload, versioning, duplicate and invalid-row reporting, CSV template | Datasets & Models |
| 12 | AI Attrition Prediction | `ml/engine.py`: risk %, confidence (tree agreement), counterfactual top factors, department predictions, history | Risk Monitor, profile AI tab |
| 13 | Employee Risk Monitoring | `RiskLog` change tracking (escalated / de-escalated / new high risk), movers | Risk Monitor: logs, movers |
| 14 | Workforce Forecasting | `services/ai.py::forecast`: monthly and yearly projections, 95% band, baseline | Forecast & Stability |
| 15 | Attrition Analytics | `/api/analytics/attrition`: turnover, department, tenure, level, salary band, exit reasons | Attrition Analytics |
| 16 | HR Intervention & Decision Support | `/api/ai/interventions`: recommendations, follow-ups, outcome tracking, effectiveness | Interventions page, "Plan" buttons |
| 17 | Smart Notification & Alert Engine | `services/alert_engine.py`: risk escalation, burnout, absenteeism, stale approvals, overdue tasks, department instability, priorities, dedup | AI alerts tab, "Run alert engine" |
| 18 | Real-Time Workforce Monitoring | `/api/monitoring/live` plus WebSocket activity stream; instability detection against a 30-day baseline | Live Monitor |
| 19 | Reports & Export | `/api/reports/{employees,attrition,payroll,attendance}?format=pdf\|xlsx\|json` | Reports page with preview |
| 20 | Audit Logs & Activity | `ActivityLog` with field-level `{field: [old, new]}` diffs, IP, stats, per-entity history | Audit page, employee change history |
| 21 | Workflow & Task Management | `/api/tasks` with onboarding / offboarding / review / retention templates and due-date monitoring | Kanban board (drag and drop) and list |
| 22 | Performance Review | `/api/reviews`, `/api/goals` | Performance page |
| 23 | AI Recommendation Engine | Per-employee suggestions, optimisation tips, team and department insights | Recommendations page |
| 24 | Advanced Search & Filtering | Multi-filter employee search (department, status, risk, salary, attendance %, hire dates), payroll filters, global search | Employees advanced filters, top-bar search |
| 25 | Enterprise UI/UX | Reusable component kit (`components/ui.jsx`, `charts.jsx`), responsive layout, sidebar/navbar, skeletons, empty states, dark mode | — |
| 26 | RBAC | `require_roles`, row-level scoping (`visible_employee_ids`) for ADMIN / HR / MANAGER / EMPLOYEE | Role-filtered navigation and route guards |
| 27 | Workforce Stability Engine | Department stability score, growth prediction, retention forecast | Forecast & Stability |
| 28 | Optimization & Scalability | Indexed columns and composite indexes, joined eager loading, aggregate SQL, GZip, `X-Process-Time` header, connection pooling for MySQL | Lazy-loaded routes, vendor chunk splitting, SWR cache in `useApi` |
| 29 | Testing & Validation | `backend/tests`: 28 pytest tests (API, AI, WebSocket, exports) | Client-side form validation |
| 30 | Frontend–Backend Integration | — | Auth, Realtime and Toast contexts; global error and loading handling; live sync via WebSocket |

---

## AI engine notes

- **Training data**: the seed generates a 1,500-row historical dataset with 21 deliberately bad rows (invalid values and duplicates) so validation reporting has something to show. Upload your own CSV from *Datasets & Models*; the template download lists the required columns.
- **Model selection**: three candidate models are trained on an 80/20 stratified split, and the one with the best ROC-AUC is activated. Accuracy, precision, recall, F1 and permutation feature importance are stored for every model version.
- **Explainability**: each prediction stores its top drivers, measured by how much risk drops when that feature is reset to the population baseline. Recommendations are generated from those drivers.
- **Fairness**: age, gender and marital status are deliberately **not** model inputs.
- **What-if simulator**: re-scores an employee under hypothetical changes (for example a raise or less overtime) from the profile AI tab.

---

## Tests

```bash
cd backend
.venv\Scripts\python -m pytest -v
```

Latest results are in [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md). The database schema is in [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md).

## Project structure

```
backend/
  app/
    main.py            FastAPI app, middleware, router wiring
    config.py          settings (.env)
    database.py        engine/session (SQLite or MySQL)
    models.py          24 SQLAlchemy tables
    schemas.py         Pydantic request models
    security.py        JWT, bcrypt, RBAC helpers
    routers/           auth, employees, departments, attendance, leaves, payroll,
                       notifications, chat (+WebSocket), documents, ai, analytics, enterprise
    services/          ai, alert_engine, payroll_calc, exporters, events (audit/notify), realtime
    ml/engine.py       dataset validation, training, scoring, explanations
  seed.py              demo company generator
  tests/               pytest suite
frontend/
  src/
    api/client.js      Axios instance + token refresh
    context/           Auth, Realtime (WebSocket), Toast
    components/        Layout, UI kit, charts, RiskPanel, forms
    pages/             27 lazy-loaded pages (incl. pages/ai/*)
docs/                  database schema, test results
```
