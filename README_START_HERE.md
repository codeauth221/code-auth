# CodeAuthentic — Student Closed / Expired Lobby UI

This focused patch replaces the disabled student-upload form with a premium, full-width **closed-session panel** when a valid lobby is not accepting submissions. It preserves the student receipt, theme, and working upload form whenever the lobby is open.

## What changes

- Backend `GET /public/lobbies/{lobby_id}/status` now returns two additional fields: `closed_reason` (`expired` or `instructor_locked`) and UTC `expires_at`. The original `active`, `subject`, `title`, `language` fields remain unchanged. No private instructor information, source code, or analysis scores are exposed.
- Expired lobby: "The submission window has ended" with deadline in Philippine Time and a suggestion to contact the instructor to **Extend & Reopen**.
- Instructor-locked lobby: "This exam lobby is locked" and an explanation that only the instructor can unlock it.
- If the status reason is unavailable, the UI uses a neutral "closed" explanation rather than guessing.
- The submission form is **not shown** while closed; an on-screen check and automatic rechecks can detect reopening. A second button lets students enter a different lobby code.
- The existing backend authorization, expiration restrictions, three-file limit, and model processing are unmodified. No message is sent to the instructor; the guidance is informational.

## Files (same relative paths as the project)

- `backend/routes/lobbies.py`
- `backend/schemas.py`
- `src/utils/api.ts`
- `src/components/StudentDashboard.tsx`
- `src/components/StudentDashboardPremium.css`
- `tests/test_public_lobby_closed_status.py` (new; in-memory database tests)

## Installation

1. Back up the CodeAuthentic project. **Stop the backend and frontend terminal windows.**
2. Extract this ZIP **outside** your project folder; open PowerShell in the extracted directory.
3. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\APPLY_STUDENT_CLOSED_LOBBY.ps1 -ProjectRoot "C:\Users\REO JOHN\Downloads\thesis-main\thesis-main"
   ```

   It checks the original SHA-256 versions before changing any file. It creates backups in `%LOCALAPPDATA%\CodeAuthenticPatchBackups\student_closed_*`. If it says SOURCE MISMATCH, **do not overwrite manually**; send the output with a fresh source ZIP. The installer is safe to run again if everything already matches the new files.

4. From the project root with `.venv` activated:

   ```powershell
   python -m compileall -q backend
   python -m pytest tests\test_public_lobby_closed_status.py -q
   npm run build
   ```

   If `pytest` is not installed in `.venv`, you can skip its optional local test and use the startup verification below. Do not install it unnecessarily if other tests already use `unittest`.

5. Double-click `START_SYSTEM.bat` after closing both old server windows.
6. Verify that the **running** backend was updated:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\VERIFY_STUDENT_LOBBY_STATUS.ps1
   ```

   Run it from the extracted ZIP directory. It should print `[READY]`.
7. Test a previously expired lobby through its existing student link. You should see the focused closed-session panel, **not** the upload form. After the instructor uses Extend & Reopen, click **Check session again** (or wait for the 20-second status check). The form returns without needing a new code. For an unexpired manually locked lobby, confirm the different text.

## Compatibility and behavior

- Current public status calls remain backward-compatible. The student frontend gracefully handles older server responses that lack the new fields, but it cannot reliably distinguish expiry from manual lock without the updated backend.
- The status is refreshed every 20 seconds while closed and every 30 seconds while open, only while the page is visible. No full dashboard polling is added.
- Students are never allowed to bypass server-side expiration/lock enforcement.
- Existing student receipts and stored submissions are not modified.
- The TSX source was syntax-checked, and backend regression tests were run. Run the complete frontend production build locally before deploying.
- No database migrations, CodeBERT changes, or classifier retraining are required.
