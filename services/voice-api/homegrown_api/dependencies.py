# No external auth service -- every request is treated as the same local
# user. Kept as a FastAPI dependency (rather than inlining a constant) so
# every route's `Depends(get_current_user)` keeps working unchanged.
LOCAL_USER_ID = "local-user"

def get_current_user() -> str:
    """FastAPI dependency: no real authentication -- always the single local user."""
    return LOCAL_USER_ID
