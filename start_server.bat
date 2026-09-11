@echo off
REM Double-click this (or a shortcut to it) to start Homegrown on the LAN.
REM 0.0.0.0 means other devices on the network can reach it, not just this
REM machine. This is deployment mode 2 in CLAUDE.md: one uvicorn on :8000
REM serving both the API and the built frontend, so there is only one origin
REM and no CORS involved.
REM
REM The checks below are not ceremony. Each one has failed here for real, and
REM each fails in a way that does not name its own cause.
REM
REM Delayed expansion: %VAR% inside a parenthesised if-block is expanded when
REM the block is PARSED, so a variable set by the for-loops below would read as
REM empty there. !VAR! is read at execution time instead.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo   The virtualenv is missing. Run: bash setup.sh
  echo.
  pause
  exit /b 1
)

REM FRONTEND_DIST is checked once, at import time. Start without it and the
REM SPA catch-all never registers for the life of the process -- every page
REM load answers {"detail":"Not Found"} while /api works fine.
if not exist "frontend\dist\index.html" (
  echo   frontend\dist is missing, so this would serve the API with no app
  echo   in front of it. Build it first:
  echo.
  echo       cd frontend ^&^& npm run build
  echo.
  pause
  exit /b 1
)

REM A localhost URL baked into the bundle. VITE_BACKEND_URL is resolved at
REM build time, so if frontend\.env.local set it when you built, every device
REM except this one loads a working-looking page that then calls its own
REM loopback. Nothing at runtime can detect that, which is why it is caught
REM here. build.sh stashes .env.local to prevent it; a hand-run `npm run
REM build` does not.
REM
REM PowerShell rather than findstr: findstr returns 1 both for "no match" and
REM for "could not open that path", so a wrong path would read as a clean
REM build forever. This exits 2 only on a real match, and says so if it found
REM no bundle to check at all.
powershell -NoProfile -Command "$f = Get-ChildItem 'frontend\dist\assets\*.js' -ErrorAction SilentlyContinue; if (-not $f) { Write-Host '  No JS bundle in frontend\dist\assets -- rebuild the frontend.'; exit 3 }; if (Select-String -InputObject $f -SimpleMatch -Pattern '127.0.0.1:8000','localhost:8000' -List -Quiet) { exit 2 }; exit 0"
if errorlevel 3 (
  echo.
  pause
  exit /b 1
)
if errorlevel 2 (
  echo   This build has a localhost backend address compiled into it. It will
  echo   work on this PC and fail on every other device.
  echo.
  echo   Comment out VITE_BACKEND_URL in frontend\.env.local and rebuild:
  echo.
  echo       cd frontend ^&^& npm run build
  echo.
  pause
  exit /b 1
)

REM Port already taken. Left to uvicorn this is a bind traceback scrolling past
REM a `pause`, and the usual culprit -- a dev.sh backend still running -- is
REM nowhere in that message. A stale listener on 8000 has been misdiagnosed
REM three separate times here.
REM
REM No pipes in any of the PowerShell below, deliberately. Inside for /f's
REM single quotes cmd reads a bare `|` as its own pipe and passes `^|` through
REM as a literal caret -- neither one runs, and both fail silently, which is
REM how this guard shipped not firing at all. @(...) with indexing and
REM .Where() says the same thing using no character cmd wants to interpret.
set "PORTPID="
for /f %%P in ('powershell -NoProfile -Command "@(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)[0].OwningProcess"') do set "PORTPID=%%P"
if defined PORTPID (
  echo   Something is already listening on port 8000:
  echo.
  powershell -NoProfile -Command "Format-Table -InputObject (Get-Process -Id !PORTPID! -ErrorAction SilentlyContinue) -Property Id, ProcessName, Path -AutoSize"
  echo   Most likely a dev.sh backend. Stop it, then run this again.
  echo.
  pause
  exit /b 1
)

REM The address other people type. ipconfig used to be dumped whole here, but
REM this machine also has a Hyper-V vEthernet 172.28.x.x that no other device
REM can reach, and half the guesses landed on it.
set "LANIP="
for /f %%I in ('powershell -NoProfile -Command "@(@(Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp -ErrorAction SilentlyContinue).Where({ $_.InterfaceAlias -notlike '*vEthernet*' }))[0].IPAddress"') do set "LANIP=%%I"

echo.
echo   On this PC:      http://localhost:8000
if defined LANIP (
  echo   On the network:  http://!LANIP!:8000
) else (
  echo   On the network:  could not work out this PC's address -- run ipconfig
)
echo.
echo   NOTE: do NOT open http://0.0.0.0:8000 -- 0.0.0.0 only means
echo         "listen on all interfaces". Browsers cannot connect to it.
echo.
echo   There is no sign-in. Anyone who can reach that address can create
echo   voices, generate voiceovers, and delete other people's. Keep it to a
echo   network you trust.
echo.

REM The venv interpreter by absolute path, NOT `call activate.bat` then
REM `python`. activate.bat hardcodes the absolute VIRTUAL_ENV written when the
REM venv was created -- ours still says ...\voice-clone-agent\.venv, the name
REM this repo had before it was renamed to homegrown. That directory no longer
REM exists, so activate prepends a dead path, `python` resolves to whatever is
REM on the system PATH, and LAN mode dies with "No module named uvicorn" while
REM reading as a broken install. python.exe finds its own venv through
REM pyvenv.cfg and needs no activation; dev.sh has always called it this way.
cd backend
"%~dp0.venv\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000
pause
