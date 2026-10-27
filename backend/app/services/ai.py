import math
import re
import uuid
from collections import Counter, defaultdict
from datetime import date, timedelta

import numpy as np
import pandas as pd
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..config import DATASET_DIR
from ..ml import engine
from ..models import (Attendance, Dataset, DatasetFailedRecord, Department, Employee, ModelVersion, PerformanceReview,
                      Prediction, RiskLog, Task, User)
from .alert_engine import risk_alert_for


class AIError(Exception):
    pass


def active_model(db: Session) -> ModelVersion | None:
    return db.query(ModelVersion).filter_by(is_active=True).first()


# ------------------------------------------------------------------ datasets
def register_dataset(db: Session, name: str, original_filename: str, content: bytes, user: User | None) -> Dataset:
    try:
        clean, failed, meta = engine.validate_dataset(content)
    except ValueError as e:
        raise AIError(str(e))
    checksum = engine.checksum(content)
    dup = db.query(Dataset).filter_by(name=name, checksum=checksum).first()
    if dup:
        raise AIError(f"This file is identical to '{name}' version {dup.version}")
    version = (db.query(func.max(Dataset.version)).filter(Dataset.name == name).scalar() or 0) + 1
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "dataset"
    (DATASET_DIR / f"{slug}_v{version}_raw.csv").write_bytes(content)
    clean.to_csv(DATASET_DIR / f"{slug}_v{version}.csv", index=False)
    ds = Dataset(name=name, version=version, filename=f"{slug}_v{version}.csv", checksum=checksum,
                 total_records=meta["total"], valid_records=meta["valid"], duplicate_records=meta["duplicates"],
                 failed_records=meta["invalid"], attrition_rate=meta["attrition_rate"],
                 status="VALIDATED" if meta["valid"] >= 50 else "REJECTED",
                 notes=f"Uploaded from {original_filename}" + ("" if meta["valid"] >= 50 else " — fewer than 50 valid rows"),
                 uploaded_by=user.id if user else None)
    db.add(ds)
    db.flush()
    for f in failed[:2000]:
        raw = {k: (None if isinstance(v, float) and math.isnan(v) else v) for k, v in f["raw"].items()}
        db.add(DatasetFailedRecord(dataset_id=ds.id, row_number=f["row_number"], kind=f["kind"], reason=f["reason"], raw=raw))
    db.commit()
    return ds


def train_from_dataset(db: Session, ds: Dataset) -> ModelVersion:
    if ds.status == "REJECTED":
        raise AIError("Dataset was rejected during validation and cannot be used for training")
    df = pd.read_csv(DATASET_DIR / ds.filename)
    version = (db.query(func.max(ModelVersion.version)).scalar() or 0) + 1
    try:
        res = engine.train_model(df, version)
    except ValueError as e:
        raise AIError(str(e))
    db.query(ModelVersion).update({ModelVersion.is_active: False})
    mv = ModelVersion(version=version, dataset_id=ds.id, algorithm=res["algorithm"], path=res["path"],
                      metrics=res["metrics"], feature_importance=res["feature_importance"], is_active=True)
    db.add(mv)
    ds.status = "TRAINED"
    db.commit()
    return mv


# ------------------------------------------------------------------ predictions
def run_predictions(db: Session, employee_ids: list[int] | None = None, department_id: int | None = None,
                    raise_alerts: bool = True) -> dict:
    mv = active_model(db)
    if not mv:
        raise AIError("No trained model. Upload a dataset and train a model first.")
    bundle = engine.load_bundle(mv.path)
    q = db.query(Employee).options(joinedload(Employee.department), joinedload(Employee.job_role)) \
        .filter(Employee.status.in_(["ACTIVE", "ON_LEAVE"]))
    if employee_ids:
        q = q.filter(Employee.id.in_(employee_ids))
    if department_id:
        q = q.filter(Employee.department_id == department_id)
    emps = q.all()
    if not emps:
        return {"scored": 0, "by_level": {}, "level_changes": 0, "alerts": 0}
    results = engine.score_frame(bundle, engine.employee_features(db, emps))
    batch = uuid.uuid4().hex[:12]
    changes = alerts = 0
    for e, r in zip(emps, results):
        db.add(Prediction(employee_id=e.id, model_version=mv.version, risk_score=r["risk_score"],
                          risk_level=r["risk_level"], confidence=r["confidence"], top_factors=r["top_factors"],
                          batch_id=batch))
        old_s, old_l = e.risk_score, e.risk_level
        delta = r["risk_score"] - (old_s or 0)
        if old_l is None or old_l != r["risk_level"] or abs(delta) >= 5:
            order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
            if old_l is None:
                event = "NEW_HIGH_RISK" if r["risk_level"] in ("HIGH", "CRITICAL") else "RESCORED"
            elif order.index(r["risk_level"]) > order.index(old_l):
                event = "ESCALATED"
            elif order.index(r["risk_level"]) < order.index(old_l):
                event = "DEESCALATED"
            else:
                event = "RESCORED"
            db.add(RiskLog(employee_id=e.id, old_score=old_s, new_score=r["risk_score"], old_level=old_l,
                           new_level=r["risk_level"], change=round(delta, 1), event=event))
            changes += old_l != r["risk_level"]
        e.risk_score, e.risk_level = r["risk_score"], r["risk_level"]
        if raise_alerts:
            alerts += risk_alert_for(db, e, old_l, r["risk_level"], r["risk_score"])
    db.commit()
    return {"scored": len(emps), "batch_id": batch, "model_version": mv.version,
            "by_level": dict(Counter(r["risk_level"] for r in results)), "level_changes": changes, "alerts": alerts}


def simulate(db: Session, employee: Employee, overrides: dict) -> dict:
    mv = active_model(db)
    if not mv:
        raise AIError("No trained model available")
    bundle = engine.load_bundle(mv.path)
    X = engine.employee_features(db, [employee])
    before = engine.score_frame(bundle, X)[0]
    X2 = X.copy()
    for k, v in overrides.items():
        if k not in engine.FEATURES:
            raise AIError(f"Unknown feature {k}")
        X2.loc[0, k] = v if k == "department" else float(v)
    after = engine.score_frame(bundle, X2)[0]
    return {"before": before, "after": after, "features": X.iloc[0].to_dict(), "overrides": overrides,
            "risk_change": round(after["risk_score"] - before["risk_score"], 1)}


# ------------------------------------------------------------------ workforce history & forecasting
def month_ends(n: int) -> list[date]:
    today = date.today()
    out, y, m = [], today.year, today.month
    for _ in range(n):
        first_next = date(y + (m == 12), (m % 12) + 1, 1)
        out.append(min(today, first_next - timedelta(days=1)))
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
    return out[::-1]


def headcount_history(db: Session, months: int = 24, department_id: int | None = None) -> list[dict]:
    q = db.query(Employee.hire_date, Employee.termination_date, Employee.status)
    if department_id:
        q = q.filter(Employee.department_id == department_id)
    rows = q.all()
    out = []
    for end in month_ends(months):
        start = end.replace(day=1)
        hc = sum(1 for h, t, _ in rows if h <= end and (t is None or t > end))
        hires = sum(1 for h, _, _ in rows if start <= h <= end)
        exits = sum(1 for _, t, _ in rows if t and start <= t <= end)
        vol = sum(1 for _, t, s in rows if t and start <= t <= end and s == "RESIGNED")
        out.append({"month": end.strftime("%Y-%m"), "headcount": hc, "hires": hires, "exits": exits,
                    "voluntary_exits": vol, "turnover_rate": round(exits / hc * 100, 2) if hc else 0})
    return out


def forecast(db: Session, horizon: int = 12, department_id: int | None = None) -> dict:
    hist = headcount_history(db, 24, department_id)
    q = db.query(Employee.risk_score).filter(Employee.status.in_(["ACTIVE", "ON_LEAVE"]))
    if department_id:
        q = q.filter(Employee.department_id == department_id)
    probs = np.array([(r or 15) / 100 for (r,) in q.all()])
    current = len(probs)
    monthly_p = 1 - (1 - probs) ** (1 / 12) if current else np.array([])

    last12 = hist[-12:]
    hires_series = np.array([h["hires"] for h in last12], dtype=float)
    slope = np.polyfit(np.arange(len(hires_series)), hires_series, 1)[0] if len(hires_series) > 1 else 0
    base_hires = float(hires_series.mean()) if len(hires_series) else 0
    hist_rate = (sum(h["exits"] for h in last12) / max(1, np.mean([h["headcount"] for h in last12]))) / 12

    proj, hc_ai, hc_base, var = [], float(current), float(current), 0.0
    today = date.today()
    y, m = today.year, today.month
    for i in range(1, horizon + 1):
        m += 1
        if m > 12:
            y, m = y + 1, 1
        scale = hc_ai / current if current else 0
        exits_ai = float(monthly_p.sum()) * scale
        var += float((monthly_p * (1 - monthly_p)).sum()) * scale
        hires = max(0.0, base_hires + slope * 0.25 * i)
        exits_base = hc_base * hist_rate
        hc_ai += hires - exits_ai
        hc_base += hires - exits_base
        band = 1.96 * math.sqrt(var)
        proj.append({"month": f"{y}-{m:02d}", "headcount": round(hc_ai, 1), "lower": round(hc_ai - band, 1),
                     "upper": round(hc_ai + band, 1), "baseline_headcount": round(hc_base, 1),
                     "expected_exits": round(exits_ai, 2), "expected_hires": round(hires, 2)})

    exp_leavers_12m = float(probs.sum()) if current else 0
    yearly = []
    hc = float(current)
    for yr in range(1, 4):
        leavers = hc * (exp_leavers_12m / current if current else 0)
        hires = base_hires * 12
        hc = hc - leavers + hires
        yearly.append({"year": today.year + yr, "projected_headcount": round(hc), "expected_leavers": round(leavers, 1),
                       "expected_hires": round(hires, 1)})
    return {"current_headcount": current, "history": hist, "forecast": proj, "yearly": yearly,
            "expected_leavers_12m": round(exp_leavers_12m, 1),
            "retention_rate_12m": round((1 - exp_leavers_12m / current) * 100, 1) if current else None,
            "historical_monthly_attrition": round(hist_rate * 100, 2),
            "growth_rate_12m": round((proj[-1]["headcount"] - current) / current * 100, 1) if current and proj else 0}


def stability(db: Session) -> list[dict]:
    year_ago = date.today() - timedelta(days=365)
    out = []
    for d in db.query(Department).order_by(Department.name).all():
        act = db.query(Employee).filter(Employee.department_id == d.id, Employee.status.in_(["ACTIVE", "ON_LEAVE"])).all()
        n = len(act)
        if not n:
            continue
        left = db.query(Employee).filter(Employee.department_id == d.id, Employee.termination_date >= year_ago).count()
        avg_risk = sum((e.risk_score or 0) for e in act) / n
        high_share = sum(1 for e in act if e.risk_level in ("HIGH", "CRITICAL")) / n
        turnover = left / (n + left / 2) * 100
        avg_tenure = sum((date.today() - e.hire_date).days / 365.25 for e in act) / n
        score = 100 - (0.45 * avg_risk + 0.35 * min(100, turnover * 2) + 0.20 * high_share * 100)
        score = max(0, min(100, score + min(5, avg_tenure)))
        exp_leavers = sum((e.risk_score or 0) / 100 for e in act)
        out.append({"department_id": d.id, "department": d.name, "headcount": n, "stability_score": round(score, 1),
                    "status": "STABLE" if score >= 70 else "WATCH" if score >= 55 else "UNSTABLE",
                    "avg_risk": round(avg_risk, 1), "high_risk_share": round(high_share * 100, 1),
                    "turnover_12m": round(turnover, 1), "avg_tenure": round(avg_tenure, 1),
                    "expected_leavers_12m": round(exp_leavers, 1),
                    "retention_forecast_12m": round((1 - exp_leavers / n) * 100, 1)})
    return sorted(out, key=lambda r: r["stability_score"])


# ------------------------------------------------------------------ recommendations
def latest_predictions(db: Session, employee_ids: list[int] | None = None) -> dict[int, Prediction]:
    sub = db.query(Prediction.employee_id, func.max(Prediction.id).label("mid")).group_by(Prediction.employee_id)
    if employee_ids is not None:
        sub = sub.filter(Prediction.employee_id.in_(employee_ids))
    sub = sub.subquery()
    rows = db.query(Prediction).join(sub, Prediction.id == sub.c.mid).all()
    return {p.employee_id: p for p in rows}


def employee_recommendations(pred: Prediction | None) -> list[dict]:
    if not pred:
        return []
    seen, out = set(), []
    for f in pred.top_factors or []:
        if f["action_type"] in seen:
            continue
        seen.add(f["action_type"])
        out.append({"action_type": f["action_type"], "factor": f["label"], "impact": f["impact"],
                    "recommendation": f["recommendation"],
                    "priority": "HIGH" if f["impact"] >= 8 else "MEDIUM" if f["impact"] >= 3 else "LOW"})
    return out


def department_insights(db: Session) -> list[dict]:
    preds = latest_predictions(db)
    month_ago = date.today() - timedelta(days=30)
    out = []
    for d in db.query(Department).order_by(Department.name).all():
        emps = db.query(Employee).filter(Employee.department_id == d.id, Employee.status == "ACTIVE").all()
        if not emps:
            continue
        ids = [e.id for e in emps]
        drivers = Counter()
        actions = {}
        for eid in ids:
            p = preds.get(eid)
            for f in (p.top_factors if p else [])[:3]:
                drivers[f["label"]] += 1
                actions[f["label"]] = f["recommendation"]
        rating = db.query(func.avg(PerformanceReview.rating)).filter(PerformanceReview.employee_id.in_(ids)).scalar()
        att = db.query(Attendance.status, func.count()).filter(Attendance.employee_id.in_(ids), Attendance.date >= month_ago) \
            .group_by(Attendance.status).all()
        tot = sum(c for _, c in att) or 1
        present = sum(c for s, c in att if s in ("PRESENT", "LATE", "HALF_DAY"))
        ot = db.query(func.avg(Attendance.overtime_hours)).filter(Attendance.employee_id.in_(ids), Attendance.date >= month_ago).scalar() or 0
        tasks = db.query(Task.status, func.count()).filter(Task.assignee_id.in_(ids)).group_by(Task.status).all()
        t_tot = sum(c for _, c in tasks)
        t_done = sum(c for s, c in tasks if s == "DONE")
        top = drivers.most_common(3)
        recs = [{"driver": label, "affected": cnt, "recommendation": actions[label]} for label, cnt in top]
        out.append({"department_id": d.id, "department": d.name, "headcount": len(emps),
                    "avg_rating": round(rating, 2) if rating else None,
                    "attendance_rate": round(present / tot * 100, 1), "avg_daily_overtime": round(ot, 2),
                    "task_completion": round(t_done / t_tot * 100, 1) if t_tot else None,
                    "avg_risk": round(sum((e.risk_score or 0) for e in emps) / len(emps), 1),
                    "top_drivers": recs})
    return out


def optimization_tips(db: Session) -> list[dict]:
    tips = []
    act = db.query(Employee).filter(Employee.status == "ACTIVE").all()
    n = len(act) or 1
    stalled = [e for e in act if e.years_since_last_promotion >= 4]
    if len(stalled) / n >= 0.1:
        tips.append({"area": "Career growth", "severity": "HIGH",
                     "tip": f"{len(stalled)} employees ({len(stalled) / n:.0%}) have waited 4+ years for promotion. "
                            "Run a calibrated promotion cycle and publish level criteria."})
    low_train = [e for e in act if e.training_times_last_year <= 1]
    if len(low_train) / n >= 0.15:
        tips.append({"area": "Learning & development", "severity": "MEDIUM",
                     "tip": f"{len(low_train)} employees received ≤1 training last year. Allocate an L&D budget per head."})
    low_sat = [e for e in act if e.job_satisfaction <= 2]
    if len(low_sat) / n >= 0.2:
        tips.append({"area": "Engagement", "severity": "HIGH",
                     "tip": f"{len(low_sat) / n:.0%} report low job satisfaction. Launch pulse surveys and manager 1:1 cadences."})
    wlb = [e for e in act if e.work_life_balance <= 2]
    if len(wlb) / n >= 0.2:
        tips.append({"area": "Wellbeing", "severity": "MEDIUM",
                     "tip": f"{len(wlb)} employees rate work-life balance poorly. Pilot flexible hours / no-meeting days."})
    since = date.today() - timedelta(days=30)
    for name, ot in db.query(Department.name, func.avg(Attendance.overtime_hours)).join(Employee, Employee.department_id == Department.id) \
            .join(Attendance, Attendance.employee_id == Employee.id).filter(Attendance.date >= since).group_by(Department.name).all():
        if ot and ot >= 0.9:
            tips.append({"area": "Workload", "severity": "HIGH",
                         "tip": f"{name} averages {ot:.1f}h overtime per day. Rebalance workload or open a requisition."})
    no_stock = [e for e in act if e.stock_option_level == 0 and (e.risk_level in ("HIGH", "CRITICAL"))]
    if no_stock:
        tips.append({"area": "Compensation", "severity": "MEDIUM",
                     "tip": f"{len(no_stock)} high-risk employees hold no long-term incentives. Consider targeted retention grants."})
    if not tips:
        tips.append({"area": "Overall", "severity": "LOW", "tip": "Workforce indicators are healthy. Keep monitoring monthly."})
    return tips


def factor_frequency(db: Session) -> list[dict]:
    preds = latest_predictions(db)
    c, impact = Counter(), defaultdict(float)
    for p in preds.values():
        for f in p.top_factors or []:
            c[f["label"]] += 1
            impact[f["label"]] += f["impact"]
    return [{"factor": k, "employees": v, "avg_impact": round(impact[k] / v, 1)} for k, v in c.most_common(10)]
