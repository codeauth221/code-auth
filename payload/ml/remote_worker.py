"""Run the exact local CodeBERT classifier as a protected remote inference worker.

Outbound HTTPS only; no inbound port and no database credentials are needed.
Run `python -m ml.remote_worker` from the project root after configuring
%LOCALAPPDATA%/CodeAuthenticWorker/worker.env on Windows.
"""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from pathlib import Path
from urllib import error, parse, request
from dotenv import load_dotenv

LOGGER = logging.getLogger("codeauthentic.worker")
POLL_SECONDS = 6
RENEW_SECONDS = 30
HTTP_TIMEOUT = 25


class WorkerApiError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _load_settings() -> None:
    local_appdata = os.getenv("LOCALAPPDATA")
    home = Path(local_appdata) if local_appdata else Path.home() / ".config"
    env_file = home / "CodeAuthenticWorker" / "worker.env"
    load_dotenv(env_file, override=False)
    if not env_file.is_file() and not os.getenv("CODEAUTHENTIC_WORKER_TOKEN"):
        raise RuntimeError(f"Worker configuration is missing: {env_file}")


def _connection_settings() -> tuple[str, str, str]:
    base_url = os.getenv("CODEAUTHENTIC_API_URL", "").strip().rstrip("/")
    token = os.getenv("CODEAUTHENTIC_WORKER_TOKEN", "").strip()
    worker_id = os.getenv("CODEAUTHENTIC_WORKER_ID", "friend-laptop").strip()
    parsed = parse.urlparse(base_url)
    is_local_http = (parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"})
    if parsed.scheme != "https" and not is_local_http:
        raise RuntimeError("CODEAUTHENTIC_API_URL must be HTTPS (HTTP is allowed only for localhost).")
    if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise RuntimeError("CODEAUTHENTIC_API_URL must be a plain backend origin (no path, user info or query).")
    if len(token) < 32 or token.startswith("REPLACE_WITH_"):
        raise RuntimeError("CODEAUTHENTIC_WORKER_TOKEN is missing or is still the placeholder secret.")
    import re
    if not re.fullmatch(r"[a-zA-Z0-9_-]{3,64}", worker_id):
        raise RuntimeError("CODEAUTHENTIC_WORKER_ID must be 3-64 characters (letters, digits, _ or -).")
    return base_url, token, worker_id


class Api:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url
        self.token = token

    def post(self, path: str, payload: dict) -> dict:
        body = json.dumps(payload, allow_nan=False).encode("utf-8")
        req = request.Request(
            self.base_url + path,
            data=body,
            headers={"Authorization": f"Bearer {self.token}",
                     "Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=HTTP_TIMEOUT) as response:
                # A valid 200 KB source file may expand with JSON escaping.
                # Bound the response without truncating valid UTF-8/JSON.
                response_bytes = response.read(2 * 1024 * 1024 + 1)
                if len(response_bytes) > 2 * 1024 * 1024:
                    raise WorkerApiError(502, "Backend returned an oversized job response.")
                try:
                    return json.loads(response_bytes.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    raise WorkerApiError(502, "Backend returned invalid JSON.") from None
        except error.HTTPError as exc:
            # Never print HTTP bodies; reverse proxies may echo credentials.
            raise WorkerApiError(exc.code, f"Backend rejected request (HTTP {exc.code}, {path})") from None
        except (error.URLError, TimeoutError, OSError) as exc:
            raise ConnectionError(f"Cannot reach the remote backend ({type(exc).__name__}).") from None


def _job_lease_renewal(api: Api, worker_id: str, job: dict,
                       stopped: threading.Event, lost: threading.Event) -> None:
    while not stopped.wait(RENEW_SECONDS):
        try:
            api.post(f"/worker/jobs/{job['id']}/renew", {
                "worker_id": worker_id, "claim_token": job["claim_token"],
            })
        except WorkerApiError as exc:
            if exc.status in (401, 403, 409, 503):
                lost.set()
                LOGGER.warning("Job %s lease no longer valid (HTTP %s)", job["id"], exc.status)
                break
            LOGGER.warning("Could not renew job %s; will retry: %s", job["id"], exc)
        except ConnectionError as exc:
            LOGGER.warning("Job %s lease renewal interrupted: %s", job["id"], exc)


def _process_job(api: Api, worker_id: str, job: dict) -> None:
    job_id = job["id"]
    LOGGER.info("Analyzing job %s, language=%s (source code not logged)", job_id, job["language"])
    stop = threading.Event()
    lost = threading.Event()
    lease_thread = threading.Thread(
        target=_job_lease_renewal,
        args=(api, worker_id, job, stop, lost),
        daemon=True, name="job-lease-heartbeat",
    )
    lease_thread.start()
    result = None
    error_code = None
    try:
        from ml.predictor import (CodeTooShortError, HeadNotTrainedError,
                                  InferenceResourcesUnavailable, analyze)
        try:
            result = analyze(job["source_code"], job["file_name"])
            if result["language"] != job["language"]:
                raise ValueError("Job language and file extension do not match")
        except CodeTooShortError:
            error_code = "invalid_source"
        except (HeadNotTrainedError, InferenceResourcesUnavailable):
            error_code = "model_unavailable"
        except Exception:
            # Log type only: exception messages may include private source code.
            LOGGER.error("Inference exception for job %s (%s)", job_id, sys.exc_info()[0].__name__)
            error_code = "inference_error"
    finally:
        stop.set()
        lease_thread.join(timeout=2)

    if lost.is_set():
        LOGGER.warning("Job %s will not be submitted because its lease was lost", job_id)
        return
    action = "complete" if result is not None else "fail"
    payload = {"worker_id": worker_id, "claim_token": job["claim_token"]}
    if result is not None:
        payload.update({"ai_probability": result["ai_probability"], "risk_level": result["risk_level"]})
    else:
        payload["error_code"] = error_code or "inference_error"
    # Retry transient network failures without losing the claim token.
    for attempt in range(3):
        try:
            api.post(f"/worker/jobs/{job_id}/{action}", payload)
            LOGGER.info("Job %s saved: %s", job_id, "analyzed" if result is not None else "failed")
            return
        except WorkerApiError as exc:
            if exc.status == 409:
                LOGGER.warning("Job %s already finalized or lease expired; no overwrite", job_id)
                return
            if exc.status in (401, 403, 422, 503):
                LOGGER.error("Job %s result rejected: HTTP %s", job_id, exc.status)
                return
            LOGGER.warning("Job %s save attempt %s failed: %s", job_id, attempt + 1, exc)
        except ConnectionError as exc:
            LOGGER.warning("Job %s save attempt %s failed: %s", job_id, attempt + 1, exc)
        if attempt < 2:
            time.sleep(4)
    LOGGER.error("Job %s could not be saved. The backend lease recovery will retry when expired.", job_id)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)s  %(message)s")
    try:
        _load_settings()
        base_url, token, worker_id = _connection_settings()
        from ml.predictor import model_readiness, require_inference_capacity
        require_inference_capacity()
        readiness = model_readiness()
        missing = sorted(set(("c", "java", "python")) - set(readiness["active_languages"]))
        if missing:
            raise RuntimeError("Missing verified active classifiers: " + ", ".join(missing) +
                               ". Transfer the matching ml/heads .joblib and .json files first.")
    except Exception as exc:
        LOGGER.error("Worker setup failed: %s", exc)
        return 2
    api = Api(base_url, token)
    LOGGER.info("Worker ready: %s -> %s | C / Java / Python active", worker_id, base_url)
    LOGGER.info("Use Ctrl+C to stop; the online website stays available when this worker is offline.")
    retry_delay = POLL_SECONDS
    try:
        while True:
            try:
                api.post("/worker/heartbeat", {"worker_id": worker_id})
                response = api.post("/worker/jobs/claim", {"worker_id": worker_id})
                retry_delay = POLL_SECONDS
                job = response.get("job")
                if job:
                    _process_job(api, worker_id, job)
                else:
                    time.sleep(POLL_SECONDS)
            except (ConnectionError, WorkerApiError) as exc:
                LOGGER.warning("Worker connection unavailable: %s", exc)
                time.sleep(retry_delay)
                retry_delay = min(retry_delay * 2, 60)
    except KeyboardInterrupt:
        LOGGER.info("Worker stopped by operator.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
