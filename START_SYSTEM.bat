
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

rem ====================================================
rem STEP 1 - Verify project files
rem ====================================================

if not exist "package.json" goto :missing_project
if not exist "requirements.txt" goto :missing_project
if not exist "backend\main.py" goto :missing_project

rem ====================================================
rem STEP 2 - Verify Node.js and npm
rem ====================================================

where node >nul 2>&1
if errorlevel 1 goto :missing_node

where npm.cmd >nul 2>&1
if errorlevel 1 goto :missing_node

rem Vite 8 requires Node.js 20.19+, 22.12+, or newer.
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit((a===20&&b>=19)||(a===22&&b>=12)||(a>22)?0:1)" >nul 2>&1
if errorlevel 1 goto :old_node

rem ====================================================
rem STEP 3 - Prepare Python virtual environment
rem ====================================================

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

rem ====================================================
rem STEP 4 - Verify backend dependencies
rem ====================================================

if not exist ".venv\codeauthentic_requirements_ready.txt" (
    echo [2/4] Installing backend dependencies...
    echo First launch may take a while.

    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 goto :pip_failed

    >".venv\codeauthentic_requirements_ready.txt" echo Installed from requirements.txt
) else (
    echo [2/4] Backend dependencies were installed previously.
)

rem ====================================================
rem STEP 5 - Verify frontend dependencies
rem ====================================================

if not exist "node_modules\vite\bin\vite.js" (
    echo [3/4] Installing frontend dependencies...

    if exist "package-lock.json" (
        call npm ci --no-audit --no-fund

        if errorlevel 1 (
            echo.
            echo [WARNING] npm ci failed.
            echo Trying npm install...

            call npm install --no-audit --no-fund
            if errorlevel 1 goto :npm_failed
        )
    ) else (
        echo [INFO] No package-lock.json found.
        call npm install --no-audit --no-fund
        if errorlevel 1 goto :npm_failed
    )
) else (
    echo [3/4] Frontend dependencies are already available.
)

rem ====================================================
rem STEP 6 - Database configuration notice
rem ====================================================

if not exist ".env" if not defined DATABASE_URL (
    echo.
    echo [NOTE] No local .env / DATABASE_URL detected.
    echo Configure DATABASE_URL if using Supabase.
    echo Do not share or commit database credentials.
    echo.
)

rem ====================================================
rem STEP 7 - Force frontend requests through local proxy
rem ====================================================

rem src/utils/api.ts trims this value to an empty string.
rem Prevents localhost from using the Render backend.
set "VITE_API_BASE_URL= "

rem ====================================================
rem STEP 8 - Check for existing server processes
rem ====================================================

echo [4/4] Checking local server ports...

rem Do not start a second FastAPI backend.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 goto :backend_port_busy

rem Do not start a second Vite server.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 goto :frontend_port_busy

rem ====================================================
rem STEP 9 - CodeBERT local performance configuration
rem ====================================================

rem Shared inference settings for Python, Java, and C.

rem Batch 1 prioritizes lower peak memory usage.
set "CODEAUTHENTIC_MASK_BATCH_SIZE=1"

rem Use CPU-only placement to avoid automatic offloading.
set "CODEAUTHENTIC_MODEL_DEVICE=cpu"

rem Show real CodeBERT inference timings in backend logs.
set "CODEAUTHENTIC_PERF_TRACE=1"

rem Limit CPU thread oversubscription.
rem These settings are an experiment for local performance.
set "OMP_NUM_THREADS=4"
set "MKL_NUM_THREADS=4"

echo.
echo ====================================================
echo             CodeBERT Configuration
echo ====================================================
echo.
echo Mask batch size:  %CODEAUTHENTIC_MASK_BATCH_SIZE%
echo Model placement:  %CODEAUTHENTIC_MODEL_DEVICE%
echo Performance logs: %CODEAUTHENTIC_PERF_TRACE%
echo OMP threads:      %OMP_NUM_THREADS%
echo MKL threads:      %MKL_NUM_THREADS%
echo Languages:        Python, Java, C
echo.

rem ====================================================
rem STEP 10 - Start FastAPI backend and React frontend
rem ====================================================

echo [4/4] Starting local FastAPI and React frontend...
echo.

rem Start the FastAPI backend exactly ONCE.
start "CodeAuthentic - Backend (FastAPI)" cmd /k ".venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"
if errorlevel 1 goto :launch_failed

rem Start the React frontend exactly ONCE.
start "CodeAuthentic - Frontend (React)" cmd /k "npm run dev -- --strictPort"
if errorlevel 1 goto :launch_failed

rem ====================================================
rem STEP 11 - Display local URLs
rem ====================================================

echo.
echo ====================================================
echo             CodeAuthentic is Starting
echo ====================================================
echo.
echo Frontend:  http://localhost:3000
echo Backend:   http://127.0.0.1:8000/docs
echo Health:    http://127.0.0.1:8000/health
echo.
echo Two server windows have opened.
echo Keep them open while using CodeAuthentic.
echo.
echo CodeBERT performance timings are enabled.
echo Look for [CODEBERT PERF] in the backend window.
echo.
echo This launcher is for LOCAL testing only.
echo It does NOT deploy to Vercel or Render.
echo.

rem ====================================================
rem STEP 12 - Open browser
rem ====================================================

echo Opening CodeAuthentic in your browser...

timeout /t 6 /nobreak >nul
start "" "http://localhost:3000"

exit /b 0

rem ====================================================
rem ERROR HANDLERS
rem ====================================================

:backend_port_busy
echo.
echo [ERROR] Port 8000 is already in use.
echo Close the old CodeAuthentic FastAPI window.
echo Then run START_SYSTEM.bat again.
goto :fail

:frontend_port_busy
echo.
echo [ERROR] Port 3000 is already in use.
echo Close the old React/Vite terminal window.
echo Then run START_SYSTEM.bat again.
goto :fail

:missing_project
echo.
echo [ERROR] Project files are missing.
echo Place START_SYSTEM.bat next to package.json.
goto :fail

:missing_node
echo.
echo [ERROR] Node.js and npm are required.
echo Install Node.js LTS and try again.
goto :fail

:old_node
echo.
echo [ERROR] Your Node.js version is too old for Vite 8.
echo Install Node.js 22 LTS or newer.
goto :fail

:missing_python
echo.
echo [ERROR] Python is required.
echo Install a supported Python version and try again.
goto :fail

:venv_failed
echo.
echo [ERROR] Unable to create the Python virtual environment.
goto :fail

:pip_failed
echo.
echo [ERROR] Failed to install Python requirements.
echo Check the terminal output above.
goto :fail

:npm_failed
echo.
echo [ERROR] Failed to install frontend dependencies.
echo Check the terminal output above.
goto :fail

:launch_failed
echo.
echo [ERROR] Could not launch one or both servers.
goto :fail

:fail
echo.
pause
exit /b 1
