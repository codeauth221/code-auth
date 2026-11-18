"""Read-only diagnosis of saved analysis start/end times; never changes data."""
from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sqlalchemy import inspect, text
from backend.database import engine


def main() -> None:
    inspector = inspect(engine)
    if "submissions" not in inspector.get_table_names():
        print("No submissions table in the configured local database.")
        return
    cols = {col["name"] for col in inspector.get_columns("submissions")}
    required = {"analysis_started_at", "analysis_finished_at"}
    missing = required - cols
    if missing:
        print("TIMING SCHEMA MISSING:", ", ".join(sorted(missing)))
        print("The elapsed-timer backend/database patch is not active for this database.")
        return
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT id, status, analysis_started_at, analysis_finished_at
            FROM submissions ORDER BY created_at DESC, id DESC LIMIT 5
        """)).mappings().all()
    if not rows:
        print("No submissions found in the configured database.")
    for row in rows:
        started, finished = row["analysis_started_at"], row["analysis_finished_at"]
        try:
            duration = round((finished - started).total_seconds(), 1) if started is not None and finished is not None else None
        except (TypeError, AttributeError):
            duration = "timestamps stored but not subtractable"
        print(f"Submission {row['id']} | status={row['status']} | start={started or 'MISSING'} | end={finished or 'MISSING'} | duration_s={duration}")
    print("\nIf the latest DONE submission has MISSING timestamps: the backend that processed it did not save timing.")
    print("Restart the updated local FastAPI service and submit a new test; previous missing durations cannot be reconstructed exactly.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Could not inspect database: {type(exc).__name__}: {exc}")
        raise SystemExit(1)
