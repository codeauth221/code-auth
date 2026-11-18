"""Safe, local-only public-status tests. Creates an in-memory SQLite DB."""
from datetime import datetime, timedelta, timezone
import uuid
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.database import Base, get_db
from backend.models import Instructor, Lobby
try:
    from backend.security import get_current_instructor
except ModuleNotFoundError as exc:
    if exc.name != 'jose':
        raise
    import sys, types
    fake_security = types.ModuleType('backend.security')
    def get_current_instructor():
        raise RuntimeError('Instructor dependency must be overridden in tests')
    fake_security.get_current_instructor = get_current_instructor
    sys.modules['backend.security'] = fake_security
from backend.routes.lobbies import router


@pytest.fixture()
def fixture():
    engine = create_engine('sqlite://', connect_args={'check_same_thread':False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    now = datetime.utcnow()
    kinds = {
        'manual': ('LOCKED', now + timedelta(minutes=90)),
        'expired': ('LOCKED', now - timedelta(minutes=2)),
        'active': ('ACTIVE', now + timedelta(minutes=90)),
        'just_expired': ('ACTIVE', now - timedelta(seconds=20)),
    }
    ids = {kind:uuid.uuid4() for kind in kinds}
    with Session() as db:
        db.add(Instructor(id=101, name='Owner',email='owner@example.test',password_hash='test'))
        for kind, (state,expires) in kinds.items():
            db.add(Lobby(id=ids[kind],instructor_id=101,title='Finals',subject='ITE 1111',language='c',status=state,max_students=35,created_at=now-timedelta(hours=2),expires_at=expires))
        db.commit()
    app=FastAPI(); app.include_router(router)
    def override():
        with Session() as db: yield db
    app.dependency_overrides[get_db]=override
    with TestClient(app) as client:
        yield client, Session, ids
    engine.dispose()

@pytest.mark.parametrize('kind,expected_active,reason',[
    ('manual',False,'instructor_locked'),
    ('expired',False,'expired'),
    ('active',True,None),
    ('just_expired',False,'expired'),
])
def test_public_reason_and_expiration(fixture,kind,expected_active,reason):
    client,Session,ids=fixture
    reply=client.get(f'/public/lobbies/{ids[kind]}/status')
    assert reply.status_code==200
    data=reply.json()
    assert data['active'] is expected_active
    assert data['closed_reason'] == reason
    assert data['expires_at'].endswith('Z')
    assert datetime.fromisoformat(data['expires_at'].replace('Z','+00:00')).tzinfo is not None
    assert data['subject']=='ITE 1111'
    assert 'submissions' not in data and 'instructor_id' not in data
    with Session() as db:
        row=db.get(Lobby,ids[kind])
        assert row.status==('LOCKED' if not expected_active else 'ACTIVE')

def test_missing_lobby_returns_404(fixture):
    client,_,_=fixture
    assert client.get(f'/public/lobbies/{uuid.uuid4()}/status').status_code==404
