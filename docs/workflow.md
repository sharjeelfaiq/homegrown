# Homegrown workflow

This guide describes the current local Studio workflow. For first-time setup
and safety boundaries, see [README.md](../README.md); for the frozen Windows
build, see [BUILD.md](BUILD.md). GPU measurements are historical and collected
on the hardware identified in [gpu-notes.md](gpu-notes.md).

## Start and safety

From the repository root, run:

```bash
bash dev.sh
```

Open `http://localhost:5173`. The script starts FastAPI on `127.0.0.1:8000`
and Vite on `:5173`; Vite proxies `/api`, `/audio`, and `/refs` to the API.
`dev.sh` prints a LAN address because Vite listens on the network interfaces.
Use a trusted network only: the admin password protects voice and completed
voiceover deletion, but it is not sign-in and does not protect other app actions.

For manual startup, create and activate the Python environment as described in
the README, then run these commands in separate terminals:

```bash
cd services/voice-api && ../../.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

```bash
cd apps/studio && npm run dev
```

Set `MODEL_PATH` in `services/voice-api/.env` to the downloaded local model.
The default admin password is `Homegrown-Admin-8731!`; override it by setting
`ADMIN_PASSWORD` in that same `.env`. The packaged app reads an override from
`<install>/backend/.env`. The compiled default applies when no non-empty
override is set. Do not treat this shared default as protection against other
users on an untrusted network.

The app has no accounts or multi-user authorization: API requests use the
single local user. The password is checked by the API for deletes, and the
delete endpoints check it again when a deferred delete is committed.

## Create and manage voices

Choose **Add a voice** or drop an audio file into the Studio. Uploads up to 30
minutes are accepted; clips longer than 40 seconds are shortened to the first
40 seconds of speech. A 10–20-second, dry, close-mic recording is a useful
starting point. The voice name starts from the filename, language is detected,
and faster-whisper transcribes the reference. There is no language selector.

The voice list in the picker has **Play** and **Delete** buttons. The Voices
dialog also lets you audition, download, rename, and delete a reference clip.
Clicking delete in either place opens the admin-password modal. After a valid
password, a seven-second **Undo** toast appears; Undo cancels the pending
delete. If it expires, the server deletes the preset and its reference audio.
An invalid password closes the modal and does not schedule a deletion. Preset
deletion can make queued jobs using that voice fail.

Voice names are stored by the API and appear on future voiceovers. Renaming a
voice does not rewrite names already recorded in history. Reference downloads
are the original uploaded audio.

## Generate and cancel voiceovers

Write up to 60,000 characters, choose a voice, then select **Generate**.
Generation is serial: one job runs at a time under the model's generation lock;
additional jobs queue. Reference audio and script text share the model context
window, so the available chunk size depends on the selected voice. Long scripts
are split into chunks. The UI reports chunk progress rather than a time
estimate.

Live rows appear above completed history. Queued jobs can be reordered. To
cancel a queued or running job, click **Cancel**, then confirm with the tick.
Cancellation is sent immediately after confirmation—there is no undo timer
toast for canceled generations. A running job stops at a chunk boundary. The
cross button dismisses the confirmation without canceling.

Failed jobs remain visible with the service error. Retry resubmits the same
script and voice; Dismiss removes the failed queue item. A GPU context fault
can fail the running job and queued jobs; restart the backend to recover.

## Review, search, and delete history

Completed voiceovers are newest-first and paginated. Search matches canonical
voice names across the full history; browser-local display-name overrides only
match loaded pages. Filters narrow by voice, date, duration, and search text.
The search query, page size, and display-name overrides are stored in this
browser; they are not server-side account data.

Each completed row has a direct download button beside its three-dot menu. The
menu contains **Delete**. Selecting one or more rows exposes batch Download,
Delete, and Clear actions in the context toolbar. Single downloads produce an
MP3; multi-selection downloads a ZIP.

Delete opens the admin-password modal. After a valid password, a seven-second
Undo toast is shown; the server delete starts only when that window expires. An
invalid password closes the modal without scheduling a delete. The API checks
the password again at commit time. Leaving the page before the timer expires
cancels the pending client-side delete; the history entry remains on the
server. Undo for a batch cancels the whole pending batch.

Reusing a finished voiceover's script fills the composer with that script and
voice. If this replaces text already in the composer, the app offers a separate
Undo for the text replacement.

## Persistence and startup

Presets, completed history, and the generation queue are persisted under
`services/voice-api/storage/` in a source checkout. Browser-local names,
search, and history-page cache are stored in localStorage. Queue records survive
a backend restart; a running job restarts from the beginning of that job, not
from its last chunk.

During startup, a full-screen overlay reports model initialization. In Vite
development, boot status comes from the backend status file; a model-load
failure transitions to an actionable error state. The API serves
`apps/studio/dist` when that build exists; use Vite at `:5173` while developing
the Studio to avoid mistaking a built UI for the live source.
