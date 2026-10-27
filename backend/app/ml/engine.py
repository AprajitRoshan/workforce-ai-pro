"""Attrition prediction engine: dataset validation, training, scoring and per-employee explanations.

Demographic attributes (age, gender, marital status) are intentionally NOT model features so that risk
scores are driven by job/engagement factors HR can act on, not protected characteristics.
"""
import hashlib
import io
from datetime import date, datetime, timedelta

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from ..config import MODEL_DIR, settings

DEPARTMENTS = ["Engineering", "Sales", "Marketing", "Human Resources", "Finance", "Operations", "Customer Support"]
NUMERIC = [
    "monthly_income", "years_at_company", "job_level", "job_satisfaction", "environment_satisfaction",
    "work_life_balance", "job_involvement", "performance_rating", "overtime_hours", "absence_rate",
    "distance_from_home", "num_companies_worked", "years_since_last_promotion", "training_times_last_year",
    "stock_option_level",
]
CATEGORICAL = ["department"]
FEATURES = NUMERIC + CATEGORICAL
TARGET = "attrition"

# column -> (min, max, integer?)
RANGES = {
    "monthly_income": (1000, 5_000_000, False), "years_at_company": (0, 50, False), "job_level": (1, 5, True),
    "job_satisfaction": (1, 4, True), "environment_satisfaction": (1, 4, True), "work_life_balance": (1, 4, True),
    "job_involvement": (1, 4, True), "performance_rating": (1, 5, False), "overtime_hours": (0, 200, False),
    "absence_rate": (0, 100, False), "distance_from_home": (0, 200, False), "num_companies_worked": (0, 30, True),
    "years_since_last_promotion": (0, 40, False), "training_times_last_year": (0, 20, True),
    "stock_option_level": (0, 3, True),
}

LEVEL_PAY = {1: 35000, 2: 60000, 3: 95000, 4: 150000, 5: 250000}
DEPT_EFFECT = {"Engineering": -0.15, "Sales": 0.45, "Marketing": 0.1, "Human Resources": 0.15, "Finance": -0.2,
               "Operations": 0.05, "Customer Support": 0.4}

# feature -> (label, direction that raises risk, intervention type, recommendation)
FACTOR_INFO = {
    "overtime_hours": ("High overtime load", "high", "WORKLOAD",
                       "Rebalance workload and cap overtime; review team staffing levels."),
    "job_satisfaction": ("Low job satisfaction", "low", "ONE_ON_ONE",
                         "Schedule a 1:1 engagement conversation to surface concerns and agree on actions."),
    "environment_satisfaction": ("Low environment satisfaction", "low", "ONE_ON_ONE",
                                 "Address team/environment issues; consider a team or project change."),
    "work_life_balance": ("Poor work-life balance", "low", "FLEXIBLE_WORK",
                          "Offer flexible hours or hybrid work days."),
    "job_involvement": ("Low job involvement", "low", "RECOGNITION",
                        "Assign visible, meaningful projects and recognise contributions."),
    "monthly_income": ("Below-band compensation", "low", "COMPENSATION_REVIEW",
                       "Benchmark salary against the role band and market; consider an adjustment."),
    "years_since_last_promotion": ("Stalled career progression", "high", "CAREER_PATH",
                                   "Hold a career-path discussion with a concrete promotion timeline."),
    "training_times_last_year": ("Limited learning opportunities", "low", "TRAINING",
                                 "Enrol in an upskilling or certification programme."),
    "distance_from_home": ("Long commute", "high", "FLEXIBLE_WORK", "Offer remote/hybrid options to cut commuting."),
    "absence_rate": ("Rising absenteeism", "high", "ONE_ON_ONE",
                     "Wellbeing check-in; review absence pattern and support needs."),
    "performance_rating": ("Low performance / recognition", "low", "RECOGNITION",
                           "Set clear goals with coaching; recognise improvements promptly."),
    "num_companies_worked": ("Frequent past job changes", "high", "CAREER_PATH",
                             "Build engagement via mentorship and a visible growth plan."),
    "stock_option_level": ("No long-term incentives", "low", "COMPENSATION_REVIEW",
                           "Consider a retention bonus or stock option grant."),
    "years_at_company": ("Early-tenure risk", "low", "ONE_ON_ONE",
                         "Strengthen onboarding: buddy programme and 30/60/90-day check-ins."),
    "job_level": ("Junior level / limited scope", "low", "CAREER_PATH",
                  "Expand responsibilities and outline the next-level criteria."),
    "department": ("Department-level turnover pressure", "n/a", "ONE_ON_ONE",
                   "Review department-wide engagement drivers with the department head."),
}


def risk_level(score: float) -> str:
    if score >= settings.RISK_CRITICAL:
        return "CRITICAL"
    if score >= settings.RISK_HIGH:
        return "HIGH"
    if score >= settings.RISK_MEDIUM:
        return "MEDIUM"
    return "LOW"


# ------------------------------------------------------------------ synthetic data
def _attrition_logit(r: dict, rng) -> float:
    pay_ratio = r["monthly_income"] / LEVEL_PAY[r["job_level"]]
    z = -1.15
    z += 0.055 * (r["overtime_hours"] - 12)
    z -= 0.5 * (r["job_satisfaction"] - 2.5)
    z -= 0.35 * (r["environment_satisfaction"] - 2.5)
    z -= 0.45 * (r["work_life_balance"] - 2.5)
    z -= 0.3 * (r["job_involvement"] - 2.5)
    z -= 1.8 * (pay_ratio - 1)
    z -= 0.1 * min(r["years_at_company"], 10)
    z += 0.5 if r["years_at_company"] < 1 else 0
    z += 0.14 * r["years_since_last_promotion"]
    z += 0.025 * r["distance_from_home"]
    z += 0.1 * r["num_companies_worked"]
    z -= 0.15 * r["training_times_last_year"]
    z -= 0.35 * r["stock_option_level"]
    z += 0.09 * r["absence_rate"]
    z -= 0.3 * (r["performance_rating"] - 3)
    z -= 0.2 * (r["job_level"] - 1)
    z += DEPT_EFFECT[r["department"]]
    return z + rng.normal(0, 0.45)


def synthetic_profile(rng) -> dict:
    level = int(rng.choice([1, 2, 3, 4, 5], p=[0.33, 0.3, 0.2, 0.12, 0.05]))
    yac = float(np.clip(rng.exponential(4.5), 0, 30))
    return {
        "department": str(rng.choice(DEPARTMENTS, p=[0.26, 0.18, 0.1, 0.07, 0.1, 0.15, 0.14])),
        "job_level": level,
        "monthly_income": round(float(LEVEL_PAY[level] * rng.lognormal(0, 0.18)), -2),
        "years_at_company": round(yac, 1),
        "job_satisfaction": int(rng.choice([1, 2, 3, 4], p=[0.18, 0.2, 0.32, 0.3])),
        "environment_satisfaction": int(rng.choice([1, 2, 3, 4], p=[0.17, 0.2, 0.33, 0.3])),
        "work_life_balance": int(rng.choice([1, 2, 3, 4], p=[0.08, 0.22, 0.55, 0.15])),
        "job_involvement": int(rng.choice([1, 2, 3, 4], p=[0.06, 0.25, 0.55, 0.14])),
        "performance_rating": float(rng.choice([2, 3, 3.5, 4, 4.5, 5], p=[0.07, 0.3, 0.2, 0.25, 0.12, 0.06])),
        "overtime_hours": round(float(rng.uniform(15, 45) if rng.random() < 0.25 else rng.uniform(0, 10)), 1),
        "absence_rate": round(float(np.clip(rng.gamma(1.6, 2.2), 0, 30)), 1),
        "distance_from_home": int(rng.integers(1, 30)),
        "num_companies_worked": int(np.clip(rng.poisson(2.2), 0, 9)),
        "years_since_last_promotion": round(float(min(yac, rng.poisson(2))), 1),
        "training_times_last_year": int(np.clip(rng.poisson(2.6), 0, 6)),
        "stock_option_level": int(rng.choice([0, 1, 2, 3], p=[0.43, 0.4, 0.11, 0.06])),
    }


def generate_synthetic_dataset(n: int = 1500, seed: int = 42, with_errors: bool = True) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(n):
        r = synthetic_profile(rng)
        p = 1 / (1 + np.exp(-_attrition_logit(r, rng)))
        r[TARGET] = "Yes" if rng.random() < p else "No"
        rows.append({"employee_code": f"HIST{i + 1:05d}", **r})
    df = pd.DataFrame(rows)
    if with_errors:  # realistic dirty data so validation/failed-record reporting has something to show
        bad = df.sample(12, random_state=seed).copy()
        bad.loc[bad.index[:4], "job_satisfaction"] = 7
        bad.loc[bad.index[4:7], "monthly_income"] = -500
        bad.loc[bad.index[7:9], "department"] = ""
        bad.loc[bad.index[9:12], TARGET] = "Maybe"
        bad["employee_code"] = [f"BAD{i:03d}" for i in range(len(bad))]
        dups = df.sample(9, random_state=seed + 1)
        df = pd.concat([df, bad, dups], ignore_index=True).sample(frac=1, random_state=seed).reset_index(drop=True)
    return df[["employee_code"] + FEATURES + [TARGET]]


# ------------------------------------------------------------------ validation
def validate_dataset(content: bytes):
    """Return (clean_df, failed list[{row_number, kind, reason, raw}], meta) or raise ValueError."""
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"Could not parse CSV: {e}")
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    missing = [c for c in FEATURES + [TARGET] if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")

    failed, keep, seen = [], [], set()
    for idx, row in df.iterrows():
        rownum = idx + 2  # header is line 1
        raw = {k: (None if pd.isna(v) else (v.item() if hasattr(v, "item") else v)) for k, v in row.items()}
        key = str(raw.get("employee_code")) if raw.get("employee_code") not in (None, "") else \
            hashlib.md5(str(sorted(raw.items())).encode()).hexdigest()
        if key in seen:
            failed.append({"row_number": rownum, "kind": "DUPLICATE", "reason": f"Duplicate record ({key})", "raw": raw})
            continue
        errors = []
        for col, (lo, hi, is_int) in RANGES.items():
            v = raw.get(col)
            try:
                fv = float(v)
                if np.isnan(fv):
                    raise ValueError
            except (TypeError, ValueError):
                errors.append(f"{col}: not a number")
                continue
            if not lo <= fv <= hi:
                errors.append(f"{col}: {fv:g} outside {lo}-{hi}")
            elif is_int and fv != int(fv):
                errors.append(f"{col}: must be an integer")
        dept = str(raw.get("department") or "").strip()
        if not dept:
            errors.append("department: required")
        tgt = str(raw.get(TARGET)).strip().lower()
        if tgt not in {"yes", "no", "1", "0", "true", "false", "1.0", "0.0"}:
            errors.append(f"attrition: '{raw.get(TARGET)}' is not Yes/No")
        if errors:
            failed.append({"row_number": rownum, "kind": "INVALID", "reason": "; ".join(errors), "raw": raw})
            continue
        seen.add(key)
        keep.append(idx)

    clean = df.loc[keep, FEATURES + [TARGET]].copy()
    for col in NUMERIC:
        clean[col] = clean[col].astype(float)
    clean["department"] = clean["department"].astype(str).str.strip()
    clean[TARGET] = clean[TARGET].astype(str).str.strip().str.lower().isin({"yes", "1", "true", "1.0"}).astype(int)
    meta = {"total": int(len(df)), "valid": int(len(clean)),
            "duplicates": sum(1 for f in failed if f["kind"] == "DUPLICATE"),
            "invalid": sum(1 for f in failed if f["kind"] == "INVALID"),
            "attrition_rate": round(float(clean[TARGET].mean() * 100), 2) if len(clean) else 0}
    return clean, failed, meta


# ------------------------------------------------------------------ training
def _candidates():
    pre_tree = ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL)], remainder="passthrough")
    pre_lin = ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL),
                                 ("num", StandardScaler(), NUMERIC)])
    return {
        "RandomForest": Pipeline([("pre", pre_tree), ("clf", RandomForestClassifier(
            n_estimators=250, max_depth=9, min_samples_leaf=4, random_state=7, n_jobs=-1))]),
        "GradientBoosting": Pipeline([("pre", pre_tree), ("clf", GradientBoostingClassifier(
            n_estimators=200, max_depth=3, learning_rate=0.05, random_state=7))]),
        "LogisticRegression": Pipeline([("pre", pre_lin), ("clf", LogisticRegression(
            max_iter=2000))]),
    }


def train_model(df: pd.DataFrame, version: int) -> dict:
    if len(df) < 50 or df[TARGET].nunique() < 2:
        raise ValueError("Need at least 50 valid rows containing both attrition classes to train.")
    X, y = df[FEATURES], df[TARGET]
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, stratify=y, random_state=11)

    results, best = {}, None
    for name, pipe in _candidates().items():
        pipe.fit(X_tr, y_tr)
        proba = pipe.predict_proba(X_te)[:, 1]
        auc = roc_auc_score(y_te, proba)
        results[name] = round(float(auc), 4)
        if best is None or auc > best[1]:
            best = (name, auc, pipe, proba)

    name, auc, pipe, proba = best
    pred = (proba >= 0.5).astype(int)
    metrics = {
        "accuracy": round(float(accuracy_score(y_te, pred)), 4),
        "precision": round(float(precision_score(y_te, pred, zero_division=0)), 4),
        "recall": round(float(recall_score(y_te, pred, zero_division=0)), 4),
        "f1": round(float(f1_score(y_te, pred, zero_division=0)), 4),
        "roc_auc": round(float(auc), 4),
        "train_rows": int(len(X_tr)), "test_rows": int(len(X_te)),
        "candidates_auc": results,
    }
    perm = permutation_importance(pipe, X_te, y_te, n_repeats=5, random_state=3, scoring="roc_auc")
    imp = {f: max(0.0, float(v)) for f, v in zip(FEATURES, perm.importances_mean)}
    total = sum(imp.values()) or 1
    importance = dict(sorted(((k, round(v / total, 4)) for k, v in imp.items()), key=lambda kv: -kv[1]))

    baseline = {c: float(X_tr[c].median()) for c in NUMERIC}
    baseline["department"] = str(X_tr["department"].mode()[0])
    bundle = {"pipeline": pipe, "algorithm": name, "version": version, "baseline": baseline,
              "income_by_level": {int(k): float(v) for k, v in X_tr.groupby("job_level")["monthly_income"].median().items()}}
    path = MODEL_DIR / f"attrition_model_v{version}.joblib"
    joblib.dump(bundle, path)
    _cache.clear()
    return {"algorithm": name, "path": str(path), "metrics": metrics, "feature_importance": importance}


_cache: dict[str, dict] = {}


def load_bundle(path: str) -> dict:
    if path not in _cache:
        _cache[path] = joblib.load(path)
    return _cache[path]


# ------------------------------------------------------------------ scoring
def _confidence(pipe, X: pd.DataFrame, proba: np.ndarray) -> np.ndarray:
    clf = pipe.named_steps["clf"]
    if hasattr(clf, "estimators_") and isinstance(clf, RandomForestClassifier):
        Xt = pipe.named_steps["pre"].transform(X)
        votes = np.stack([est.predict_proba(Xt)[:, 1] >= 0.5 for est in clf.estimators_])  # trees x rows
        agree = votes.mean(axis=0)
        return np.maximum(agree, 1 - agree) * 100
    return np.maximum(proba, 1 - proba) * 100


def score_frame(bundle: dict, X: pd.DataFrame):
    """Return list of dicts with risk_score, confidence and top_factors for each row of X."""
    pipe, base = bundle["pipeline"], bundle["baseline"]
    X = X[FEATURES].copy()
    proba = pipe.predict_proba(X)[:, 1]
    conf = _confidence(pipe, X, proba)

    # Counterfactual attribution: how much does risk drop if a feature is reset to the population baseline?
    variants = []
    for f in FEATURES:
        v = X.copy()
        v[f] = base[f]
        variants.append(v)
    stacked = pd.concat(variants, ignore_index=True)
    alt = pipe.predict_proba(stacked)[:, 1].reshape(len(FEATURES), len(X))

    out = []
    for i in range(len(X)):
        contribs = []
        for j, f in enumerate(FEATURES):
            delta = float(proba[i] - alt[j, i])
            if delta > 0.005:
                label, _, action, rec = FACTOR_INFO[f]
                val = X.iloc[i][f]
                contribs.append({"feature": f, "label": label, "impact": round(delta * 100, 1),
                                 "value": val if isinstance(val, str) else round(float(val), 1),
                                 "baseline": base[f] if isinstance(base[f], str) else round(float(base[f]), 1),
                                 "action_type": action, "recommendation": rec})
        contribs.sort(key=lambda c: -c["impact"])
        score = round(float(proba[i] * 100), 1)
        out.append({"risk_score": score, "risk_level": risk_level(score),
                    "confidence": round(float(conf[i]), 1), "top_factors": contribs[:5]})
    return out


def employee_features(db: Session, employees) -> pd.DataFrame:
    """Build model features for live employees from HR, attendance and review data."""
    from ..models import Attendance, PerformanceReview

    ids = [e.id for e in employees]
    since = date.today() - timedelta(days=90)
    att = {r.employee_id: r for r in db.query(
        Attendance.employee_id,
        func.sum(Attendance.overtime_hours).label("ot"),
        func.count(Attendance.id).label("days"),
        func.sum(case((Attendance.status == "ABSENT", 1), else_=0)).label("absent"),
    ).filter(Attendance.employee_id.in_(ids), Attendance.date >= since).group_by(Attendance.employee_id).all()}

    latest_rating = {}
    for emp_id, rating in db.query(PerformanceReview.employee_id, PerformanceReview.rating) \
            .filter(PerformanceReview.employee_id.in_(ids)).order_by(PerformanceReview.created_at).all():
        latest_rating[emp_id] = rating

    rows = []
    today = date.today()
    for e in employees:
        a = att.get(e.id)
        days = (a.days if a else 0) or 0
        rows.append({
            "monthly_income": e.salary or 1000,
            "years_at_company": round(max(0.0, (today - e.hire_date).days / 365.25), 1),
            "job_level": (e.job_role.level if e.job_role else 1),
            "job_satisfaction": e.job_satisfaction, "environment_satisfaction": e.environment_satisfaction,
            "work_life_balance": e.work_life_balance, "job_involvement": e.job_involvement,
            "performance_rating": latest_rating.get(e.id, 3.0),
            "overtime_hours": round(((a.ot or 0) if a else 0) / 3, 1),
            "absence_rate": round(((a.absent or 0) / days * 100) if days else 0, 1),
            "distance_from_home": e.distance_from_home, "num_companies_worked": e.num_companies_worked,
            "years_since_last_promotion": e.years_since_last_promotion,
            "training_times_last_year": e.training_times_last_year, "stock_option_level": e.stock_option_level,
            "department": e.department.name if e.department else "Operations",
        })
    return pd.DataFrame(rows, columns=FEATURES)


def checksum(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def stamp() -> str:
    return datetime.now().strftime("%Y%m%d%H%M%S")
