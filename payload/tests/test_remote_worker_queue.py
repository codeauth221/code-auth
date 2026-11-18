"""Isolated queue/security tests; no ML downloads and no real cloud credentials."""
from __future__ import annotations

import os
import sys
import types
import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"

# The production requirements install python-jose. This test is runnable also
# in lightweight source-review environments where that optional module is absent.
try:
    from backend.security import get_current_instructor
except ModuleNotFoundError as exc:
    if exc.name != "jose":
        raise
    shim = types.ModuleType("backend.security")
    def get_current_instructor():
        raise RuntimeError("instructor test dependency not overridden")
    shim.get_current_instructor = get_current_instructor
    sys.modules["backend.security"] = shim
    from backend.routes import worker
else:
    from backend.routes import worker

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base, get_db
from backend.models import Instructor, Lobby, Submission, WorkerHeartbeat
from backend.routes import submissions

TOKEN = "isolated-testing-token-1234567890-abcdefghijklmnopqrstuvwxyz"


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("CODEAUTHENTIC_WORKER_TOKEN", TOKEN)
    monkeypatch.setenv("CODEAUTHENTIC_ANALYSIS_MODE", "remote")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    lobby_id = uuid.uuid4()
    with Session() as db:
        db.add(Instructor(id=123, name="Instructor", email="i@example.test", password_hash="x"))
        db.flush()
        db.add(Lobby(id=lobby_id, instructor_id=123, title="C test", subject="Course", language="c",
                     max_students=10, status="ACTIVE", expires_at=datetime.utcnow() + timedelta(hours=3)))
        db.add_all([
            Submission(lobby_id=lobby_id, student_id="student-1", file_name="todo.c",
                       language="c", source_code="private source 123", status="pending"),
            Submission(lobby_id=lobby_id, student_id="student-2", file_name="next.c",
                       language="c", source_code="private source 456", status="pending"),
        ])
        db.commit()
    app = FastAPI()
    app.include_router(worker.router)
    app.include_router(submissions.router)
    def db_override():
        with Session() as db:
            yield db
    app.dependency_overrides[get_db] = db_override
    app.dependency_overrides[get_current_instructor] = lambda: SimpleNamespace(id=123)
    # Rebinding the module-level factory isolates expired-lease recovery.
    with patch.object(worker, "SessionLocal", Session), patch.object(worker, "_broadcast") as broadcast:
        with TestClient(app) as client:
            yield client, Session, broadcast
    engine.dispose()


def headers(token=TOKEN):
    return {"Authorization": f"Bearer {token}"}


def claim(client):
    return client.post("/worker/jobs/claim", json={"worker_id": "laptop-1"}, headers=headers())


def action(job, **extra):
    return {"worker_id": "laptop-1", "claim_token": job["claim_token"], **extra}


def test_student_upload_stays_queued_in_remote_mode(env):
    client, Session, _ = env
    from ml import predictor
    from backend import analysis
    with Session() as db:
        lobby_id = db.query(Lobby.id).one()[0]
    with patch.object(predictor, "check_context", return_value=40), \
         patch.object(analysis, "run_analysis") as local_inference, \
         patch.object(submissions.manager, "broadcast_threadsafe"):
        response = client.post(
            f"/lobbies/{lobby_id}/submit",
            data={"student_id": "fresh-student"},
            files=[("files", ("new.c", b"int main(void) { return 0; }", "text/plain"))],
        )
    assert response.status_code == 200, response.text
    local_inference.assert_not_called()
    with Session() as db:
        row = db.query(Submission).filter_by(student_id="fresh-student").one()
        assert row.status == "pending" and row.ai_probability is None
        assert row.worker_attempts == 0 and row.worker_claim_hash is None


def test_auth_closed_and_mode_default_local(env, monkeypatch):
    client, Session, _ = env
    assert client.post("/worker/jobs/claim", json={"worker_id": "laptop-1"}).status_code == 401
    assert client.post("/worker/jobs/claim", json={"worker_id": "laptop-1"}, headers=headers("not-the-secret")).status_code == 401
    assert client.post("/worker/jobs/claim", json={"worker_id": "../escape"}, headers=headers()).status_code == 422
    monkeypatch.setenv("CODEAUTHENTIC_ANALYSIS_MODE", "local")
    assert claim(client).status_code == 503
    with Session() as db:
        assert db.query(Submission).filter_by(status="pending").count() == 2


def test_queue_claim_complete_and_visibility(env):
    client, Session, broadcast = env
    response = claim(client)
    assert response.status_code == 200, response.text
    job = response.json()["job"]
    assert job["file_name"] == "todo.c" and job["source_code"] == "private source 123"
    assert len(job["claim_token"]) >= 32
    other = claim(client).json()["job"]
    assert other["id"] != job["id"]
    assert claim(client).json()["job"] is None
    with Session() as db:
        row = db.get(Submission, job["id"])
        assert row.worker_claim_hash != job["claim_token"]
        assert row.source_code == "private source 123"
    denied = client.post(f"/worker/jobs/{job['id']}/complete", headers=headers(),
                         json=action(job, ai_probability=.55, risk_level="High"))
    assert denied.status_code == 422
    denied = client.post(f"/worker/jobs/{job['id']}/complete", headers=headers(),
                         json=action({**job, "claim_token": "wrong-secret-token-123456789012345678901234"},
                                     ai_probability=.55, risk_level="Medium"))
    assert denied.status_code == 409
    renewed = client.post(f"/worker/jobs/{job['id']}/renew", headers=headers(), json=action(job))
    assert renewed.status_code == 200
    completed = client.post(f"/worker/jobs/{job['id']}/complete", headers=headers(),
                            json=action(job, ai_probability=.55, risk_level="Medium"))
    assert completed.status_code == 200, completed.text
    assert client.post(f"/worker/jobs/{job['id']}/complete", headers=headers(),
                       json=action(job, ai_probability=.88, risk_level="High")).status_code == 409
    with Session() as db:
        row = db.get(Submission, job["id"])
        assert row.status == "done" and row.ai_probability == .55
        assert row.risk_level == "Medium" and row.analysis_finished_at is not None
        assert row.worker_claim_hash is None
    assert broadcast.called


def test_model_rounding_threshold_is_respected(env):
    client, Session, _ = env
    job = claim(client).json()["job"]
    # The real predictor computes risk on the unrounded value, then rounds
    # ai_probability to 4 decimals; thus 0.69999 -> 0.7000 and Medium.
    resp = client.post(f"/worker/jobs/{job['id']}/complete", headers=headers(),
                       json=action(job, ai_probability=.7, risk_level="Medium"))
    assert resp.status_code == 200, resp.text
    with Session() as db:
        assert db.get(Submission, job["id"]).risk_level == "Medium"


def test_disconnect_recovery_and_old_token_rejected(env):
    client, Session, _ = env
    job = claim(client).json()["job"]
    with Session() as db:
        sub = db.get(Submission, job["id"])
        sub.worker_lease_expires_at = datetime.utcnow() - timedelta(seconds=1)
        db.commit()
    assert worker.recover_expired_leases() == 1
    old = client.post(f"/worker/jobs/{job['id']}/complete", headers=headers(),
                      json=action(job, ai_probability=.33, risk_level="Low"))
    assert old.status_code == 409
    replacement = claim(client).json()["job"]
    # Original file should be re-queued, but the token must be different.
    assert replacement["id"] == job["id"]
    assert replacement["claim_token"] != job["claim_token"]
    with Session() as db:
        row = db.get(Submission, job["id"])
        assert row.status == "analyzing" and row.worker_attempts == 2


def test_pending_stays_queued_and_failed_after_third_disconnect(env):
    client, Session, _ = env
    with Session() as db:
        rows = db.query(Submission).all()
        rows[1].created_at = datetime.utcnow() - timedelta(days=2)
        db.commit()
    assert worker.recover_expired_leases() == 0
    with Session() as db:
        assert db.query(Submission).filter_by(status="pending").count() == 2
    for attempt in range(3):
        job = claim(client).json()["job"]
        with Session() as db:
            sub = db.get(Submission, job["id"])
            sub.worker_lease_expires_at = datetime.utcnow() - timedelta(seconds=2)
            db.commit()
        assert worker.recover_expired_leases() == 1
    with Session() as db:
        row = db.get(Submission, job["id"])
        assert row.status == "failed" and row.ai_probability is None
        assert row.worker_claim_hash is None
        assert row.error_message and "disconnected" in row.error_message


def test_worker_status_requires_instructor_and_heartbeat(env):
    client, Session, _ = env
    first = client.get('/instructor/worker-status').json()
    assert first['mode'] == 'remote' and first['connected'] is False
    assert first['queued'] == 2
    assert client.post('/worker/heartbeat', json={'worker_id': 'laptop-1'}, headers=headers()).status_code == 200
    second = client.get('/instructor/worker-status').json()
    assert second['connected'] is True and second['last_seen_at'].endswith('Z')
    with Session() as db:
        entry = db.get(WorkerHeartbeat, 'laptop-1')
        entry.last_seen_at = datetime.utcnow() - timedelta(minutes=2)
        db.commit()
    assert client.get('/instructor/worker-status').json()['connected'] is False
