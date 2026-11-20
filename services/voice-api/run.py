"""Configure installed paths and start the packaged Homegrown API.

Model download and initialization run in the ASGI lifespan after Uvicorn starts
serving Studio. Development uses the Vite and Uvicorn flow instead.
"""
import os
import sys
from pathlib import Path

from homegrown_api import boot_status

# Not 8000, deliberately. 8000 belongs to dev (`npm run dev`); this build is the only one whose port nobody types,
# because it serves the API and the SPA from the same loopback origin and the
# frontend calls it with relative paths. Sharing 8000 meant the launcher's
# health probe could find a dev uvicorn already listening, conclude Homegrown
# was up, open the browser and never start backend.exe at all -- and a healthy
# dev backend serving a built apps/studio/dist is indistinguishable from this one
# over HTTP, so no probe can tell them apart. Separate ports can.
#
# MUST match PORT in desktop/launcher/launcher.py, which is what polls this process
# into readiness. They are separately frozen exes with no import path between
# them, so nothing but `npm run build`'s pre-build check stops them drifting; if
# they disagree the launcher polls a dead port and reports the backend as
# having timed out during startup, which is a badly wrong diagnosis.
PORT = 8731

def _storage_dir() -> Path:
    # VOICECLONE_STORAGE_DIR is the pre-rebrand key, still read so an
    # existing install keeps its storage after an in-place upgrade.
    return Path(os.environ.get("HOMEGROWN_STORAGE_DIR")
                or os.environ["VOICECLONE_STORAGE_DIR"])


def _configure_frozen_env() -> None:
    exe_dir = Path(sys.executable).parent  # <install>/backend/
    install_dir = exe_dir.parent  # <install>/

    # Defaults matching the packaged layout -- overridable by backend/.env
    # (written by the NSIS installer, or hand-edited by an advanced user).
    os.environ.setdefault("MODEL_PATH", str(install_dir / "models"))
    os.environ.setdefault("HOMEGROWN_STORAGE_DIR", str(install_dir / "storage"))

    env_path = exe_dir / ".env"
    if env_path.exists():
        from dotenv import load_dotenv
        load_dotenv(env_path, override=True)

    # A status file from a previous run would expose a stale phase or error.
    boot_status.clear(_storage_dir())
    boot_status.write(_storage_dir(), boot_status.PHASE_STARTING)


if getattr(sys, "frozen", False):
    _configure_frozen_env()
    # Model download and inference imports now run inside lifespan's startup
    # worker after Uvicorn has bound and can serve the Studio shell.
    # `import homegrown_api.app` (via uvicorn, below) faults in ~3.8GB of torch DLLs off
    # disk -- tens of seconds cold, and silent. Say so before it happens.

import uvicorn

if __name__ == "__main__":
    # Wildcard bind, so the desktop build is reachable from other machines on
    # the LAN. This reverses an earlier deliberate loopback-only bind; both
    # costs of the reversal are real and neither is hypothetical.
    #
    # 1. FIRST RUN HITS WINDOWS DEFENDER FIREWALL. A listener on every
    #    interface pops the "Allow access / Cancel" alert, and **Cancel writes
    #    a permanent Block rule for this exe path** that nothing in the app can
    #    undo -- after which it never starts again. Pre-authorise the exe
    #    before first launch, from an elevated prompt:
    #
    #      netsh advfirewall firewall add rule name="Homegrown" dir=in ^
    #        action=allow program="C:\Homegrown\backend\backend.exe" ^
    #        protocol=TCP localport=8731 enable=yes profile=private
    #
    #    A pre-existing allow rule means the prompt never appears, so the
    #    unrecoverable Cancel is never offered.
    #
    # 2. THERE IS NO AUTHENTICATION ANYWHERE IN THIS APP. auth.py's
    #    get_current_user returns the constant "local-user" for every request,
    #    so anyone who can reach this port has the same rights the owner does:
    #    create voices, submit jobs, and permanently delete voices and
    #    voiceovers (DELETE /api/presets/{id} unlinks the reference clip;
    #    DELETE /api/history/{id} unlinks both the .wav and the .mp3). Neither
    #    is recoverable. Bind this only on networks you trust.
    #
    # PORT stays 8731: desktop/launcher/launcher.py polls the same number and
    # scripts/checks/check_desktop_port.py is what stops the two drifting.
    uvicorn.run("homegrown_api.app:app", host="0.0.0.0", port=PORT, log_level="info")
