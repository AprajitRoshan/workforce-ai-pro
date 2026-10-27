from app.ml import engine


def test_dataset_validation_reports_failures():
    df = engine.generate_synthetic_dataset(300, seed=1)
    clean, failed, meta = engine.validate_dataset(df.to_csv(index=False).encode())
    assert meta["duplicates"] == 9 and meta["invalid"] == 12
    assert meta["valid"] == 300 and len(clean) == 300
    assert any("job_satisfaction" in f["reason"] for f in failed)


def test_dataset_missing_columns():
    try:
        engine.validate_dataset(b"a,b\n1,2\n")
    except ValueError as e:
        assert "Missing required columns" in str(e)
    else:
        raise AssertionError("expected ValueError")


def test_upload_train_predict_flow(client, hr):
    csv = engine.generate_synthetic_dataset(600, seed=5).to_csv(index=False).encode()
    up = client.post("/api/ai/datasets/upload", headers=hr, files={"file": ("hist.csv", csv, "text/csv")}, data={"name": "Test Set"})
    assert up.status_code == 201 and up.json()["version"] == 1
    again = client.post("/api/ai/datasets/upload", headers=hr, files={"file": ("hist.csv", csv, "text/csv")}, data={"name": "Test Set"})
    assert again.status_code == 400  # identical file rejected
    failed = client.get(f"/api/ai/datasets/{up.json()['id']}/failed?kind=DUPLICATE", headers=hr).json()
    assert failed["total"] == 9
    tr = client.post(f"/api/ai/datasets/{up.json()['id']}/train", headers=hr)
    assert tr.status_code == 200
    m = tr.json()["model"]
    assert m["is_active"] and m["metrics"]["roc_auc"] > 0.7
    assert tr.json()["rescored"]["scored"] > 100


def test_prediction_outputs_are_well_formed(client, hr):
    preds = client.get("/api/ai/predictions?size=200", headers=hr).json()["items"]
    assert preds
    for p in preds:
        assert 0 <= p["risk_score"] <= 100
        assert 50 <= p["confidence"] <= 100
        assert p["risk_level"] in ("LOW", "MEDIUM", "HIGH", "CRITICAL")
        assert all(f["impact"] > 0 for f in p["top_factors"])
    # predictions are sorted by risk descending
    scores = [p["risk_score"] for p in preds]
    assert scores == sorted(scores, reverse=True)


def test_what_if_simulation_moves_risk_in_expected_direction(client, hr):
    top = client.get("/api/ai/predictions?size=1", headers=hr).json()["items"][0]
    better = client.post("/api/ai/simulate", headers=hr, json={"employee_id": top["employee_id"],
                                                               "changes": {"overtime_hours": 0, "job_satisfaction": 4, "work_life_balance": 4}}).json()
    assert better["after"]["risk_score"] < better["before"]["risk_score"]
    worse = client.post("/api/ai/simulate", headers=hr, json={"employee_id": top["employee_id"], "changes": {"overtime_hours": 60}}).json()
    assert worse["after"]["risk_score"] >= worse["before"]["risk_score"]


def test_forecast_and_stability(client, hr):
    fc = client.get("/api/forecast?horizon=6", headers=hr).json()
    assert len(fc["forecast"]) == 6 and len(fc["yearly"]) == 3
    assert all(f["lower"] <= f["headcount"] <= f["upper"] for f in fc["forecast"])
    st = client.get("/api/stability", headers=hr).json()
    assert 0 <= st["overall_score"] <= 100 and st["departments"]


def test_interventions_and_alert_engine(client, hr):
    emp = client.get("/api/ai/predictions?size=1", headers=hr).json()["items"][0]["employee_id"]
    iv = client.post("/api/ai/interventions", headers=hr, json={"employee_id": emp, "action_type": "ONE_ON_ONE", "recommendation": "Stay interview"})
    assert iv.status_code == 201 and iv.json()["risk_at_creation"] is not None
    assert client.patch(f"/api/ai/interventions/{iv.json()['id']}", headers=hr, json={"status": "COMPLETED"}).json()["status"] == "COMPLETED"
    assert "total" in client.post("/api/alerts/run", headers=hr).json()


def test_websocket_chat_and_read_receipts(client, manager, employee):
    tok_m = manager["Authorization"].split()[1]
    tok_e = employee["Authorization"].split()[1]
    emp_uid = client.get("/api/auth/me", headers=employee).json()["user"]["id"]
    mgr_uid = client.get("/api/auth/me", headers=manager).json()["user"]["id"]
    with client.websocket_connect(f"/ws?token={tok_m}") as ws_m, client.websocket_connect(f"/ws?token={tok_e}") as ws_e:
        ws_m.send_json({"type": "chat", "receiver_id": emp_uid, "content": "hello over websocket"})

        def wait_for(ws, kind):
            for _ in range(20):
                msg = ws.receive_json()
                if msg["type"] == kind:
                    return msg
            raise AssertionError(f"no {kind} message")

        got = wait_for(ws_e, "chat")
        assert got["data"]["content"] == "hello over websocket" and got["data"]["sender_id"] == mgr_uid
        ws_e.send_json({"type": "read", "peer_id": mgr_uid})
        receipt = wait_for(ws_m, "read_receipt")
        assert receipt["data"]["reader_id"] == emp_uid


def test_websocket_rejects_bad_token(client):
    from starlette.websockets import WebSocketDisconnect
    try:
        with client.websocket_connect("/ws?token=garbage") as ws:
            ws.receive_json()
    except WebSocketDisconnect as e:
        assert e.code == 4401
    else:
        raise AssertionError("expected disconnect")


def test_report_exports(client, hr):
    pdf = client.get("/api/reports/attrition?format=pdf", headers=hr)
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    xlsx = client.get("/api/reports/employees?format=xlsx", headers=hr)
    assert xlsx.status_code == 200 and xlsx.content.startswith(b"PK")
    js = client.get("/api/reports/attendance", headers=hr).json()
    assert js["rows"] and js["columns"]
