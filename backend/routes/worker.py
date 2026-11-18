"""Authenticated outbound-HTTPS worker queue for opt-in remote CodeBERT analysis.

Only this router can disclose queued source code to the worker. Instructor JWTs
are NOT worker credentials. Lease tokens are per-job secrets and stored hashed.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.analysis import _broadcast
from backend.database import SessionLocal, get_db
from backend.models import Lobby, Submission, WorkerHeartbeat
from backend.security import get_current_instructor
from backend.time_utils import utc_isoformat
from backend.worker_mode import remote_mode

log = logging.getLogger(__name__)
router = APIRouter(tags=["Remote CodeBERT Worker"])
LEASE_SECONDS = 600
HEARTBEAT_ONLINE_SECONDS = 70
MAX_ATTEMPTS = 3


def _require_remote() -> None:
    if not remote_mode():
        raise HTTPException(status_code=503, detail="Remote inference mode is not enabled on this backend.")


def _require_worker(authorization: str | None = Header(default=None)) -> None:
    _require_remote()
    expected = os.getenv("CODEAUTHENTIC_WORKER_TOKEN", "")
    # Invalid/missing configuration must fail closed. Do not log credentials.
    if len(expected) < 32:
        raise HTTPException(status_code=503, detail="Remote worker authentication is not configured.")
    supplied = (authorization or "").removeprefix("Bearer ")
    if not authorization or not authorization.startswith("Bearer ") or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Invalid worker credential.")


class WorkerIdentity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    worker_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{3,64}$")


class JobAction(WorkerIdentity):
    claim_token: str = Field(min_length=32, max_length=256)


class JobComplete(JobAction):
    ai_probability: float = Field(ge=0, le=1, allow_inf_nan=False)
    risk_level: Literal["Low", "Medium", "High"]


class JobFail(JobAction):
    error_code: Literal["model_unavailable", "invalid_source", "inference_error"]


def _mark_seen(db: Session, worker_id: str, now: datetime) -> None:
    """Atomic heartbeat upsert, supported on both PostgreSQL and SQLite."""
    from sqlalchemy import text
    db.execute(text(
        "INSERT INTO worker_heartbeats (worker_id, started_at, last_seen_at) "
        "VALUES (:worker_id, :now, :now) "
        "ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at"
    ), {"worker_id": worker_id, "now": now})


@router.post("/worker/heartbeat", dependencies=[Depends(_require_worker)])
def heartbeat(body: WorkerIdentity, db: Session = Depends(get_db)) -> dict:
    now = datetime.utcnow()
    _mark_seen(db, body.worker_id, now)
    db.commit()
    return {"status": "connected", "server_time": utc_isoformat(now)}


@router.post("/worker/jobs/claim", dependencies=[Depends(_require_worker)])
def claim_job(body: WorkerIdentity, db: Session = Depends(get_db)) -> dict:
    now = datetime.utcnow()
    _mark_seen(db, body.worker_id, now)
    # SKIP LOCKED keeps concurrent workers from claiming the same row on PG.
    # No database transaction remains open while the model runs.
    query = (db.query(Submission)
             .filter(Submission.status == "pending")
             .order_by(Submission.created_at.asc(), Submission.id.asc()))
    if db.bind.dialect.name == "postgresql":
        query = query.with_for_update(skip_locked=True, of=Submission)
    sub = query.first()
    if sub is None:
        db.commit()
        return {"job": None}
    claim_token = secrets.token_urlsafe(48)
    sub.status = "analyzing"
    sub.ai_probability = None
    sub.risk_level = None
    sub.error_message = None
    sub.analysis_started_at = now
    sub.analysis_finished_at = None
    sub.worker_claim_hash = hashlib.sha256(claim_token.encode()).hexdigest()
    sub.worker_claimed_by = body.worker_id
    sub.worker_lease_expires_at = now + timedelta(seconds=LEASE_SECONDS)
    sub.worker_attempts = (sub.worker_attempts or 0) + 1
    # Keep the selected fields before closing the transaction.
    response = {"id": sub.id, "file_name": sub.file_name,
                "language": sub.language, "source_code": sub.source_code,
                "claim_token": claim_token, "lease_seconds": LEASE_SECONDS}
    db.commit()
    _broadcast(sub)
    return {"job": response}


def _owned_claim(db: Session, job_id: int, body: JobAction) -> Submission:
    now = datetime.utcnow()
    query = db.query(Submission).filter(Submission.id == job_id)
    if db.bind.dialect.name == "postgresql":
        query = query.with_for_update(of=Submission)
    sub = query.first()
    digest = hashlib.sha256(body.claim_token.encode()).hexdigest()
    if (sub is None or sub.status != "analyzing"
        or not sub.worker_claim_hash or not hmac.compare_digest(sub.worker_claim_hash, digest)
        or sub.worker_claimed_by != body.worker_id
        or sub.worker_lease_expires_at is None or sub.worker_lease_expires_at <= now):
        raise HTTPException(status_code=409, detail="Job lease expired, replaced, or already completed.")
    return sub


@router.post("/worker/jobs/{job_id}/renew", dependencies=[Depends(_require_worker)])
def renew_job(job_id: int, body: JobAction, db: Session = Depends(get_db)) -> dict:
    sub = _owned_claim(db, job_id, body)
    sub.worker_lease_expires_at = datetime.utcnow() + timedelta(seconds=LEASE_SECONDS)
    _mark_seen(db, body.worker_id, datetime.utcnow())
    db.commit()
    return {"renewed": True}


def _release_claim(sub: Submission) -> None:
    sub.worker_claim_hash = None
    sub.worker_claimed_by = None
    sub.worker_lease_expires_at = None


@router.post("/worker/jobs/{job_id}/complete", dependencies=[Depends(_require_worker)])
def complete_job(job_id: int, body: JobComplete, db: Session = Depends(get_db)) -> dict:
    sub = _owned_claim(db, job_id, body)
    from ml.predictor import risk_level
    # ml.predictor.analyze rounds probabilities to 4 decimals *after* it
    # computes the risk bucket. A value like 0.69999 is legitimately Medium
    # although its transmitted score rounds to 0.7000. Preserve that result.
    boundary_compatible = (
        (body.ai_probability == 0.4 and body.risk_level in ("Low", "Medium"))
        or (body.ai_probability == 0.7 and body.risk_level in ("Medium", "High"))
    )
    if body.risk_level != risk_level(body.ai_probability) and not boundary_compatible:
        raise HTTPException(status_code=422, detail="Score and risk level do not agree.")
    sub.status = "done"
    sub.ai_probability = body.ai_probability
    sub.risk_level = body.risk_level
    sub.error_message = None
    sub.analysis_finished_at = datetime.utcnow()
    _release_claim(sub)
    _mark_seen(db, body.worker_id, datetime.utcnow())
    db.commit()
    _broadcast(sub)
    return {"saved": True}


@router.post("/worker/jobs/{job_id}/fail", dependencies=[Depends(_require_worker)])
def fail_job(job_id: int, body: JobFail, db: Session = Depends(get_db)) -> dict:
    sub = _owned_claim(db, job_id, body)
    sub.status = "failed"
    sub.ai_probability = None
    sub.risk_level = None
    sub.error_message = f"CodeBERT worker reported {body.error_code}; no prediction was generated."
    sub.analysis_finished_at = datetime.utcnow()
    _release_claim(sub)
    _mark_seen(db, body.worker_id, datetime.utcnow())
    db.commit()
    _broadcast(sub)
    return {"saved": True}


@router.get("/instructor/worker-status")
def instructor_worker_status(current_instructor=Depends(get_current_instructor),
                             db: Session = Depends(get_db)) -> dict:
    if not remote_mode():
        return {"mode": "local", "connected": False, "last_seen_at": None,
                "queued": 0, "analyzing": 0}
    now = datetime.utcnow()
    last_seen = db.query(func.max(WorkerHeartbeat.last_seen_at)).scalar()
    owned = db.query(Submission.id).join(Lobby, Submission.lobby_id == Lobby.id).filter(
        Lobby.instructor_id == current_instructor.id
    )
    queued = owned.filter(Submission.status == "pending").count()
    analyzing = owned.filter(Submission.status == "analyzing").count()
    return {"mode": "remote", "connected": bool(last_seen and (now-last_seen).total_seconds() <= HEARTBEAT_ONLINE_SECONDS),
            "last_seen_at": utc_isoformat(last_seen) if last_seen else None,
            "queued": queued, "analyzing": analyzing}


def recover_expired_leases() -> int:
    """Reschedule only genuinely expired remote jobs; pending jobs never time out.

    A late completion cannot overwrite the reassigned job because it lacks the
    new random claim token. This function is safe to run every minute.
    """
    now = datetime.utcnow()
    db = SessionLocal()
    recovered = 0
    changed = []
    try:
        expired = (db.query(Submission)
                   .filter(Submission.status == "analyzing")
                   .filter(Submission.worker_lease_expires_at.isnot(None))
                   .filter(Submission.worker_lease_expires_at < now)
                   .order_by(Submission.id.asc())
                   .limit(100))
        if db.bind.dialect.name == "postgresql":
            expired = expired.with_for_update(skip_locked=True, of=Submission)
        for sub in expired.all():
            if (sub.worker_attempts or 0) >= MAX_ATTEMPTS:
                sub.status = "failed"
                sub.error_message = ("CodeBERT worker disconnected repeatedly. "
                                     "No prediction was generated; ask the instructor to resubmit.")
                sub.analysis_finished_at = now
            else:
                sub.status = "pending"
                sub.error_message = None
                sub.analysis_started_at = None
                sub.analysis_finished_at = None
            sub.ai_probability = None
            sub.risk_level = None
            _release_claim(sub)
            changed.append(sub)
            recovered += 1
        # Jobs from a previous localhost process that were analyzing when the
        # remote mode was activated have no lease; do not silently take over.
        db.commit()
        for sub in changed:
            _broadcast(sub)
    except Exception:
        recovered = 0
        db.rollback()
        log.exception("Remote lease recovery failed")
    finally:
        db.close()
    return recovered
