export const MAX_SCRIPT_CHARS = 60_000 // must match the service's MAX_TOTAL_CHARS (services/voice-api/homegrown_api/config.py)

// There is deliberately no CHUNK_MAX_CHARS here. Chunk size is a property of
// the selected voice, not a constant: the reference clip competes with the
// script for one MAX_SEQ_LEN window, so a longer reference yields smaller
// chunks (services/voice-api/homegrown_api/config.py, _seq_budget). Mirroring the service's 800-char
// ceiling made the UI report "1 chunk" for a script that rendered as 3.
// Ask the server instead -- see getEstimate() in api.ts.
