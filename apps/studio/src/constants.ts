export const MAX_SCRIPT_CHARS = 60_000 // must match the service's MAX_TOTAL_CHARS (services/voice-api/main.py)

// There is deliberately no CHUNK_MAX_CHARS here. Chunk size is a property of
// the selected voice, not a constant: the reference clip competes with the
// script for one MAX_SEQ_LEN window, so a longer reference yields smaller
// chunks (services/voice-api/main.py, _seq_budget). Mirroring the service's 800-char
// ceiling made the UI report "1 chunk" for a script that rendered as 3.
// Ask the server instead -- see getEstimate() in api.ts.

/** Chunk size below which this model starts padding output with murmur and
 * trailing silence. Must match PADDING_SAFE_MIN_CHARS in services/voice-api/main.py, where
 * the number was measured; nothing keeps the two in step.
 *
 * The client needs it because /api/presets reports each voice's `chunk_chars`
 * but not a verdict on it -- a boolean would have duplicated state the number
 * already carries, and the voices dialog is the one place a voice can be
 * inspected before it is used. */
export const PADDING_SAFE_MIN_CHARS = 150

/** How long a destructive action is held behind its Undo toast.
 *
 * Shared rather than per-component, and the list of callers has grown: a
 * voiceover delete and BOTH cancellations (queued and running) in HistoryList,
 * a voice delete in StudioShell, and UndoCountdown drawing its depleting ring
 * from the same number. Copies of 7000 would drift the first time anyone
 * retuned the window. */
export const UNDO_MS = 7000
