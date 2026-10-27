# Test Results

Run with `cd backend && .venv\Scripts\python -m pytest -v` — each run uses an isolated temporary database and storage folder.

**Run date:** 2026-10-21 12:28  
**Result:** 28 passed in 5.85s

| Area | What is verified |
|---|---|
| Auth (Module 1) | register/login/me/refresh, weak-password & duplicate rejection, expired-token header, refresh-token misuse, forgot/reset flow revokes old sessions, no account enumeration |
| RBAC (Module 26) | employee scoped to self without AI risk, manager scoped to own department, role change forces re-login |
| Core HR (2-6, 9, 21, 22) | employee CRUD + multi-filter search + field-level audit, department stats, check-in/out guards, leave overlap/balance/self-approval rules, tax slabs, payroll arithmetic, payslip PDF, document signature/duplicate validation, task permissions, workflows, reviews & goals |
| AI (11-17, 27) | dataset validation (duplicates/invalid rows), upload→train→predict, prediction ranges & sorting, what-if simulation direction, forecast confidence bands, stability scores, interventions, alert engine |
| Realtime & export (8, 18, 19) | WebSocket chat delivery + read receipts, bad-token rejection, PDF/XLSX/JSON exports |

```
collecting ... collected 28 items

tests/test_ai_and_realtime.py::test_dataset_validation_reports_failures PASSED [  3%]
tests/test_ai_and_realtime.py::test_dataset_missing_columns PASSED       [  7%]
tests/test_ai_and_realtime.py::test_upload_train_predict_flow PASSED     [ 10%]
tests/test_ai_and_realtime.py::test_prediction_outputs_are_well_formed PASSED [ 14%]
tests/test_ai_and_realtime.py::test_what_if_simulation_moves_risk_in_expected_direction PASSED [ 17%]
tests/test_ai_and_realtime.py::test_forecast_and_stability PASSED        [ 21%]
tests/test_ai_and_realtime.py::test_interventions_and_alert_engine PASSED [ 25%]
tests/test_ai_and_realtime.py::test_websocket_chat_and_read_receipts PASSED [ 28%]
tests/test_ai_and_realtime.py::test_websocket_rejects_bad_token PASSED   [ 32%]
tests/test_ai_and_realtime.py::test_report_exports PASSED                [ 35%]
tests/test_auth_rbac.py::test_register_login_me_refresh PASSED           [ 39%]
tests/test_auth_rbac.py::test_register_validation PASSED                 [ 42%]
tests/test_auth_rbac.py::test_wrong_password_and_missing_token PASSED    [ 46%]
tests/test_auth_rbac.py::test_expired_token_is_rejected PASSED           [ 50%]
tests/test_auth_rbac.py::test_refresh_token_cannot_be_used_as_access PASSED [ 53%]
tests/test_auth_rbac.py::test_forgot_and_reset_password_revokes_sessions PASSED [ 57%]
tests/test_auth_rbac.py::test_rbac_employee_restrictions PASSED          [ 60%]
tests/test_auth_rbac.py::test_rbac_manager_sees_only_team PASSED         [ 64%]
tests/test_auth_rbac.py::test_admin_role_change_forces_relogin PASSED    [ 67%]
tests/test_core_hr.py::test_employee_crud_search_and_audit PASSED        [ 71%]
tests/test_core_hr.py::test_department_crud_and_stats PASSED             [ 75%]
tests/test_core_hr.py::test_attendance_check_in_out PASSED               [ 78%]
tests/test_core_hr.py::test_leave_workflow PASSED                        [ 82%]
tests/test_core_hr.py::test_tax_slabs PASSED                             [ 85%]
tests/test_core_hr.py::test_payroll_generation_and_payslip PASSED        [ 89%]
tests/test_core_hr.py::test_document_validation PASSED                   [ 92%]
tests/test_core_hr.py::test_tasks_and_workflow PASSED                    [ 96%]
tests/test_core_hr.py::test_reviews_and_goals PASSED                     [100%]

============================= 28 passed in 5.85s ==============================
```
