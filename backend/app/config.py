import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

STORAGE_DIR = Path(os.getenv("STORAGE_DIR", BASE_DIR / "storage"))
UPLOAD_DIR = STORAGE_DIR / "uploads"
DATASET_DIR = STORAGE_DIR / "datasets"
MODEL_DIR = STORAGE_DIR / "models"
for _d in (STORAGE_DIR, UPLOAD_DIR, DATASET_DIR, MODEL_DIR):
    _d.mkdir(parents=True, exist_ok=True)


class Settings:
    APP_NAME = "WorkForce AI Pro"
    # SQLite by default. For MySQL use: mysql+pymysql://user:pass@localhost:3306/workforce_ai
    DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(BASE_DIR / 'workforce.db').as_posix()}")
    JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me-in-production-please")
    JWT_ALGORITHM = "HS256"
    ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "60"))
    REFRESH_TOKEN_DAYS = int(os.getenv("REFRESH_TOKEN_DAYS", "7"))
    RESET_TOKEN_MINUTES = 30
    # In dev there is no mail server, so the reset token is returned in the API response.
    DEV_MODE = os.getenv("DEV_MODE", "true").lower() == "true"
    CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    MAX_UPLOAD_MB = 10
    ALLOWED_DOC_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".doc", ".docx", ".txt", ".xlsx", ".csv"}
    # Payroll
    TAX_SLABS = [(250000, 0.0), (500000, 0.05), (1000000, 0.20), (float("inf"), 0.30)]  # annual
    PF_RATE = 0.12
    STANDARD_HOURS = 8.0
    # Risk thresholds (percent)
    RISK_MEDIUM = 25
    RISK_HIGH = 50
    RISK_CRITICAL = 70


settings = Settings()
