"""Routes queue"""
import time
from fastapi import APIRouter, Depends, HTTPException

import homegrown_api.dependencies as dependencies
import homegrown_api.generation.schemas as generation_schemas
import homegrown_api.generation.worker as generation_worker
import homegrown_api.routes.generation as routes_generation

router = APIRouter()


@router.get("/api/jobs/{job_id}")
def get_job(job_id: str, user_id: str = Depends(dependencies.get_current_user)) -> generation_schemas.JobStatusResponse:
    with generation_worker._jobs_lock:
        if job_id not in generation_worker._jobs or generation_worker._jobs[job_id].get("user_id") != user_id:
            raise HTTPException(404, "Unknown job_id")
        return generation_worker._job_status_response_locked(job_id)


@router.get("/api/queue")
def list_queue(user_id: str = Depends(dependencies.get_current_user)) -> dict:
    with generation_worker._jobs_lock:
        entries = [
            generation_worker._queue_entry_locked(job_id)
            for job_id, job in generation_worker._jobs.items()
            if job.get("user_id") == user_id
        ]
        # _jobs dict order is submission order, not processing order -- sort
        # queued entries by their real position in _pending_job_ids so the
        # list actually reflects /api/queue/reorder (non-queued entries keep
        # their relative order via the stable sort's shared key).
        entries.sort(key=lambda e: e.queue_position if e.queue_position is not None else -1)
    return {"queue": entries}


@router.get("/api/queue/{job_id}/script")
def get_queue_script(
    job_id: str, user_id: str = Depends(dependencies.get_current_user)
) -> generation_schemas.QueueScriptResponse:
    """Return a pending job's complete script only on an explicit reuse click.

    The queue poll intentionally exposes text_preview only: sending complete
    scripts for every active job once per second is needless bandwidth.
    """
    with generation_worker._jobs_lock:
        job = generation_worker._jobs.get(job_id)
        if job is None or job.get("user_id") != user_id:
            raise HTTPException(404, "Unknown job_id")
        return generation_schemas.QueueScriptResponse(text=job["text"], preset_id=job["preset_id"], language=job["language"])


@router.post("/api/queue/{job_id}/cancel")
def cancel_queued_job(job_id: str, user_id: str = Depends(dependencies.get_current_user)):
    with generation_worker._jobs_lock:
        if job_id not in generation_worker._jobs or generation_worker._jobs[job_id].get("user_id") != user_id:
            raise HTTPException(404, "Unknown job_id")
        job = generation_worker._jobs[job_id]
        if job_id in generation_worker._pending_job_ids:
            generation_worker._pending_job_ids.remove(job_id)
            job.update(status="canceled", finished_at=time.time())
            generation_worker._persist_queue_locked()
        elif job_id == generation_worker._current_running_job_id and job["status"] == "running":
            # Not canceled yet -- _process_job's chunk loop notices this and
            # finishes the cancellation (see the "canceling" check there).
            job["status"] = "canceling"
        else:
            raise HTTPException(
                400, "Only a queued or currently-processing job can be canceled.",
            )
    return {"ok": True}


@router.post("/api/queue/{job_id}/retry", status_code=202)
def retry_job(job_id: str, user_id: str = Depends(dependencies.get_current_user)) -> generation_schemas.GenerateJobStart:
    """Resubmit a dead job's own script.

    Server-side rather than "send the script back and let the client repost it":
    the queue entry carries `text_preview`, which is truncated at 80 chars, and
    putting the full script on every queue entry would repost up to
    MAX_TOTAL_CHARS on every poll of a 1s loop for as long as the failed row
    sits there. The text never left this process; there is no reason to move it.

    Goes through generate() rather than around it, so a retry is validated like
    any other submission -- the preset may have been deleted since the job
    failed, or replaced with one whose reference clip no longer leaves room to
    generate. Bypassing that would turn a clear 404 into a second failure.
    """
    with generation_worker._jobs_lock:
        job = generation_worker._jobs.get(job_id)
        if job is None or job.get("user_id") != user_id:
            raise HTTPException(404, "Unknown job_id")
        if job["status"] not in ("error", "canceled"):
            raise HTTPException(400, "Only a failed or canceled job can be retried.")
        req = generation_schemas.GenerateRequest(
            preset_id=job["preset_id"],
            text=job["text"],
            language=job["language"],
            style=job["style"],
            stability=job["stability"],
            # Carried forward so a row that keeps failing says so. A retry mints
            # a new job id and replaces the row, so without this a job failing
            # instantly on every attempt looks like a button that does nothing.
            attempt=job.get("attempt", 1) + 1,
        )

    # Outside the lock: generate() takes _jobs_lock itself.
    started = routes_generation.generate(req, user_id=user_id)

    # Only now. If generate() raised, the failed job stays on the list with its
    # original error rather than vanishing into a retry that never happened.
    with generation_worker._jobs_lock:
        generation_worker._jobs.pop(job_id, None)
    return started


@router.delete("/api/queue/{job_id}")
def delete_job(job_id: str, user_id: str = Depends(dependencies.get_current_user)):
    """Removes a dead job (canceled/error) from the in-memory queue list --
    "done" jobs already have their own delete via /api/history, so aren't
    handled here to avoid double-managing the same audio file."""
    with generation_worker._jobs_lock:
        job = generation_worker._jobs.get(job_id)
        if job is None or job.get("user_id") != user_id:
            raise HTTPException(404, "Unknown job_id")
        if job["status"] not in ("canceled", "error"):
            raise HTTPException(400, "Only a canceled or failed job can be deleted.")
        del generation_worker._jobs[job_id]
    return {"ok": True}


@router.post("/api/queue/reorder")
def reorder_queue(req: generation_schemas.ReorderRequest, user_id: str = Depends(dependencies.get_current_user)):
    with generation_worker._jobs_lock:
        owned_pending = [jid for jid in generation_worker._pending_job_ids if generation_worker._jobs[jid].get("user_id") == user_id]
        if set(req.job_ids) != set(owned_pending):
            raise HTTPException(
                400,
                "job_ids must be exactly the set of currently queued (not yet started) job ids.",
            )
        # Splice this user's jobs back into their own slots in the new order,
        # preserving the relative position of every other user's queued jobs
        # (the FIFO queue is shared, so reordering must not let one user's
        # request move another user's job earlier or later).
        new_order = iter(req.job_ids)
        generation_worker._pending_job_ids[:] = [
            next(new_order) if generation_worker._jobs[jid].get("user_id") == user_id else jid
            for jid in generation_worker._pending_job_ids
        ]
        generation_worker._persist_queue_locked()
    return {"ok": True}
