export const MAX_SCRIPT_CHARS = 60_000 // must match backend's MAX_TOTAL_CHARS (backend/main.py)

// There is deliberately no CHUNK_MAX_CHARS here. Chunk size is a property of
// the selected voice, not a constant: the reference clip competes with the
// script for one MAX_SEQ_LEN window, so a longer reference yields smaller
// chunks (backend/main.py, _seq_budget). Mirroring the backend's 800-char
// ceiling made the UI report "1 chunk" for a script that rendered as 3.
// Ask the server instead -- see getEstimate() in api.ts.

/** What a reference clip is trimmed to. Must match REF_TRIM_SECS in
 * backend/main.py -- the backend enforces it; this is only so the modal can
 * warn before a long file is uploaded rather than reporting it afterwards.
 * Nothing keeps the two in step. */
export const REF_TRIM_SECS = 40

/** Chunk size below which this model starts padding output with murmur and
 * trailing silence. Must match PADDING_SAFE_MIN_CHARS in backend/main.py, where
 * the number was measured; nothing keeps the two in step.
 *
 * The client needs it because /api/presets reports each voice's `chunk_chars`
 * but not a verdict on it -- a boolean would have duplicated state the number
 * already carries, and the voices dialog is the one place a voice can be
 * inspected before it is used. */
export const PADDING_SAFE_MIN_CHARS = 150
