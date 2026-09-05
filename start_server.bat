@echo off
REM Double-click this (or a shortcut to it) to start Voice Clone Studio on the LAN.
REM 0.0.0.0 means other devices on the network can reach it, not just this machine.
cd /d "%~dp0backend"
call "%~dp0.venv\Scripts\activate.bat"
echo.
echo   On this PC:      http://localhost:8000
echo   On the network:  http://^<one of the IPv4 addresses below^>:8000
echo   NOTE: do NOT open http://0.0.0.0:8000 -- 0.0.0.0 only means
echo         "listen on all interfaces". Browsers cannot connect to it.
echo.
ipconfig | findstr /i "IPv4"
echo.
python -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
