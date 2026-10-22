# No external auth service -- every request is treated as the same local
# user. Kept as a FastAPI dependency (rather than inlining a constant) so
# every route's `Depends(get_current_user)` keeps working unchanged.
import hmac

from fastapi import Header, HTTPException

from homegrown_api import config

LOCAL_USER_ID = "local-user"

def get_current_user() -> str:
    """FastAPI dependency: no real authentication -- always the single local user."""
    return LOCAL_USER_ID


def require_admin_password(password: str | None = Header(default=None, alias="X-Homegrown-Admin-Password")) -> None:
    """Protect permanent bulk deletes with the local administrator password."""
    if not config.ADMIN_PASSWORD:
        raise HTTPException(503, "Admin password is not configured. Restart the backend after setting it in .env.")
    if password is None or not hmac.compare_digest(password, config.ADMIN_PASSWORD):
        raise HTTPException(401, "Incorrect admin password.")
