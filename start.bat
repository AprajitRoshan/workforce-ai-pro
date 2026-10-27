@echo off
REM Starts the WorkForce AI Pro backend (port 8000) and frontend (port 5173) in two windows.
cd /d "%~dp0"
if not exist "backend\workforce.db" (
  echo First run: seeding demo data...
  "backend\.venv\Scripts\python.exe" "backend\seed.py"
)
start "WorkForce AI Pro - API" cmd /k "cd /d "%~dp0backend" && .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000"
start "WorkForce AI Pro - Web" cmd /k "cd /d "%~dp0frontend" && npm run dev"
timeout /t 4 >nul
start "" http://localhost:5173
