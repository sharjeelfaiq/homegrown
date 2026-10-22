"""Routes history"""
import homegrown_api.config as config
import io
import math
import zipfile
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import homegrown_api.audio.convert as audio_convert
import homegrown_api.dependencies as dependencies
import homegrown_api.generation.worker as generation_worker
import homegrown_api.persistence.stores as persistence_stores
import homegrown_api.routes.downloads as routes_downloads

router = APIRouter()


HISTORY_PAGE_MAX = 100


@router.delete("/api/history")
def delete_all_history(user_id: str = Depends(dependencies.get_current_user)):
    with generation_worker._jobs_lock:
        generation_worker.require_idle_for_deletion(user_id)
        result = persistence_stores.delete_collection("history", user_id)
        generation_worker._history_revision += 1
        # Completed job metadata must not advertise deleted output or permit reuse.
        for job_id, job in list(generation_worker._jobs.items()):
            if job.get("user_id") == user_id and job["status"] == "done":
                del generation_worker._jobs[job_id]
        return result


@router.get("/api/history")
def list_history(
    limit: int = 20,
    offset: int = 0,
    preset_id: Optional[str] = None,
    created_from: Optional[float] = None,
    created_to: Optional[float] = None,
    duration_min: Optional[float] = None,
    duration_max: Optional[float] = None,
    q: Optional[str] = None,
    user_id: str = Depends(dependencies.get_current_user),
):
    """One page of this user's generations, newest first.

    `_history` is newest-first already, so the slice needs no sorting. `total`
    is the count *before* slicing -- the client needs it to know how many pages
    exist, and computing it from the returned page is impossible.

    limit/offset are clamped rather than rejected: these come from a local UI,
    and silently returning a sane page beats a 422 the frontend would have to
    render. HISTORY_PAGE_MAX caps how much a single request can pull, since
    every entry carries its full script text.

    `q` searches the canonical voice/preset name stored with each entry. Local
    display-name overrides remain browser-only and are intentionally not part
    of this global server search.
    """
    limit = max(1, min(limit, HISTORY_PAGE_MAX))
    offset = max(0, offset)
    numeric = (created_from, created_to, duration_min, duration_max)
    if any(value is not None and not math.isfinite(value) for value in numeric):
        raise HTTPException(422, "History filter values must be finite numbers")
    if created_from is not None and created_to is not None and created_from > created_to:
        raise HTTPException(422, "created_from must not be later than created_to")
    if duration_min is not None and duration_max is not None and duration_min > duration_max:
        raise HTTPException(422, "duration_min must not exceed duration_max")
    q = (q or "").strip().casefold()

    # Authorise before filtering. Retaining the index lets a filtered page
    # carry its stable global Voiceover N number without a client-side full
    # history request.
    mine = [h for h in persistence_stores._history if h.get("user_id") == user_id]
    filtered: list[tuple[int, dict]] = []
    for index, entry in enumerate(mine):
        if preset_id is not None and entry.get("preset_id") != preset_id:
            continue
        if created_from is not None and entry.get("created_at", 0) < created_from:
            continue
        if created_to is not None and entry.get("created_at", 0) > created_to:
            continue
        if duration_min is not None and entry.get("duration_s", 0) < duration_min:
            continue
        if duration_max is not None and entry.get("duration_s", 0) > duration_max:
            continue
        if q and q not in str(entry.get("preset_name", "")).casefold():
            continue
        filtered.append((index, entry))
    page = filtered[offset : offset + limit]
    is_filtered = preset_id is not None or any(value is not None for value in numeric) or bool(q)
    history = [
        ({**entry, "history_number": len(mine) - index} if is_filtered else entry)
        for index, entry in page
    ]
    return {"history": history, "total": len(filtered)}


class HistoryZipRequest(BaseModel):
    ids: list[str]
    # Display names, by entry id. They live in the browser's localStorage and
    # the server has never seen them (see the two-name-stores note in
    # CLAUDE.md), so the client has to send the ones it wants used. Anything
    # missing falls back to the voice name and the entry's position.
    names: dict[str, str] = {}


@router.post("/api/history/zip")
def zip_history(req: HistoryZipRequest, user_id: str = Depends(dependencies.get_current_user)):
    """Several voiceovers as one .zip.

    POST, not GET: the id list plus the display-name map is request-body
    shaped, and a GET would put an arbitrary number of uuids and user-chosen
    filenames in a query string.

    Built in memory rather than streamed from disk. The payload is mp3s of
    finished voiceovers -- tens of MB at the sizes this tool produces -- and an
    in-memory buffer avoids a temp file that would need cleaning up on every
    error path. ZIP_STORED, not DEFLATE: mp3 is already compressed, so
    deflating it costs CPU for approximately nothing.

    Unknown ids are skipped rather than 404-ing the whole request: a client
    holding a stale list should still get the files that do exist. An id that
    is not this user's is skipped the same way. An empty result IS an error,
    though -- a zip with nothing in it looks like a successful download of
    nothing.
    """
    if not req.ids:
        raise HTTPException(400, "No voiceovers selected")

    wanted = set(req.ids)
    mine = [h for h in persistence_stores._history if h.get("user_id") == user_id and h["id"] in wanted]
    if not mine:
        raise HTTPException(404, "None of those voiceovers exist")

    buf = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        for entry in mine:
            audio_url = entry.get("audio_url", "")
            if not audio_url.startswith("/audio/"):
                continue
            src = (config.GEN_DIR / audio_url.removeprefix("/audio/")).resolve()
            if config.GEN_DIR.resolve() not in src.parents or not src.exists():
                continue
            # Same .wav -> .mp3 conversion-and-cache as /api/download, so old
            # entries written before write_mp3 are not silently skipped.
            if src.suffix.lower() == ".wav":
                mp3 = src.with_suffix(".mp3")
                if not mp3.exists():
                    try:
                        audio_convert.wav_to_mp3(str(src), str(mp3))
                    except Exception:
                        config.logger.exception("Zip: could not convert %s", src)
                        continue
                src = mp3

            stem = routes_downloads._safe_filename(req.names.get(entry["id"], "") or entry.get("preset_name", "voiceover"))
            # Zip entries are keyed by name: two voiceovers called the same
            # thing would otherwise silently overwrite each other inside the
            # archive, and the user would get fewer files than they selected.
            arcname = f"{stem}.mp3"
            n = 2
            while arcname in used:
                arcname = f"{stem} ({n}).mp3"
                n += 1
            used.add(arcname)
            zf.write(src, arcname)

    if not used:
        raise HTTPException(404, "No audio files found for those voiceovers")

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="voiceovers.zip"'},
    )


@router.delete("/api/history/{entry_id}")
def delete_history_entry(entry_id: str, user_id: str = Depends(dependencies.get_current_user)):
    with persistence_stores._store_lock:
        entry = next((h for h in persistence_stores._history if h["id"] == entry_id), None)
        if entry is None or entry.get("user_id") != user_id:
            raise HTTPException(404, "Unknown history entry_id")
        persistence_stores._history.remove(entry)
        persistence_stores._save_json(config.HISTORY_FILE, persistence_stores._history)
    audio_url = entry.get("audio_url", "")
    if audio_url.startswith("/audio/"):
        wav_path = config.GEN_DIR / audio_url.removeprefix("/audio/")
        wav_path.unlink(missing_ok=True)
        wav_path.with_suffix(".mp3").unlink(missing_ok=True)
    return {"ok": True}
