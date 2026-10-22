export const MAX_SCRIPT_CHARS = 60_000 // must match the service's MAX_TOTAL_CHARS (services/voice-api/main.py)

// There is deliberately no CHUNK_MAX_CHARS here. Chunk size is a property of
// the selected voice, not a constant: the reference clip competes with the
// script for one MAX_SEQ_LEN window, so a longer reference yields smaller
// chunks (services/voice-api/main.py, _seq_budget). Mirroring the service's 800-char
// ceiling made the UI report "1 chunk" for a script that rendered as 3.
// Ask the server instead -- see getEstimate() in api.ts.

/** How long a destructive action is held behind its Undo toast.
 *
 * Shared rather than per-component: a voiceover delete in HistoryList, a voice
 * delete in StudioShell, and UndoCountdown drawing its depleting ring from the
 * same number. Copies of 7000 would drift the first time anyone retuned the
 * window.
 *
 * Deletes only. Queue cancellation is deliberately NOT held behind this window
 * -- a confirmed cancel is sent immediately (HistoryList.handleCancel), because
 * a job that keeps generating for seven more seconds has already spent the GPU
 * time the user asked to stop. */
export const UNDO_MS = 7000
