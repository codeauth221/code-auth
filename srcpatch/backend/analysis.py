"""Background CodeBERT analysis with durable status transitions and stale-job recovery.

No simulated predictions. If the process is interrupted, an old pending/analyzing
row becomes FAILED with an explicit explanation instead of staying stuck forever.
The API and the inference engine still share one process; use a separate worker
and sufficient RAM for production-scale inference.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timedelta

from backend.database import SessionLocal
from backend.models import Submission
from backend.time_utils import utc_isoformat
from backend.ws import manager

logger = logging.getLogger(__name__)
inference_lock = threading.Lock()


def _broadcast(submission: Submission) -> None:
    """Notify only this lobby; submitted source code is never included."""
    try:
        manager.broadcast_threadsafe(
            str(submission.lobby_id),
            {
                "type": "submission_updated",
                "submission": {
                    "id": submission.id,
                    "lobby_id": str(submission.lobby_id),
                    "student_id": submission.student_id,
                    "file_name": submission.file_name,
                    "language": submission.language,
                    "status": submission.status,
                    "ai_probability": submission.ai_probability,
                    "risk_level": submission.risk_level,
                    "error_message": submission.error_message,
                    "created_at": utc_isoformat(submission.created_at),
                },
            },
        )
    except Exception:
        logger.exception("Unable to notify lobby for submission %s", submission.id)


def run_analysis(submission_id: int) -> None:
    """Atomically claim pending work, run real inference, commit an explicit result.

    A database transaction is not kept open while the heavy CodeBERT model runs.
    An interrupted process cannot execute its exception handler; the periodic
    stale-job recovery below handles those orphaned rows after a grace period.
    """
    started = time.perf_counter()
    db = SessionLocal()
    try:
        # This update atomically claims a single pending submission, even if two
        # background tasks are inadvertently dispatched for the same record.
        claimed = (
            db.query(Submission)
            .filter(Submission.id == submission_id, Submission.status == "pending")
            .update(
                {
                    Submission.status: "analyzing",
                    Submission.ai_probability: None,
                    Submission.risk_level: None,
                    Submission.error_message: None,
                },
                synchronize_session=False,
            )
        )
        db.commit()
        if not claimed:
            logger.info("[ANALYSIS SKIP] %s was already claimed/completed", submission_id)
            return
        submission = db.query(Submission).filter(Submission.id == submission_id).first()
        if submission is None:
            logger.warning("[ANALYSIS SKIP] %s disappeared after claim", submission_id)
            return
        filename, code = submission.file_name, submission.source_code
        logger.info("[ANALYSIS START] %s: %s (%s)", submission_id, filename, submission.language)
        _broadcast(submission)
    except Exception:
        db.rollback()
        logger.exception("[ANALYSIS CLAIM ERROR] %s", submission_id)
        return
    finally:
        db.close()

    # No DB connection/transaction is held during model inference.
    try:
        # Fail fast on a 512 MB container BEFORE importing/loading heavyweight
        # model weights, protecting the web API from known OOM restarts.
        from ml.predictor import analyze, require_inference_capacity
        require_inference_capacity()
        with inference_lock:
            result = analyze(code, filename)
        ai_probability = float(result["ai_probability"])
        risk_level = str(result["risk_level"])
        final_status, error_message = "done", None
    except Exception as exc:
        logger.exception("[ANALYSIS EXCEPTION] %s", submission_id)
        ai_probability, risk_level = None, None
        final_status = "failed"
        error_message = str(exc) or type(exc).__name__

    db = SessionLocal()
    try:
        # A stale-job recovery may already have marked an old task as failed.
        # Don't allow its late result to overwrite that explicit terminal state.
        updated = (
            db.query(Submission)
            .filter(Submission.id == submission_id, Submission.status == "analyzing")
            .update(
                {
                    Submission.status: final_status,
                    Submission.ai_probability: ai_probability,
                    Submission.risk_level: risk_level,
                    Submission.error_message: error_message,
                },
                synchronize_session=False,
            )
        )
        db.commit()
        if updated:
            submission = db.query(Submission).filter(Submission.id == submission_id).first()
            if submission is not None:
                _broadcast(submission)
        logger.info(
            "[ANALYSIS COMPLETE] %s status=%s elapsed=%.2fs updated=%s",
            submission_id, final_status, time.perf_counter() - started, bool(updated),
        )
    except Exception:
        db.rollback()
        logger.exception("[ANALYSIS SAVE ERROR] %s: recovery will handle an abandoned job", submission_id)
    finally:
        db.close()


def recover_stale_analyses() -> int:
    """Mark old orphaned tasks FAILED; never invent scores or silently retry.

    No schema migration: created_at is the only existing timestamp. The long
    default grace period therefore intentionally errs on the side of NOT
    cancelling a legitimate slow job. Tune only after measuring CPU inference.
    """
    try:
        minutes = max(30, int(os.getenv("CODEAUTHENTIC_ANALYSIS_STALE_MINUTES", "60")))
    except ValueError:
        minutes = 60
    cutoff = datetime.utcnow() - timedelta(minutes=minutes)
    db = SessionLocal()
    recovered = 0
    try:
        # Bounded batch so recovery never loads every historical submission.
        old_ids = [row[0] for row in (
            db.query(Submission.id)
            .filter(Submission.status.in_(["pending", "analyzing"]))
            .filter(Submission.created_at < cutoff)
            .order_by(Submission.created_at.asc())
            .limit(100)
            .all()
        )]
        for submission_id in old_ids:
            # Atomic conditional transition avoids modifying already finished jobs.
            updated = (
                db.query(Submission)
                .filter(Submission.id == submission_id)
                .filter(Submission.status.in_(["pending", "analyzing"]))
                .filter(Submission.created_at < cutoff)
                .update(
                    {
                        Submission.status: "failed",
                        Submission.ai_probability: None,
                        Submission.risk_level: None,
                        Submission.error_message: (
                            "Analysis was interrupted or exceeded the allowed processing window. "
                            "No AI prediction was generated; ask the instructor to resubmit after service recovery."
                        ),
                    },
                    synchronize_session=False,
                )
            )
            db.commit()
            if updated:
                recovered += 1
                submission = db.query(Submission).filter(Submission.id == submission_id).first()
                if submission is not None:
                    _broadcast(submission)
        if recovered:
            logger.warning("[ANALYSIS RECOVERY] Marked %d abandoned submission(s) failed", recovered)
    except Exception:
        db.rollback()
        logger.exception("[ANALYSIS RECOVERY ERROR] Cannot reconcile abandoned jobs")
    finally:
        db.close()
    return recovered
