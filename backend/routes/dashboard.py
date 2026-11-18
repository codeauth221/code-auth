"""Single-request, instructor-owned dashboard summary.

No student source_code is loaded or serialized here. The code viewer remains a
separate, owner-checked endpoint, requested only when Inspect is opened.
"""
from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Instructor, Lobby, Submission
from backend.schemas import InstructorDashboardResponse, LobbyResponse, SubmissionResponse
from backend.security import get_current_instructor
from backend.routes.lobbies import _shareable_lobby_url

router = APIRouter(tags=["Instructor Dashboard"])


@router.get("/instructor/dashboard", response_model=InstructorDashboardResponse)
def get_dashboard_summary(
    request: Request,
    current_instructor: Instructor = Depends(get_current_instructor),
    db: Session = Depends(get_db),
) -> InstructorDashboardResponse:
    """Get all owned lobbies and submission metadata with two SELECTs.

    Do not expose source_code. The existing protected code endpoint remains the
    only place from which instructors can retrieve student source files.
    """
    now = datetime.utcnow()
    # One SQL round trip combines owned lobbies with submission metadata.
    # Column projection is essential: never load a submitted source_code here.
    rows = (
        db.query(
            Lobby,
            Submission.id.label("submission_id"),
            Submission.student_id,
            Submission.file_name,
            Submission.language.label("submission_language"),
            Submission.status.label("submission_status"),
            Submission.ai_probability,
            Submission.risk_level,
            Submission.error_message,
            Submission.created_at.label("submission_created_at"),
            Submission.analysis_started_at,
            Submission.analysis_finished_at,
        )
        .outerjoin(Submission, Submission.lobby_id == Lobby.id)
        .filter(Lobby.instructor_id == current_instructor.id)
        .order_by(Lobby.created_at.desc(), Submission.created_at.desc(), Submission.id.desc())
        .all()
    )
    lobby_responses = []
    seen_lobbies = set()
    submissions = []
    expired_ids = set()
    for (
        lobby, submission_id, student_id, file_name, submission_language,
        submission_status, ai_probability, risk_level, error_message,
        submission_created_at, analysis_started_at, analysis_finished_at,
    ) in rows:
        if lobby.id not in seen_lobbies:
            seen_lobbies.add(lobby.id)
            expired = lobby.status == "ACTIVE" and lobby.expires_at <= now
            if expired:
                expired_ids.add(lobby.id)
            lobby_responses.append(
                LobbyResponse.model_validate(lobby).model_copy(update={
                    "shareable_url": _shareable_lobby_url(request, lobby.id),
                    "status": "LOCKED" if expired else lobby.status,
                })
            )
        if submission_id is not None:
            submissions.append(SubmissionResponse(
                id=submission_id,
                lobby_id=lobby.id,
                student_id=student_id,
                file_name=file_name,
                language=submission_language,
                status=submission_status,
                ai_probability=ai_probability,
                risk_level=risk_level,
                error_message=error_message,
                created_at=submission_created_at,
                analysis_started_at=analysis_started_at,
                analysis_finished_at=analysis_finished_at,
            ))

    # Serialize before any commit; do not produce lazy-refresh database calls.
    response = InstructorDashboardResponse(lobbies=lobby_responses, submissions=submissions)
    if expired_ids:
        db.query(Lobby).filter(
            Lobby.instructor_id == current_instructor.id,
            Lobby.id.in_(expired_ids),
            Lobby.status == "ACTIVE",
        ).update({Lobby.status: "LOCKED"}, synchronize_session=False)
        db.commit()
    return response
