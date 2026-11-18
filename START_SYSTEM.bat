@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title CodeAuthentic - Start System

echo.
echo ====================================================
echo             CodeAuthentic - START SYSTEM
echo           Local Frontend + FastAPI Backend
echo ====================================================
echo.

if not exist "package.json" goto :missing_project
if not exist "requirements.txt" goto :missing_project
if not exist "backend\main.py" goto :missing_project

rem Require Node.js/npm to start the Vite frontend.
where node >nul 2>&1
if errorlevel 1 goto :missing_node
where npm.cmd >nul 2>&1
if errorlevel 1 goto :missing_node

rem Vite 8 needs Node 20.19+ or 22.12+ (or a newer supported major).
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit((a===20&&b>=19)||(a===22&&b>=12)||(a>22)?0:1)" >nul 2>&1
if errorlevel 1 goto :old_node

rem Set up a local virtual environment without changing global Python packages.
if not exist ".venv\Scripts\python.exe" (
    echo [1/4] Creating Python virtual environment...
    where py >nul 2>&1
    if not errorlevel 1 (
        py -3.11 -m venv ".venv" >nul 2>&1
        if not errorlevel 1 goto :venv_ready
        py -3.12 -m venv ".venv" >nul 2>&1
        if not errorlevel 1 goto :venv_ready
        py -3.10 -m venv ".venv" >nul 2>&1
        if not errorlevel 1 goto :venv_ready
        py -3 -m venv ".venv" >nul 2>&1
        if not errorlevel 1 goto :venv_ready
    )
    where python >nul 2>&1
    if errorlevel 1 goto :missing_python
    python -m venv ".venv"
    if errorlevel 1 goto :venv_failed
)

:venv_ready
if not exist ".venv\Scripts\python.exe" goto :venv_failed

rem This marker is created only after the entire pip installation succeeds.
if not exist ".venv\codeauthentic_requirements_ready.txt" (
    echo [2/4] Installing backend dependencies - first launch may take a while.
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 goto :pip_failed
    >".venv\codeauthentic_requirements_ready.txt" echo Installed from requirements.txt
) else (
    echo [2/4] Backend dependencies were installed previously.
)

rem Install frontend packages only when Vite is missing.
rem npm ci is preferred for reproducibility. If a future package-lock.json
rem becomes out of sync, npm install can reconcile it automatically.
if not exist "node_modules\vite\bin\vite.js" (
    echo [3/4] Installing frontend dependencies - first launch only.
    if exist "package-lock.json" (
        call npm ci --no-audit --no-fund
        if errorlevel 1 (
            echo.
            echo [WARNING] npm ci failed. Trying npm install to repair dependencies...
            echo           package-lock.json may be updated if it is out of sync.
            call npm install --no-audit --no-fund
            if errorlevel 1 goto :npm_failed
        )
    ) else (
        echo [INFO] No package-lock.json found. Using npm install.
        call npm install --no-audit --no-fund
        if errorlevel 1 goto :npm_failed
    )
) else (
    echo [3/4] Frontend dependencies are already available.
)

if not exist ".env" if not defined DATABASE_URL (
    echo.
    echo [NOTE] No local .env / DATABASE_URL detected.
    echo        FastAPI defaults to local PostgreSQL. If your database is
    echo        hosted on Supabase, configure DATABASE_URL in .env first.
    echo        Do not share .env or commit credentials to GitHub.
    echo.
)

rem Force local browser requests through the development proxy.
rem A single space overrides any VITE_API_BASE_URL inside .env;
rem src/utils/api.ts trims this value to an empty string.
set "VITE_API_BASE_URL= "

echo [4/4] Checking local server ports...
rem Never silently connect the new frontend to a stale backend process.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 goto :backend_port_busy
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 goto :frontend_port_busy

set "CODEAUTHENTIC_MASK_BATCH_SIZE=1"
rem CodeBERT local inference configuration
set "CODEAUTHENTIC_MASK_BATCH_SIZE=1"
set "CODEAUTHENTIC_MODEL_DEVICE=cpu"

echo [4/4] Starting local FastAPI and React frontend...
echo.
start "CodeAuthentic - Backend (FastAPI)" cmd /k ".venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

echo [4/4] Starting local FastAPI and React frontend...
echo.
start "CodeAuthentic - Backend (FastAPI)" cmd /k ".venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"
if errorlevel 1 goto :launch_failed
start "CodeAuthentic - Frontend (React)" cmd /k "npm run dev -- --strictPort"
if errorlevel 1 goto :launch_failed

echo.
echo Frontend:  http://localhost:3000
echo Backend:   http://127.0.0.1:8000/docs
echo Health:    http://127.0.0.1:8000/health
echo.
echo Two command windows have opened. Keep them open while using
echo CodeAuthentic. Errors will be visible in those windows.
echo This launcher is for LOCAL testing. It does not redeploy Vercel.
echo.
echo Opening the frontend in your browser...
timeout /t 6 /nobreak >nul
start "" "http://localhost:3000"
exit /b 0

:backend_port_busy
echo [ERROR] Port 8000 is already in use, possibly by an older FastAPI server.
echo         Close the old CodeAuthentic backend window and retry.
echo         Do NOT continue with the old backend (Inspect may show Not Found).
goto :fail

:frontend_port_busy
echo [ERROR] Port 3000 is already in use. Close the old React/Vite terminal and retry.
goto :fail

:missing_project
echo [ERROR] Put START_SYSTEM.bat inside the thesis-main project folder,
echo         next to package.json and requirements.txt.
goto :fail

:missing_node
echo [ERROR] Node.js and npm are required. Install Node.js LTS,
echo         reopen this batch file, and try again.
goto :fail

:old_node
echo [ERROR] Your Node.js version is too old for this project's Vite 8.
echo         Install Node.js 22 LTS or newer, then try again.
goto :fail

:missing_python
echo [ERROR] Python is required. Install Python 3.11 and enable
echo         the Python launcher / Add Python to PATH.
goto :fail

:venv_failed
echo [ERROR] Unable to create the Python .venv environment.
goto :fail

:pip_failed
echo [ERROR] Failed to install Python requirements.
echo         Check the output above and your connection, then retry.
goto :fail

:npm_failed
echo [ERROR] Failed to install frontend dependencies.
echo         Check the output above and your connection, then retry.
goto :fail

:launch_failed
echo [ERROR] Could not open one or both server windows.
goto :fail

:fail
echo.
 pause
 exit /b 1
