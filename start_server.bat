@echo off
REM Double-click this (or a shortcut to it) to start Voice Clone Studio on the LAN.
REM 0.0.0.0 means other devices on the network can reach it, not just this machine.
cd /d "%~dp0backend"
call "%~dp0.venv\Scripts\activate.bat"
python -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
