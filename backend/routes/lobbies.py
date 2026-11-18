"""
Lobby management routes for instructors and public lobby status query.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Instructor, Lobby, Submission
from backend.schemas import (
    LobbyCreate,
    LobbyExtendRequest,
    LobbyDetailResponse,
    LobbyPublicStatus,
    LobbyResponse,
    SubmissionCodeResponse,
)
from backend.security import get_current_instructor

router = APIRouter(tags=["Lobbies"])
logger = logging.getLogger(__name__)


def _shareable_lobby_url(request: Request, lobby_id: uuid.UUID) -> str:
    """Builds a student URL using the configured public origin when available."""
    frontend_url = os.getenv("FRONTEND_PUBLIC_URL", "").strip().rstrip("/")
    if frontend_url:
        return f"{frontend_url}/?lobby={lobby_id}"
    # Backwards-compatible fallback for the standalone FastAPI HTML student portal.
    base_url = os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")
    if not base_url:
        base_url = str(request.base_url).rstrip("/")
    return f"{base_url}/lobby/{lobby_id}"


@router.post("/lobbies", response_model=LobbyResponse, status_code=status.HTTP_201_CREATED)
def create_lobby(
    payload: LobbyCreate,
    request: Request,
    current_instructor: Instructor = Depends(get_current_instructor),
    db: Session = Depends(get_db),
) -> LobbyResponse:
    """
    Creates a new exam lobby for the logged-in instructor with a unique UUID.
    Sets expiration time based on duration_minutes.
    """
    now = datetime.utcnow()
    expires_at = now + timedelta(minutes=payload.duration_minutes)

    lobby = Lobby(
        id=uuid.uuid4(),
        instructor_id=current_instructor.id,
        subject=payload.subject.strip(),
        title=payload.title.strip(),
        language=payload.language,
        max_students=payload.max_students,
        status="ACTIVE",
        created_at=now,
        expires_at=expires_at,
    )
    db.add(lobby)
    db.commit()  # expire_on_commit=False retains the just-written lobby fields.

    # Construct shareable URL
    shareable_url = _shareable_lobby_url(request, lobby.id)

    return LobbyResponse(
        id=lobby.id,
        instructor_id=lobby.instructor_id,
        subject=lobby.subject,
        title=lobby.title,
        language=lobby.language,
        max_students=lobby.max_students,
        status=lobby.status,
        created_at=lobby.created_at,
        expires_at=lobby.expires_at,
        shareable_url=shareable_url,
    )


def lock_expired_lobbies(db: Session, instructor_id: int, now: datetime) -> None:
    """Expire an instructor's old lobbies in one transaction, not per row."""
    updated = (
        db.query(Lobby)
        .filter(
            Lobby.instructor_id == instructor_id,
            Lobby.status == "ACTIVE",
            Lobby.expires_at <= now,
        )
        .update({Lobby.status: "LOCKED"}, synchronize_session=False)
    )
    if updated:
        db.commit()


@router.get("/lobbies", response_model=List[LobbyResponse])
def get_instructor_lobbies(
    request: Request,
    current_instructor: Instructor = Depends(get_current_instructor),
    db: Session = Depends(get_db),
) -> List[LobbyResponse]:
    """
    Returns all lobbies created by the authenticated instructor.
    Automatically checks and marks expired lobbies as LOCKED.
    """
    now = datetime.utcnow()
    lock_expired_lobbies(db, current_instructor.id, now)
    lobbies = (
        db.query(Lobby)
        .filter(Lobby.instructor_id == current_instructor.id)
        .order_by(Lobby.created_at.desc())
        .all()
    )

    result: List[LobbyResponse] = []

    for lobby in lobbies:
        result.append(
            LobbyResponse(
                id=lobby.id,
                instructor_id=lobby.instructor_id,
                subject=lobby.subject,
                title=lobby.title,
                language=lobby.language,
                max_students=lobby.max_students,
                status=lobby.status,
                created_at=lobby.created_at,
                expires_at=lobby.expires_at,
                shareable_url=_shareable_lobby_url(request, lobby.id),
            )
        )

    return result


@router.get("/lobbies/{lobby_id}", response_model=LobbyDetailResponse)
def get_lobby_detail(
    lobby_id: uuid.UUID,
    request: Request,
    current_instructor: Instructor = Depends(get_current_instructor),
    db: Session = Depends(get_db),
) -> LobbyDetailResponse:
    """
    Retrieves full lobby details including all student submissions.
    Enforces ownership check: instructors can only view their own lobbies.
    """
    lobby = db.query(Lobby).filter(Lobby.id == lobby_id).first()
    if not lobby:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lobby not found")

    if lobby.instructor_id != current_instructor.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to view this lobby.",
        )

    # Check auto-expiry
    if lobby.status == "ACTIVE" and datetime.utcnow() >= lobby.expires_at:
        lobby.status = "LOCKED"
        db.commit()

    return LobbyDetailResponse(
        id=lobby.id,
        instructor_id=lobby.instructor_id,
        subject=lobby.subject,
        title=lobby.title,
        language=lobby.language,
        max_students=lobby.max_students,
        status=lobby.status,
        created_at=lobby.created_at,
        expires_at=lobby.expires_at,
        shareable_url=_shareable_lobby_url(request, lobby.id),
        submissions=lobby.submissions,
    )


@router.get(
    "/lobbies/{lobby_id}/submissions/{submission_id}/code",
    response_model=SubmissionCodeResponse,
)
def get_submission_code(
    lobby_id: uuid.UUID,
    submission_id: int,
    response: Response,
    current_instructor: Instructor = Depends(get_current_instructor),
    db: Session = Depends(get_db),
) -> SubmissionCodeResponse:
    """Fetch saved source code on demand, strictly limited to the lobby owner.

    This endpoint is intentionally separate from the dashboard's summary payload:
    large/private student code is not sent repeatedly on each refresh or broadcast.
    """
    lobby = (
        db.query(Lobby)
        .filter(Lobby.id == lobby_id, Lobby.instructor_id == current_instructor.id)
        .first()
    )
    if lobby is None:
        raise HTTPException(status_code=404, detail="Submission not found in your lobby.")

    submission = (
        db.query(Submission)
        .filter(Submission.id == submission_id, Submission.lobby_id == lobby_id)
        .first()
    )
    if submission is None:
        raise HTTPException(status_code=404, detail="Submission not found in your lobby.")

    # Use the same real CodeBERT tokenizer used by upload validation. If it is
    # offline/uninstalled, show 'unavailable' rather than an invented token count.
    response.headers["Cache-Control"] = "no-store"
    token_count = None
    try:
        from ml.predictor import count_tokens
        token_count = count_tokens(submission.source_code, submission.language, local_files_only=True)
    except Exception as exc:
        logger.warning("Could not calculate CodeBERT tokens for submission %s: %s", submission_id, exc)

    return SubmissionCodeResponse(
        id=submission.id,
        lobby_id=submission.lobby_id,
        source_code=submission.source_code,
        token_count=token_count,
    )


@router.post("/lobbies/{lobby_id}/lock", response_model=LobbyResponse)
def lock_lobby(
    lobby_id: uuid.UUID,
    request: Request,
    current_instructor: Instructor = Depends(get_current_instructor),
    db: Session = Depends(get_db),
) -> LobbyResponse:
    """
    Manually locks an active lobby session.
    """
    lobby = db.query(Lobby).filter(Lobby.id == lobby_id).first()
    if not lobby:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lobby not found")

    if lobby.instructor_id != current_instructor.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to modify this lobby.",
        )

    lobby.status = "LOCKED"
    db.commit()  # expire_on_commit=False retains the just-written lobby fields.

    return LobbyResponse(
        id=lobby.id,
        instructor_id=lobby.instructor_id,
        subject=lobby.subject,
        title=lobby.title,
        language=lobby.language,
        max_students=lobby.max_students,
        status=lobby.status,
        created_at=lobby.created_at,
        expires_at=lobby.expires_at,
        shareable_url=_shareable_lobby_url(request, lobby.id),
    )


@router.post("/lobbies/{lobby_id}/unlock", response_model=LobbyResponse)
def unlock_lobby(
    lobby_id: uuid.UUID,
    request: Request,
    current_instructor: Instructor = Depends(get_current_instructor),
    db: Session = Depends(get_db),
) -> LobbyResponse:
    """Reopens an owned lobby only while its configured duration remains active."""
    lobby = db.query(Lobby).filter(Lobby.id == lobby_id).first()
    if not lobby:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lobby not found")

    if lobby.instructor_id != current_instructor.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to modify this lobby.",
        )

    if datetime.now(timezone.utc).replace(tzinfo=None) >= lobby.expires_at:
        lobby.status = "LOCKED"
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This lobby has expired. Use Extend & Reopen to set a new duration.",
        )

    lobby.status = "ACTIVE"
    db.commit()  # expire_on_commit=False retains the just-written lobby fields.

    return LobbyResponse(
        id=lobby.id,
        instructor_id=lobby.instructor_id,
        subject=lobby.subject,
        title=lobby.title,
        language=lobby.language,
        max_students=lobby.max_students,
        status=lobby.status,
        created_at=lobby.created_at,
        expires_at=lobby.expires_at,
        shareable_url=_shareable_lobby_url(request, lobby.id),
    )


@router.post("/lobbies/{lobby_id}/extend-and-reopen", response_model=LobbyResponse)
@router.post("/lobbies/{lobby_id}/extend-reopen", response_model=LobbyResponse, include_in_schema=False)
def extend_and_reopen_lobby(
    lobby_id: uuid.UUID,
    payload: LobbyExtendRequest,
    request: Request,
    current_instructor: Instructor = Depends(get_current_instructor),
    db: Session = Depends(get_db),
) -> LobbyResponse:
    """Owner-only, explicit new window for an expired lobby.

    Changes only expires_at and status. Reuses the lobby UUID and preserves all
    student submissions, CodeBERT results, subject, language and student limit.
    """
    lobby = db.query(Lobby).filter(Lobby.id == lobby_id).with_for_update().first()
    if lobby is None:
        raise HTTPException(status_code=404, detail="Lobby not found")
    if lobby.instructor_id != current_instructor.id:
        raise HTTPException(status_code=403, detail="You do not have permission to modify this lobby.")

    now = datetime.utcnow()
    if now < lobby.expires_at:
        raise HTTPException(
            status_code=409,
            detail="This lobby has not expired. Use Unlock for a manually locked lobby.",
        )

    # A fresh period begins now, not at the original (potentially days-old)
    # expiry. The original session identifier and all student records remain.
    lobby.expires_at = now + timedelta(minutes=payload.duration_minutes)
    lobby.status = "ACTIVE"
    db.commit()

    return LobbyResponse(
        id=lobby.id,
        instructor_id=lobby.instructor_id,
        subject=lobby.subject,
        title=lobby.title,
        language=lobby.language,
        max_students=lobby.max_students,
        status=lobby.status,
        created_at=lobby.created_at,
        expires_at=lobby.expires_at,
        shareable_url=_shareable_lobby_url(request, lobby.id),
    )


@router.delete("/lobbies/{lobby_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lobby(
    lobby_id: uuid.UUID,
    current_instructor: Instructor = Depends(get_current_instructor),
    db: Session = Depends(get_db),
) -> None:
    """Deletes an owned lobby and its related submissions."""
    lobby = db.query(Lobby).filter(Lobby.id == lobby_id).first()
    if not lobby:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lobby not found")

    if lobby.instructor_id != current_instructor.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to delete this lobby.",
        )

    db.delete(lobby)
    db.commit()


@router.get("/public/lobbies/{lobby_id}/status", response_model=LobbyPublicStatus)
def get_public_lobby_status(
    lobby_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> LobbyPublicStatus:
    """
    Public endpoint for student portal check.
    Returns ONLY active flag and title. Never returns submissions or scores.
    """
    lobby = db.query(Lobby).filter(Lobby.id == lobby_id).first()
    if not lobby:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lobby not found")

    now = datetime.utcnow()
    expired = now >= lobby.expires_at
    # Preserve existing backend enforcement; an expired active lobby is locked.
    if lobby.status == "ACTIVE" and expired:
        lobby.status = "LOCKED"
        db.commit()

    is_active = lobby.status == "ACTIVE" and not expired
    return LobbyPublicStatus(
        active=is_active,
        subject=lobby.subject,
        title=lobby.title,
        language=lobby.language,
        closed_reason=None if is_active else ("expired" if expired else "instructor_locked"),
        expires_at=lobby.expires_at,
    )
