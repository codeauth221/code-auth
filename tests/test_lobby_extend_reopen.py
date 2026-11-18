"""Safe, isolated tests: no real accounts, Postgres data, or CodeBERT files."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base, get_db
from backend.models import Instructor, Lobby, Submission
# The isolated test can run without the optional JWT dependency. The real
# application keeps its own authentication; this shim is test-local only.
try:
    from backend.security import get_current_instructor
except ModuleNotFoundError as exc:
    if exc.name != 'jose':
        raise
    import sys
    import types
    fake_security = types.ModuleType('backend.security')
    def get_current_instructor():
        raise RuntimeError('Test dependency must be overridden')
    fake_security.get_current_instructor = get_current_instructor
    sys.modules['backend.security'] = fake_security
from backend.routes import lobbies


@pytest.fixture()
def workspace():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    old_id, recent_id = uuid.uuid4(), uuid.uuid4()
    old_created = datetime.utcnow() - timedelta(days=3)
    with Session() as db:
        db.add_all([
            Instructor(id=101, name='Owner', email='owner@example.test', password_hash='test'),
            Instructor(id=102, name='Another', email='other@example.test', password_hash='test'),
            Lobby(id=old_id, instructor_id=101, title='Finals', subject='ITE 1111',
                  language='c', status='LOCKED', max_students=35,
                  created_at=old_created, expires_at=old_created + timedelta(hours=2)),
            Lobby(id=recent_id, instructor_id=101, title='Manual lock', subject='ITE 2222',
                  language='python', status='LOCKED', max_students=30,
                  created_at=datetime.utcnow(), expires_at=datetime.utcnow() + timedelta(hours=2)),
            Submission(lobby_id=old_id, student_id='221-12345', file_name='before.c',
                       language='c', source_code='int main(void) { return 0; }', status='done',
                       ai_probability=0.42, risk_level='Medium', created_at=old_created),
        ])
        db.commit()
    app = FastAPI()
    app.include_router(lobbies.router)
    def db_override():
        with Session() as db:
            yield db
    app.dependency_overrides[get_db] = db_override
    def as_instructor(user_id):
        app.dependency_overrides[get_current_instructor] = lambda: SimpleNamespace(id=user_id)
    with TestClient(app) as client:
        yield client, Session, old_id, recent_id, as_instructor
    engine.dispose()


def test_expired_lobby_requires_explicit_extension(workspace):
    client, Session, old_id, _, as_instructor = workspace
    as_instructor(101)
    old_unlock = client.post(f'/lobbies/{old_id}/unlock')
    assert old_unlock.status_code == 400
    assert 'Extend & Reopen' in old_unlock.json()['detail']
    response = client.post(f'/lobbies/{old_id}/extend-and-reopen', json={'duration_minutes':60})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload['id'] == str(old_id)
    assert payload['status'] == 'ACTIVE'
    assert payload['subject'] == 'ITE 1111'
    assert payload['language'] == 'c'
    remaining = datetime.fromisoformat(payload['expires_at'].replace('Z', '+00:00'))
    assert 59*60 < (remaining - datetime.now(timezone.utc)).total_seconds() < 61*60
    with Session() as db:
        row=db.query(Lobby).filter_by(id=old_id).one()
        submission=db.query(Submission).filter_by(lobby_id=old_id).one()
        assert row.status == 'ACTIVE' and row.max_students == 35
        assert submission.source_code == 'int main(void) { return 0; }'
        assert submission.ai_probability == 0.42 and submission.risk_level == 'Medium'
    public = client.get(f'/public/lobbies/{old_id}/status')
    assert public.status_code == 200 and public.json()['active'] is True


def test_owner_only(workspace):
    client, Session, old_id, _, as_instructor = workspace
    as_instructor(102)
    reply = client.post(f'/lobbies/{old_id}/extend-and-reopen', json={'duration_minutes':60})
    assert reply.status_code == 403
    with Session() as db:
        assert db.get(Lobby,old_id).status == 'LOCKED'


def test_missing_lobby_404(workspace):
    client, _, _, _, as_instructor = workspace
    as_instructor(101)
    assert client.post(f'/lobbies/{uuid.uuid4()}/extend-and-reopen', json={'duration_minutes':60}).status_code == 404


@pytest.mark.parametrize('invalid',[0, 9, 1441, -1, 3.5, '60', None])
def test_invalid_durations_rejected(workspace, invalid):
    client, Session, old_id, _, as_instructor = workspace
    as_instructor(101)
    resp = client.post(f'/lobbies/{old_id}/extend-and-reopen', json={'duration_minutes':invalid})
    assert resp.status_code == 422, resp.text
    with Session() as db:
        assert db.get(Lobby,old_id).status == 'LOCKED'


def test_manual_lock_uses_normal_unlock_not_extension(workspace):
    client, _, _, recent_id, as_instructor = workspace
    as_instructor(101)
    assert client.post(f'/lobbies/{recent_id}/extend-and-reopen', json={'duration_minutes':60}).status_code == 409
    assert client.post(f'/lobbies/{recent_id}/unlock').status_code == 200
    assert client.post(f'/lobbies/{recent_id}/lock').status_code == 200
