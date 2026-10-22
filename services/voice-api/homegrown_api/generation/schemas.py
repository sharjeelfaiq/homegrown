"""Generation schemas"""
from typing import Optional
from pydantic import BaseModel


class GenerateRequest(BaseModel):
    preset_id: str
    text: str
    language: str = "English"
    style: str = "natural"
    stability: str = "balanced"
    # Set only by /api/queue/{id}/retry. A first submission is attempt 1.
    attempt: int = 1


class GenerateJobStart(BaseModel):
    job_id: str
    total_chunks: int
    queue_position: int


class JobStatusResponse(BaseModel):
    status: str  # "queued" | "running" | "done" | "error" | "canceled"
    chunks_done: int
    total_chunks: int
    audio_url: Optional[str] = None
    sample_rate: Optional[int] = None
    error: Optional[str] = None
    elapsed_s: Optional[float] = None
    queue_position: Optional[int] = None


class QueueEntry(BaseModel):
    job_id: str
    # The id as well as the name. The UI marks a voice that is mid-generation,
    # and matching on NAME alone mismarks the wrong voice as soon as two share
    # one -- renaming is free in this app, so that is not a hypothetical.
    preset_id: str
    language: str
    preset_name: str
    text_preview: str
    status: str
    chunks_done: int
    total_chunks: int
    elapsed_s: Optional[float] = None
    queue_position: Optional[int] = None
    submitted_at: float
    audio_url: Optional[str] = None
    error: Optional[str] = None
    # 1 for a first submission, incremented by each retry. Lets a row that
    # keeps failing say so, instead of silently replacing itself.
    attempt: int = 1


class QueueScriptResponse(BaseModel):
    """The full script for an explicitly requested pending-job reuse."""
    text: str
    preset_id: str
    language: str


class ReorderRequest(BaseModel):
    job_ids: list[str]
