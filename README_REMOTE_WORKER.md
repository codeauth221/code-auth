# CodeAuthentic | Remote CodeBERT worker patch (source-only)

## Safety and scope

This patch was developed against `CodeAuthentic_Remote_Worker_Source_20261118_150836.zip`.
It is **not yet deployed**, and cannot be fully end-to-end verified here because the
source-only archive contains no classifier `.joblib` files, real PostgreSQL service,
or Render credentials. Do not claim that it is live until you've tested it.

The default remains **local** analysis. Applying the patch by itself does not
switch your existing `START_SYSTEM.bat`, classifier training, inference feature
extractor, Vercel site or Render service into remote mode. Existing predictions,
training artifacts, lobbies, and source files are not intentionally changed.

This patch adds nullable columns to `submissions`, one liveness table, and a new
API router. The ordinary `create_tables()` startup performs only additive SQL
for these fields. **Back up the production database before deploying database
schema changes**, separately from the source backup.

## Files changed

- `backend/models.py` | nullable, lease-based worker state + heartbeat model
- `backend/database.py` | additive migrations, preserves old submissions
- `backend/analysis.py` | preserves local analysis; remote-mode lease recovery
- `backend/routes/submissions.py` | queues submissions without local inference in remote mode
- `backend/main.py` | registers new routes
- `src/utils/api.ts`, `src/components/InstructorDashboard.tsx` | worker status integration

## Files added

- `backend/routes/worker.py`, `backend/worker_mode.py` | authenticated queue API
- `ml/remote_worker.py` | dedicated worker; calls **unchanged** `ml.predictor.analyze()`
- `START_AI_WORKER.bat` | one-click worker launcher for Windows
- `WORKER_SETTINGS.example.txt` | redacted example only
- `src/components/RemoteWorkerStatusBanner.tsx` | instructor status display
- `tests/test_remote_worker_queue.py` | isolated security, lease, queue tests

No model weights or pre-existing `START_SYSTEM.bat` are included.

## Applying the patch locally (BEFORE any Git push)

**First close your local API and Vite terminals, and finish any source-copy jobs.**
You can leave classifier training running, because the patch does not touch any
training code, weights, or datasets. However, it is safer to wait for any code
maintenance in progress to finish to keep source files consistent.

1. Download the patch ZIP and extract it into a separate temporary folder,
   **not directly on top of the thesis project**.
2. Open PowerShell in that extracted folder. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\INSTALL_REMOTE_WORKER_PATCH.ps1 -ProjectRoot 'C:\Users\REO JOHN\Downloads\thesis-main\thesis-main'
   ```

   The installer checks SHA-256 against the exact archive received, refuses
   mismatches, and backs up old files under
   `%LOCALAPPDATA%\CodeAuthenticPatchBackups\RemoteWorker_<timestamp>`.
   It does not remove existing project files. If it reports `SOURCE MISMATCH`,
   stop and request a new matching patch; **do not force overwrite**.
3. Verify `START_SYSTEM.bat` still starts the **original localhost workflow**.
4. Run backend tests (activate your `.venv` first):

   ```powershell
   python -m pytest -q tests/test_remote_worker_queue.py
   python -m pytest -q tests/test_analysis_timing.py
   ```

5. Run the existing frontend build: `npm run build`. Do not push if this fails.
6. Verify a test file still receives a real classification **locally**.

## Deploying with minimal downtime

**Phase A: schema and routes only, without changing the analysis mode**

1. Commit/push the updated source, keeping `.joblib`, `.env` and private files
   out of Git. Do not put worker credentials in frontend `.env` files.
2. Let Vercel redeploy and redeploy the existing Render service.
3. Keep `CODEAUTHENTIC_ANALYSIS_MODE` **unset** (defaults to `local`) on Render.
   At this stage local behavior remains unchanged, including Render's known
   512 MB CodeBERT guard.
4. Open `/health`, log in as an instructor, and verify:
   - `GET /instructor/worker-status` -> `{"mode":"local", ...}`
   - Existing lobby, closed-lobby and code-viewer flows still work.

**Phase B: shared worker secret**

1. In PowerShell, generate a random secret **once**:

   ```powershell
   python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

2. Copy it **privately** into Render's environment as
   `CODEAUTHENTIC_WORKER_TOKEN`. Do not post the value in chat or commit it.
3. On the laptop that will run CodeBERT, create the directory:

   ```powershell
   New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\CodeAuthenticWorker"
   ```

   Create a plain text file named `worker.env` in that folder (not in the
   repository). Use the exact lines from `WORKER_SETTINGS.example.txt`,
   replacing its token placeholder with the same secret. Set a unique
   `CODEAUTHENTIC_WORKER_ID` such as `reo-laptop` or `friend-laptop`.
4. Ensure the laptop has Python and the original project virtual environment
   with the same dependencies already used by `START_SYSTEM.bat`, plus the
   verified `ml/heads/c.joblib`, `java.joblib`, `python.joblib` and matching
   `.json` files. **Do not email/commit these trusted pickled models.** Transfer
   them privately to your friend's device from your own trusted build.
5. Verify the **worker** runs with at least ~8 GB host RAM available and can
   download/load CodeBERT weights, or has those weights already cached.
   This is a starting point, not a memory/performance guarantee.

**Phase C: explicitly enable remote mode**

1. In Render's environment, set:

   ```text
   CODEAUTHENTIC_ANALYSIS_MODE=remote
   CODEAUTHENTIC_WORKER_TOKEN=<same private secret>
   ```

   Save/redeploy the service. Never set `CODEAUTHENTIC_ANALYSIS_MODE=remote`
   on localhost unless you specifically want localhost submissions queued
   for an external worker too.
2. Verify the instructor dashboard's Live Submissions page says **AI Worker
   Offline** (this is expected before launching the worker).
3. Double-click `START_AI_WORKER.bat` **on the laptop with the trained heads**.
   It connects **outbound** to Render using HTTPS and polls for jobs. It does
   not expose any incoming ports and does not need the Supabase DB password.
4. Within about 20 seconds after connection, check that the dashboard reports
   **AI Worker Connected**.
5. Create a NEW test lobby, submit one `.c` from your phone, and confirm the
   actual score is displayed online. Repeat with a Java and Python lobby.
6. Stop the batch launcher. Verify a *new* submission stays **Queued** while
   offline and completes when the worker is started again.
7. To transfer ownership to your friend, copy the verified source, trusted heads
   and private `worker.env` **securely** to their laptop, then remove the token
   from your own worker config if you will no longer be operating the worker.
   Rotate the Render token after the handover if appropriate.

## Failure recovery, limits, and privacy

- Each job uses a random claim token hashed in PostgreSQL. The token must be
  provided on lease renewal and completion. Expired tokens cannot overwrite a
  reassigned result.
- Active analyses renew a 10-minute lease every 30 seconds. If the worker is
  stopped abruptly, abandoned analysis jobs are requeued after their lease
  expires (Render's recovery loop runs approximately once per minute).
  After **3 disconnected attempts**, the job becomes `failed` with an explicit
  message instead of retrying forever. Pending jobs don't time out just because
  the laptop is offline.
- The worker sends only the CodeBERT probability and risk label. No fake
  predictions, alternative classifiers or generated percentages are used.
- The source code is sent over HTTPS only to the authenticated worker.
  However, using someone's laptop as an inference server is a **trust and
  availability decision**: its operator can view the incoming source code.
  Avoid running on an untrusted/shared device. The worker secret is powerful:
  anyone possessing it could claim and read code submissions.
- The app's existing submission tokenization still runs in the Render API,
  even when full inference moves to the laptop. Verify this still works on the
  production 512 MB instance.
- This is appropriate for supervised demonstrations, not a guarantee of 24/7
  reliability. Render Free and the laptop may sleep/disconnect or hit limits.
- Saved failures from earlier Render OOM protection are **not** retroactively
  reprocessed; submit a new test file in a new lobby.
- While all results are estimates, none prove a student's actual authorship.

## Rollback

If rollout is problematic, stop `START_AI_WORKER.bat` and **remove or reset**
`CODEAUTHENTIC_ANALYSIS_MODE=remote` on Render. This restores the prior local
API mode, although Render's 512 MB instance still cannot run CodeBERT. You can
then restore the exact backed-up source files from the installer's backup folder
and redeploy. Leave the additive database columns/table in place; they do not
modify old scores and are safe to keep. Do not delete existing submissions.
