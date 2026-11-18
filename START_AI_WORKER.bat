@echo off
setlocal
cd /d "%~dp0"
title CodeAuthentic - Remote CodeBERT AI Worker

echo.
echo ==========================================================
echo       CodeAuthentic - Remote CodeBERT AI Worker
echo ==========================================================
echo.
echo This is the REMOTE worker only. It does not start the website,
echo change the database, or modify your trained classifiers.
echo.

if exist ".venv\Scripts\python.exe" (
  set "PYTHON=.venv\Scripts\python.exe"
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo [ERROR] Python not found. Install Python and project dependencies.
    pause
    exit /b 1
  )
  set "PYTHON=python"
)

if not exist "%LOCALAPPDATA%\CodeAuthenticWorker\worker.env" (
  echo [ERROR] Missing private configuration file:
  echo         %%LOCALAPPDATA%%\CodeAuthenticWorker\worker.env
  echo.
  echo See README_REMOTE_WORKER.md for the setup instructions.
  pause
  exit /b 1
)

set "CODEAUTHENTIC_MODEL_DEVICE=cpu"
set "CODEAUTHENTIC_MASK_BATCH_SIZE=1"
"%PYTHON%" -m ml.remote_worker
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo Worker process exited (code %EXIT_CODE%).
pause
exit /b %EXIT_CODE%
