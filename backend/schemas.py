"""
Pydantic schemas for request validation and response serialization.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, List, Literal, Optional
from pydantic import BaseModel, Field, StringConstraints, field_serializer

try:
    import email_validator  # noqa: F401
    from pydantic import EmailStr
except ImportError:
    # Resilient fallback if email-validator is not installed
    EmailStr = Annotated[str, StringConstraints(pattern=r"^[\w\.\+\-]+@[a-zA-Z0-9\-]+\.[a-zA-Z0-9\-\.]+$")]

from backend.time_utils import utc_isoformat

# ==============================================================================
# Authentication & Instructor Schemas
# ==============================================================================

class InstructorBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    email: EmailStr


class InstructorCreate(InstructorBase):
    password: str = Field(..., min_length=6, max_length=100)


class InstructorLogin(BaseModel):
    email: EmailStr
    password: str


class RegistrationMessage(BaseModel):
    message: str


class InstructorResponse(InstructorBase):
    id: int
    created_at: datetime

    @field_serializer("created_at", when_used="json")
    def serialize_created_at(self, value: datetime) -> str:
        return utc_isoformat(value)

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    email: Optional[str] = None
    instructor_id: Optional[int] = None


# ==============================================================================
# Submission Schemas
# ==============================================================================

class SubmissionBase(BaseModel):
    student_id: str = Field(..., min_length=1, max_length=50)
    file_name: str = Field(..., min_length=1, max_length=255)
    language: str = Field(..., pattern="^(c|java|python)$")


class SubmissionResponse(SubmissionBase):
    id: int
    lobby_id: uuid.UUID
    status: str  # pending | done | failed
    ai_probability: Optional[float] = None
    risk_level: Optional[str] = None  # Low | Medium | High
    error_message: Optional[str] = None
    created_at: datetime
    analysis_started_at: Optional[datetime] = None
    analysis_finished_at: Optional[datetime] = None

    @field_serializer("created_at", "analysis_started_at", "analysis_finished_at", when_used="json")
    def serialize_submission_time(self, value: Optional[datetime]) -> Optional[str]:
        return utc_isoformat(value) if value is not None else None

    class Config:
        from_attributes = True


class SubmissionCodeResponse(BaseModel):
    """Private code payload returned only to the instructor who owns the lobby.

    A missing token_count means the CodeBERT tokenizer was unavailable, NOT zero tokens.
    """
    id: int
    lobby_id: uuid.UUID
    source_code: str
    token_count: Optional[int] = None


# ==============================================================================
# Lobby Schemas
# ==============================================================================

class LobbyCreate(BaseModel):
    subject: str = Field(default="", max_length=255)
    title: str = Field(..., min_length=2, max_length=200)
    duration_minutes: int = Field(..., ge=1, le=1440)  # Up to 24 hours
    language: Literal["c", "java", "python"] = "python"
    max_students: int = Field(default=35, ge=1, le=150)


class LobbyExtendRequest(BaseModel):
    """Additional exam window starting when the instructor reopens an expired lobby."""
    duration_minutes: int = Field(..., ge=10, le=1440, strict=True)


class LobbyResponse(BaseModel):
    id: uuid.UUID
    instructor_id: int
    subject: str = ""
    title: str
    language: Literal["c", "java", "python"]
    max_students: int = 35
    status: str  # ACTIVE | LOCKED
    created_at: datetime
    expires_at: datetime
    shareable_url: Optional[str] = None

    @field_serializer("created_at", "expires_at", when_used="json")
    def serialize_lobby_timestamps(self, value: datetime) -> str:
        return utc_isoformat(value)

    class Config:
        from_attributes = True


class LobbyDetailResponse(LobbyResponse):
    submissions: List[SubmissionResponse] = Field(default_factory=list)

    class Config:
        from_attributes = True


class InstructorDashboardResponse(BaseModel):
    """Owned lobby/submission summaries; code content is never included."""
    lobbies: List[LobbyResponse]
    submissions: List[SubmissionResponse]


class LobbyPublicStatus(BaseModel):
    active: bool
    subject: str = ""
    title: str
    language: Literal["c", "java", "python"]
    # Public status only; no instructor identity, student data, or analysis scores.
    closed_reason: Optional[Literal["expired", "instructor_locked"]] = None
    expires_at: datetime

    @field_serializer("expires_at", when_used="json")
    def serialize_public_expiry(self, value: datetime) -> str:
        return utc_isoformat(value)
