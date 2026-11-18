"""Offline analysis timer tests. No Hugging Face model weights or production database."""
import os
os.environ['DATABASE_URL'] = 'sqlite://'

import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from backend.database import Base
from backend import analysis, database
from backend.models import Instructor, Lobby, Submission
from backend.schemas import SubmissionResponse
from ml import predictor


class TimingTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        self.original = analysis.SessionLocal
        analysis.SessionLocal = self.Session
        self.broadcast = patch.object(analysis.manager, 'broadcast_threadsafe')
        self.broadcast.start()
        with self.Session() as db:
            instructor = Instructor(name='Tester', email='timer@example.invalid', password_hash='test')
            db.add(instructor); db.flush()
            lobby = Lobby(instructor_id=instructor.id, title='Timed', language='c',
                          max_students=5, status='ACTIVE', expires_at=datetime.utcnow()+timedelta(hours=1))
            db.add(lobby); db.flush()
            db.add(Submission(lobby_id=lobby.id, student_id='1', file_name='work.c',
                              language='c', source_code='int main() { return 0; }', status='pending'))
            db.commit()
            self.submission_id = db.query(Submission.id).scalar()

    def tearDown(self):
        self.broadcast.stop()
        analysis.SessionLocal = self.original
        self.engine.dispose()

    def test_completed_records_true_server_duration(self):
        with patch.object(predictor, 'require_inference_capacity'), patch.object(
                predictor, 'analyze', return_value={'ai_probability':0.83,'risk_level':'High'}):
            analysis.run_analysis(self.submission_id)
        with self.Session() as db:
            sub=db.get(Submission,self.submission_id)
            self.assertEqual(sub.status, 'done')
            self.assertIsNotNone(sub.analysis_started_at)
            self.assertIsNotNone(sub.analysis_finished_at)
            self.assertGreaterEqual(sub.analysis_finished_at,sub.analysis_started_at)
            data=SubmissionResponse.model_validate(sub).model_dump(mode='json')
            self.assertTrue(data['analysis_started_at'].endswith('Z'))
            self.assertTrue(data['analysis_finished_at'].endswith('Z'))

    def test_failed_job_also_has_real_duration(self):
        with patch.object(predictor,'require_inference_capacity',side_effect=predictor.InferenceResourcesUnavailable('too little RAM')):
            analysis.run_analysis(self.submission_id)
        with self.Session() as db:
            sub=db.get(Submission,self.submission_id)
            self.assertEqual(sub.status,'failed')
            self.assertIsNotNone(sub.analysis_started_at)
            self.assertIsNotNone(sub.analysis_finished_at)
            self.assertIsNone(sub.ai_probability)

    def test_duplicate_job_cannot_reset_saved_finish(self):
        with patch.object(predictor,'require_inference_capacity'),patch.object(
            predictor,'analyze',return_value={'ai_probability':0.14,'risk_level':'Low'}):
            analysis.run_analysis(self.submission_id)
            with self.Session() as db:
                original=db.get(Submission,self.submission_id).analysis_finished_at
            analysis.run_analysis(self.submission_id)
            with self.Session() as db:
                self.assertEqual(db.get(Submission,self.submission_id).analysis_finished_at,original)


class AdditiveMigrationTests(unittest.TestCase):
    def test_preserves_preexisting_submission_across_two_startups(self):
        with tempfile.TemporaryDirectory() as folder:
            engine=create_engine('sqlite:///'+str(Path(folder)/'database.sqlite'))
            with engine.begin() as conn:
                conn.execute(text('''CREATE TABLE submissions (
                    id INTEGER PRIMARY KEY, lobby_id CHAR(32) NOT NULL,
                    student_id VARCHAR(50) NOT NULL, file_name VARCHAR(255) NOT NULL,
                    language VARCHAR(20) NOT NULL, source_code TEXT NOT NULL,
                    status VARCHAR(20) NOT NULL, ai_probability FLOAT,
                    risk_level VARCHAR(20), error_message TEXT,
                    created_at DATETIME NOT NULL)'''))
                conn.execute(text('''INSERT INTO submissions
                    (id,lobby_id,student_id,file_name,language,source_code,status,created_at)
                    VALUES (19, '00000000000000000000000000000001', 'original',
                    'old.c', 'c', 'int main(){}', 'done', '2026-11-17 20:00:00')'''))
            original_engine=database.engine
            try:
                database.engine=engine
                database.create_tables()
                database.create_tables()
                with engine.connect() as conn:
                    row=conn.execute(text('SELECT student_id,status,analysis_started_at,analysis_finished_at FROM submissions WHERE id=19')).one()
                self.assertEqual(row, ('original','done',None,None))
                columns={col['name'] for col in inspect(engine).get_columns('submissions')}
                self.assertIn('analysis_started_at',columns)
                self.assertIn('analysis_finished_at',columns)
            finally:
                database.engine=original_engine
                engine.dispose()

if __name__=='__main__':
    unittest.main(verbosity=2)
