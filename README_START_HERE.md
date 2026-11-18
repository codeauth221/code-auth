# CodeAuthentic — Real Analysis Timer (safe patch)

## Features

- While a student file is **pending**, shows `Queued · 12s`.
- While the backend is **analyzing**, shows a live ticker such as `Analyzing · 42s` in the instructor dashboard banner, desktop table, and mobile cards. Updates each second without making a new API call every second.
- When **done**, shows `Worked for 50s` from **backend-recorded start and finish timestamps**. The duration remains after refresh or on another instructor device.
- If a normally handled analysis fails, shows `Stopped after 50s` (no fake prediction).
- Existing historical submissions remain as-is and intentionally show **no duration**, because past timing data was never recorded. Stale-recovered jobs do not invent an end time.

**Duration definition:** From the backend's transition into `analyzing` to its transition into `done` or a normally handled `failed` state. Includes any waiting inside the inference lock, CodeBERT model loading, analysis, and backend processing. Does not include file upload validation or dashboard polling delay. The timer therefore measures the end-to-end analysis job, **not only PyTorch model execution**. Queued time before the job is claimed is shown separately.

## Files changed

- `backend/models.py`
- `backend/database.py`
- `backend/schemas.py`
- `backend/analysis.py`
- `backend/routes/dashboard.py`
- `src/types.ts`
- `src/utils/api.ts`
- `src/components/InstructorDashboard.tsx`
- Adds `tests/test_analysis_timing.py`.

**Not touched:** `ml/predictor.py`, Python/Java/C classifier files, trained heads, UI theme/CSS, project launcher, existing scores, authentication. No external timer service.

## Before installation

1. **Back up your current code AND your PostgreSQL/Supabase database** (especially if local and Render share the same database). On backend startup this patch executes additive `ALTER TABLE submissions ADD COLUMN` for two nullable timestamp columns. It doesn't delete or rewrite existing rows; this schema change is shared by every service using that DB. Database changes are not rolled back automatically by the file installer.
2. Close the local FastAPI and Vite terminal windows after any current analyses complete.
3. Extract this ZIP in a separate directory. Do not extract over your running project.
4. Open PowerShell in the extracted patch directory.

```powershell
powershell -ExecutionPolicy Bypass -File .\APPLY_ANALYSIS_TIMER_PATCH.ps1 -ProjectRoot "C:\Users\REO JOHN\Downloads\thesis-main\thesis-main"
```

The installer checks hashes of **all eight** source files against `CodeAuthentic_Latest_Source_Inspection.zip` provided Nov 18, 2026, before replacing anything. Backups are stored under `%LOCALAPPDATA%\CodeAuthenticPatchBackups`. If you get `SOURCE MISMATCH`, **stop**: don't force overwrite. Send the latest changed file or ZIP so we can merge it safely.

## Verify

From project root with virtual environment active:

```powershell
python -m compileall -q backend
$env:PYTHONPATH = (Get-Location).Path
python .\tests\test_analysis_regression.py
python .\tests\test_analysis_timing.py
npm run lint
npm run build
```

If `npm run lint` reports errors **only** in old Navbar backup folders, that's the pre-existing TypeScript scanning issue, not a timer error. Don't delete those backups without checking. The complete frontend Vite build was **not available** in our test environment; run both commands on your Windows machine.

Restart by double-clicking `START_SYSTEM.bat` (keep your existing `CODEAUTHENTIC_MASK_BATCH_SIZE=1` and `CODEAUTHENTIC_MODEL_DEVICE=cpu` settings). Watch terminal for `[SCHEMA] Added optional ...` and `[INFO] Database tables verified/created successfully.`

Create a NEW submission in a C / Java / Python lobby and observe elapsed timer while running. It should show `Worked for XXs` once completed, even after reloading the instructor dashboard. Existing finished files will not acquire fabricated durations.

## Safety

- Live-model tests were not executed in the patch environment; old regression tests and timing tests use isolated SQLite and stub predictors.
- This patch has no influence on the confirmed 512MB Render Free CodeBERT limitation; Render will still reject heavyweight inference safely after the memory patch.
- This patch does NOT add an ETA or fake progress percent; it only displays elapsed measured time.
- It does not retry or modify historical submissions.
- For rollback, restore backed-up source files. The added nullable database columns can be left in place safely; don't drop them to roll back source code.
