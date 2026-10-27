import io
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..ml import engine
from ..models import (Dataset, DatasetFailedRecord, Department, Employee, Intervention, ModelVersion, Prediction,
                      RiskLog, User)
from ..schemas import InterventionIn, InterventionUpdate, PredictIn
from ..security import HR_ROLES, MGMT_ROLES, ensure_can_view_employee, require_roles, visible_employee_ids
from ..services import ai
from ..services.events import diff, log_activity, notify
from ..utils import client_ip, employee_brief, intervention_dict, iso, paginate, prediction_dict

router = APIRouter(prefix="/api/ai", tags=["AI Attrition Intelligence"])


def _ai_error(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ai.AIError as e:
        raise HTTPException(400, str(e))


# ================================================================ datasets (Module 11)
def dataset_dict(d: Dataset) -> dict:
    return {"id": d.id, "name": d.name, "version": d.version, "filename": d.filename, "total_records": d.total_records,
            "valid_records": d.valid_records, "duplicate_records": d.duplicate_records, "failed_records": d.failed_records,
            "attrition_rate": d.attrition_rate, "status": d.status, "notes": d.notes, "created_at": iso(d.created_at)}


@router.get("/datasets/template")
def dataset_template(_: User = Depends(require_roles(*HR_ROLES))):
    df = engine.generate_synthetic_dataset(25, seed=7, with_errors=False)
    return Response(df.to_csv(index=False), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="attrition_dataset_template.csv"'})


@router.post("/datasets/upload", status_code=201)
async def upload_dataset(request: Request, file: UploadFile = File(...), name: str = Form(...),
                         user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(400, "Only CSV files are supported")
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(413, "Dataset exceeds 20 MB")
    ds = _ai_error(ai.register_dataset, db, name.strip(), file.filename, content, user)
    log_activity(db, user, "UPLOAD", "dataset", ds.id,
                 f"Uploaded dataset {ds.name} v{ds.version}: {ds.valid_records} valid, {ds.failed_records} failed, "
                 f"{ds.duplicate_records} duplicates", ip=client_ip(request))
    return dataset_dict(ds)


@router.get("/datasets")
def list_datasets(_: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    models = {m.dataset_id: m.version for m in db.query(ModelVersion).all()}
    return [{**dataset_dict(d), "model_version": models.get(d.id)}
            for d in db.query(Dataset).order_by(Dataset.name, Dataset.version.desc()).all()]


@router.get("/datasets/{ds_id}/failed")
def failed_records(ds_id: int, kind: str | None = None, page: int = 1, size: int = 25,
                   _: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    q = db.query(DatasetFailedRecord).filter_by(dataset_id=ds_id)
    if kind:
        q = q.filter(DatasetFailedRecord.kind == kind)
    return paginate(q.order_by(DatasetFailedRecord.row_number), page, size,
                    lambda f: {"row_number": f.row_number, "kind": f.kind, "reason": f.reason, "raw": f.raw})


@router.get("/datasets/{ds_id}/failed.csv")
def failed_csv(ds_id: int, _: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    import csv
    rows = db.query(DatasetFailedRecord).filter_by(dataset_id=ds_id).order_by(DatasetFailedRecord.row_number).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["row_number", "kind", "reason", "raw"])
    for r in rows:
        w.writerow([r.row_number, r.kind, r.reason, r.raw])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="dataset_{ds_id}_failed_records.csv"'})


@router.post("/datasets/{ds_id}/train")
def train(ds_id: int, request: Request, user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    ds = db.get(Dataset, ds_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    mv = _ai_error(ai.train_from_dataset, db, ds)
    log_activity(db, user, "TRAIN", "model", mv.id,
                 f"Trained model v{mv.version} ({mv.algorithm}) on {ds.name} v{ds.version} — AUC {mv.metrics['roc_auc']}",
                 ip=client_ip(request))
    summary = _ai_error(ai.run_predictions, db)
    return {"model": model_dict(mv), "rescored": summary}


@router.delete("/datasets/{ds_id}")
def delete_dataset(ds_id: int, user: User = Depends(require_roles("ADMIN")), db: Session = Depends(get_db)):
    ds = db.get(Dataset, ds_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    if db.query(ModelVersion).filter_by(dataset_id=ds_id, is_active=True).first():
        raise HTTPException(400, "Dataset backs the active model; activate another model first")
    db.delete(ds)
    db.commit()
    log_activity(db, user, "DELETE", "dataset", ds_id, f"Deleted dataset {ds.name} v{ds.version}")
    return {"ok": True}


# ================================================================ models
def model_dict(m: ModelVersion) -> dict:
    return {"id": m.id, "version": m.version, "dataset_id": m.dataset_id, "algorithm": m.algorithm, "metrics": m.metrics,
            "feature_importance": m.feature_importance, "is_active": m.is_active, "trained_at": iso(m.trained_at)}


@router.get("/models")
def list_models(_: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    return [model_dict(m) for m in db.query(ModelVersion).order_by(ModelVersion.version.desc()).all()]


@router.get("/models/active")
def get_active_model(_: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    m = ai.active_model(db)
    return model_dict(m) if m else None


@router.post("/models/{model_id}/activate")
def activate_model(model_id: int, user: User = Depends(require_roles(*HR_ROLES)), db: Session = Depends(get_db)):
    m = db.get(ModelVersion, model_id)
    if not m:
        raise HTTPException(404, "Model not found")
    db.query(ModelVersion).update({ModelVersion.is_active: False})
    m.is_active = True
    db.commit()
    log_activity(db, user, "ACTIVATE", "model", m.id, f"Activated model v{m.version}")
    return model_dict(m)


# ================================================================ predictions (Module 12)
@router.post("/predict")
def predict(body: PredictIn, request: Request, user: User = Depends(require_roles(*MGMT_ROLES)),
            db: Session = Depends(get_db)):
    ids = body.employee_ids
    scope = visible_employee_ids(db, user)
    if scope is not None:
        ids = [i for i in (ids or scope) if i in scope]
    summary = _ai_error(ai.run_predictions, db, ids, body.department_id)
    log_activity(db, user, "PREDICT", "prediction", None,
                 f"Ran attrition predictions for {summary['scored']} employee(s)", ip=client_ip(request))
    return summary


@router.get("/predictions")
def list_predictions(employee_id: int | None = None, risk_level: list[str] | None = Query(None),
                     department_id: int | None = None, latest_only: bool = True, page: int = 1, size: int = 20,
                     user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    q = db.query(Prediction).options(joinedload(Prediction.employee).joinedload(Employee.department),
                                     joinedload(Prediction.employee).joinedload(Employee.job_role)) \
        .join(Employee, Employee.id == Prediction.employee_id)
    if latest_only:
        sub = db.query(func.max(Prediction.id)).group_by(Prediction.employee_id).subquery()
        q = q.filter(Prediction.id.in_(sub.select()), Employee.status.in_(["ACTIVE", "ON_LEAVE"]))
    scope = visible_employee_ids(db, user)
    if scope is not None:
        q = q.filter(Prediction.employee_id.in_(scope))
    if employee_id:
        q = q.filter(Prediction.employee_id == employee_id)
    if risk_level:
        q = q.filter(Prediction.risk_level.in_(risk_level))
    if department_id:
        q = q.filter(Employee.department_id == department_id)
    order = Prediction.risk_score.desc() if latest_only else Prediction.created_at.desc()
    return paginate(q.order_by(order), page, size, prediction_dict)


@router.get("/predictions/departments")
def department_predictions(user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    out = []
    for d in db.query(Department).order_by(Department.name).all():
        emps = db.query(Employee).filter(Employee.department_id == d.id, Employee.status.in_(["ACTIVE", "ON_LEAVE"]),
                                         Employee.risk_score.isnot(None)).all()
        if not emps:
            continue
        levels = {lv: sum(1 for e in emps if e.risk_level == lv) for lv in ("LOW", "MEDIUM", "HIGH", "CRITICAL")}
        out.append({"department_id": d.id, "department": d.name, "headcount": len(emps),
                    "avg_risk": round(sum(e.risk_score for e in emps) / len(emps), 1),
                    "max_risk": max(e.risk_score for e in emps),
                    "expected_leavers": round(sum(e.risk_score for e in emps) / 100, 1), **levels})
    return sorted(out, key=lambda r: -r["avg_risk"])


@router.get("/predictions/employee/{employee_id}")
def employee_prediction_detail(employee_id: int, user: User = Depends(require_roles(*MGMT_ROLES)),
                               db: Session = Depends(get_db)):
    ensure_can_view_employee(db, user, employee_id)
    e = db.get(Employee, employee_id)
    if not e:
        raise HTTPException(404, "Employee not found")
    preds = db.query(Prediction).filter_by(employee_id=employee_id).order_by(Prediction.created_at).all()
    latest = preds[-1] if preds else None
    logs = db.query(RiskLog).filter_by(employee_id=employee_id).order_by(RiskLog.created_at.desc()).limit(20).all()
    ivs = db.query(Intervention).filter_by(employee_id=employee_id).order_by(Intervention.created_at.desc()).all()
    return {"employee": employee_brief(e), "latest": prediction_dict(latest) if latest else None,
            "history": [{"risk_score": p.risk_score, "risk_level": p.risk_level, "confidence": p.confidence,
                         "created_at": iso(p.created_at)} for p in preds],
            "risk_logs": [_risk_log_dict(r) for r in logs],
            "recommendations": ai.employee_recommendations(latest),
            "interventions": [intervention_dict(i) for i in ivs]}


class SimulateIn(BaseModel):
    employee_id: int
    changes: dict[str, float | str]


@router.post("/simulate")
def simulate(body: SimulateIn, user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    """What-if analysis: re-score an employee with hypothetical changes (e.g. a raise or less overtime)."""
    ensure_can_view_employee(db, user, body.employee_id)
    e = db.get(Employee, body.employee_id)
    if not e:
        raise HTTPException(404, "Employee not found")
    return _ai_error(ai.simulate, db, e, body.changes)


# ================================================================ risk monitoring (Module 13)
def _risk_log_dict(r: RiskLog) -> dict:
    return {"id": r.id, "employee_id": r.employee_id, "employee": r.employee.full_name if r.employee else None,
            "department": r.employee.department.name if r.employee and r.employee.department else None,
            "old_score": r.old_score, "new_score": r.new_score, "old_level": r.old_level, "new_level": r.new_level,
            "change": r.change, "event": r.event, "created_at": iso(r.created_at)}


@router.get("/risk/overview")
def risk_overview(user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    q = db.query(Employee).filter(Employee.status.in_(["ACTIVE", "ON_LEAVE"]))
    scope = visible_employee_ids(db, user)
    if scope is not None:
        q = q.filter(Employee.id.in_(scope))
    dist = dict(q.with_entities(Employee.risk_level, func.count()).group_by(Employee.risk_level).all())
    avg = q.with_entities(func.avg(Employee.risk_score)).scalar()
    buckets = [0] * 10
    for (s,) in q.with_entities(Employee.risk_score).all():
        if s is not None:
            buckets[min(9, int(s // 10))] += 1
    open_iv = {eid for (eid,) in db.query(Intervention.employee_id).filter(Intervention.status.in_(["OPEN", "IN_PROGRESS"])).all()}
    high = q.filter(Employee.risk_level.in_(["HIGH", "CRITICAL"])).order_by(Employee.risk_score.desc()).all()
    preds = ai.latest_predictions(db, [e.id for e in high])
    mv = ai.active_model(db)
    return {"distribution": {lv: dist.get(lv, 0) for lv in ("LOW", "MEDIUM", "HIGH", "CRITICAL")},
            "avg_risk": round(avg, 1) if avg else None, "histogram": [{"range": f"{i * 10}-{i * 10 + 10}%", "count": c}
                                                                      for i, c in enumerate(buckets)],
            "high_risk": [{**employee_brief(e), "confidence": preds[e.id].confidence if e.id in preds else None,
                           "top_factor": (preds[e.id].top_factors or [{}])[0].get("label") if e.id in preds and preds[e.id].top_factors else None,
                           "has_intervention": e.id in open_iv,
                           "scored_at": iso(preds[e.id].created_at) if e.id in preds else None} for e in high],
            "model": {"version": mv.version, "algorithm": mv.algorithm, "auc": mv.metrics.get("roc_auc"),
                      "trained_at": iso(mv.trained_at)} if mv else None,
            "top_factors": ai.factor_frequency(db)}


@router.get("/risk/logs")
def risk_logs(employee_id: int | None = None, event: str | None = None, page: int = 1, size: int = 25,
              user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    q = db.query(RiskLog).options(joinedload(RiskLog.employee).joinedload(Employee.department))
    scope = visible_employee_ids(db, user)
    if scope is not None:
        q = q.filter(RiskLog.employee_id.in_(scope))
    if employee_id:
        q = q.filter(RiskLog.employee_id == employee_id)
    if event:
        q = q.filter(RiskLog.event == event)
    return paginate(q.order_by(RiskLog.created_at.desc(), RiskLog.id.desc()), page, size, _risk_log_dict)


@router.get("/risk/movers")
def risk_movers(limit: int = 10, user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    """Employees whose risk changed the most in their latest re-score."""
    sub = db.query(func.max(RiskLog.id)).group_by(RiskLog.employee_id).subquery()
    rows = db.query(RiskLog).options(joinedload(RiskLog.employee)).filter(RiskLog.id.in_(sub.select()), RiskLog.old_score.isnot(None)).all()
    rows.sort(key=lambda r: -abs(r.change))
    return [_risk_log_dict(r) for r in rows[:limit]]


# ================================================================ interventions (Module 16)
@router.get("/interventions")
def list_interventions(status: list[str] | None = Query(None), employee_id: int | None = None, owner_id: int | None = None,
                       overdue: bool = False, page: int = 1, size: int = 20,
                       user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    q = db.query(Intervention).options(joinedload(Intervention.employee).joinedload(Employee.department),
                                       joinedload(Intervention.owner))
    scope = visible_employee_ids(db, user)
    if scope is not None:
        q = q.filter(Intervention.employee_id.in_(scope))
    if status:
        q = q.filter(Intervention.status.in_(status))
    if employee_id:
        q = q.filter(Intervention.employee_id == employee_id)
    if owner_id:
        q = q.filter(Intervention.owner_id == owner_id)
    if overdue:
        q = q.filter(Intervention.follow_up_date < date.today(), Intervention.status.in_(["OPEN", "IN_PROGRESS"]))
    return paginate(q.order_by(Intervention.created_at.desc()), page, size, intervention_dict)


@router.get("/interventions/stats")
def intervention_stats(user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    by_status = dict(db.query(Intervention.status, func.count()).group_by(Intervention.status).all())
    by_type = dict(db.query(Intervention.action_type, func.count()).group_by(Intervention.action_type).all())
    done = db.query(Intervention).options(joinedload(Intervention.employee)).filter(
        Intervention.status == "COMPLETED", Intervention.risk_at_creation.isnot(None)).all()
    deltas = [(i.employee.risk_score or 0) - i.risk_at_creation for i in done if i.employee]
    overdue = db.query(Intervention).filter(Intervention.follow_up_date < date.today(),
                                            Intervention.status.in_(["OPEN", "IN_PROGRESS"])).count()
    return {"by_status": by_status, "by_type": by_type, "overdue_follow_ups": overdue,
            "avg_risk_change_after_completion": round(sum(deltas) / len(deltas), 1) if deltas else None,
            "completed_with_risk_drop": sum(1 for d in deltas if d < 0)}


@router.post("/interventions", status_code=201)
def create_intervention(body: InterventionIn, request: Request, user: User = Depends(require_roles(*MGMT_ROLES)),
                        db: Session = Depends(get_db)):
    ensure_can_view_employee(db, user, body.employee_id)
    e = db.get(Employee, body.employee_id)
    if not e:
        raise HTTPException(404, "Employee not found")
    iv = Intervention(**body.model_dump(), created_by=user.id, risk_at_creation=e.risk_score)
    iv.owner_id = iv.owner_id or user.id
    db.add(iv)
    db.commit()
    log_activity(db, user, "CREATE", "intervention", iv.id, f"Planned {iv.action_type.replace('_', ' ').lower()} for {e.full_name}",
                 ip=client_ip(request))
    if iv.owner_id != user.id:
        notify(db, [iv.owner_id], "Retention action assigned to you",
               f"{user.full_name} assigned you a {iv.action_type.replace('_', ' ').lower()} for {e.full_name}.",
               category="RISK", priority="HIGH", link="/ai/interventions")
    return intervention_dict(iv)


@router.patch("/interventions/{iv_id}")
def update_intervention(iv_id: int, body: InterventionUpdate, request: Request,
                        user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    iv = db.get(Intervention, iv_id)
    if not iv:
        raise HTTPException(404, "Intervention not found")
    ensure_can_view_employee(db, user, iv.employee_id)
    data = body.model_dump(exclude_unset=True)
    changes = diff(iv, data)
    for k, v in data.items():
        setattr(iv, k, v)
    db.commit()
    log_activity(db, user, "UPDATE", "intervention", iv.id, f"Updated intervention for {iv.employee.full_name}", changes,
                 ip=client_ip(request))
    return intervention_dict(iv)


# ================================================================ recommendations (Module 23)
@router.get("/recommendations")
def recommendations(user: User = Depends(require_roles(*MGMT_ROLES)), db: Session = Depends(get_db)):
    scope = visible_employee_ids(db, user)
    q = db.query(Employee).filter(Employee.status == "ACTIVE", Employee.risk_level.in_(["HIGH", "CRITICAL", "MEDIUM"]))
    if scope is not None:
        q = q.filter(Employee.id.in_(scope))
    emps = q.order_by(Employee.risk_score.desc()).limit(25).all()
    preds = ai.latest_predictions(db, [e.id for e in emps])
    return {"employees": [{"employee": employee_brief(e), "recommendations": ai.employee_recommendations(preds.get(e.id))}
                          for e in emps],
            "optimization_tips": ai.optimization_tips(db),
            "departments": ai.department_insights(db)}
