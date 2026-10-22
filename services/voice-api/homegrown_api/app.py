"""App"""
import homegrown_api.config as config
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import homegrown_api.lifespan as lifespan
import homegrown_api.routes.downloads as routes_downloads
import homegrown_api.routes.generation as routes_generation
import homegrown_api.routes.health as routes_health
import homegrown_api.routes.history as routes_history
import homegrown_api.routes.presets as routes_presets
import homegrown_api.routes.queue as routes_queue


app = FastAPI(title="CloneVoicePrompt-style TTS API", lifespan=lifespan.lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],

)


app.mount("/audio", StaticFiles(directory=str(config.GEN_DIR)), name="audio")


app.mount("/refs", StaticFiles(directory=str(config.REF_DIR)), name="refs")


app.include_router(routes_downloads.router)
app.include_router(routes_health.router)
app.include_router(routes_generation.router)
app.include_router(routes_presets.router)
app.include_router(routes_history.router)
app.include_router(routes_queue.router)

# ---- Frontend (production) --------------------------------------------------
# Serves the built React app so the packaged backend's port is the
# only origin the browser ever talks to. Registered last -- Starlette checks
# routes in registration order and stops at the first match, so every
# /api/*, /audio/*, and /refs/* route above always wins first; this can never
# shadow them. Only activates when apps/studio/dist exists (i.e. `npm run build`
# has run) -- in local dev, where Vite's own dev server handles the frontend
# on :5173, apps/studio/dist doesn't exist and this block never registers.
# Gated on index.html, not on the directory: a half-written apps/studio/dist (Vite
# emits assets/ before index.html) passes is_dir() and would register a route
# that 404s every page load. And this is evaluated once, at import -- a backend
# started before `npm run build` finishes never serves the SPA at all, however
# complete the directory becomes later. The warning is the only trace of that.
if (config.FRONTEND_DIST / "index.html").is_file():

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/"):
            # A genuinely unmatched /api/* path -- report a real 404 instead
            # of silently handing back index.html and masking the bug.
            raise HTTPException(404, "Not Found")

        candidate = (config.FRONTEND_DIST / full_path).resolve()
        if full_path and config.FRONTEND_DIST.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)

        # Everything else -- including client-side routes like /studio,
        # other client routes -- falls through to index.html; React Router
        # takes over from there.
        return FileResponse(config.FRONTEND_DIST / "index.html")

else:
    config.logger.warning(
        "SPA route not registered: %s does not exist. "
        "The API is served, but every page load returns 404. "
        "Build the frontend, then restart this process.",
        config.FRONTEND_DIST / "index.html",
    )
