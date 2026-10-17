# Homegrown workflow

This guide describes the current local Studio workflow. For first-time setup
and safety boundaries, see [README.md](../README.md); for the frozen Windows
build, see [BUILD.md](BUILD.md). GPU measurements are historical and collected
on the hardware identified in [gpu-notes.md](gpu-notes.md).

## Start and safety

From the repository root, run:

```bash
npm run dev
```

Open `http://localhost:5173`. The script starts FastAPI on `127.0.0.1:8000`
and Vite on `:5173`; Vite proxies `/api`, `/audio`, and `/refs` to the API.
`npm run dev` prints a LAN address because Vite listens on the network interfaces.
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

## First-run orientation

Once the model is ready, Studio automatically offers a concise, read-only tour.
It covers theme/help, reusable voice selection and reference-clip upload,
Script entry (`/` focuses it), the centered Generate action (`Ctrl/Cmd+Enter`),
Voiceovers, and search/filter controls. Escape or the close button dismisses
it; the header help button replays it. The tour excludes the mascot and
volatile queue, error, and row-action surfaces so it remains reliable on a
fresh launch.

## Create and manage voices

Choose **Clone Voice** in the Script editor footer or drop an audio file
anywhere into the Studio. Uploads up to 30 minutes are accepted; clips longer
than 40 seconds are shortened to the first 40 seconds of speech. A
10–20-second, dry, close-mic recording is a useful starting point. The voice
name starts from the filename, language is detected, and faster-whisper
transcribes the reference. There is no language selector on upload.

The Script editor uses a responsive height of `clamp(300px, 39svh, 400px)`.
Its footer holds the word count, voice picker, Clone Voice button, and
script-language control. An empty voice picker reads **Select
voice**; the language control begins at **Select language**. Generation
requires choosing an explicit language, even
though the backend can fall back to the voice's stamped language. Choosing one
of the loaded model's languages reads the script in that language with the same
cloned voice. The choice stays until you change it and is not saved across
reloads. The list comes from the loaded model, so a language it does not speak
is never offered and is refused if requested. Reading a script in a language
the voice was not cloned from usually keeps the speaker's accent — check the
first voiceover before committing to a long one. The language dropdown keeps
a fixed 190px width to prevent footer shifts. Open the picker and click a voice
name to select it; the picker stays open. Voice names are read-only by default.
Click the pencil icon button to edit a name; it hides during editing and returns
when editing ends. Use the row's **Play**,
download, and **Delete** actions. Clicking delete opens
the admin-password modal. After a valid password, a seven-second **Undo** toast
appears; Undo cancels the pending delete. If it expires, the server deletes the
preset and its reference audio. An invalid password closes the modal and does
not schedule a deletion. Preset deletion can make queued jobs using that voice
fail.

When the picker is open, use the compact **Search voices** field at the top of
the dropdown to filter cloned voices by name. Filtering is local and
case-insensitive; click a matching name to select it without closing the
picker. The pencil button enters rename mode. The search query is cleared when
the picker closes, and an unmatched query shows
**No matching voices.** without changing the stored voice selection.

During an upload, the control replaces its icon with an animated lifecycle
mark. It is amber while uploading, green after a successful upload, and red
after a failed one. The green or red result stays visible for two seconds, then
the control returns to its Upload icon.

Voice names are stored by the API and appear on future voiceovers. Renaming a
voice does not rewrite names already recorded in history. Reference downloads
are the original uploaded audio.

## Generate and cancel voiceovers

Write up to 60,000 characters in the Script editor, choose a voice and script
language in its footer, then select **Generate**. The button is enabled only
when the script has non-whitespace text, an available voice and language are
selected, the model is ready, and no submission or startup is in progress.
Press `/` to focus the editor or Ctrl/Cmd+Enter to generate when the form is
ready.
The 44px Generate button remains centered below the editor even when its
disabled reason is shown. On wide screens, that auxiliary text sits beside the
button; on narrow screens it moves below it. The fixed mascot is dragged by
the mascot artwork itself, while its subdued side arrows cycle the numbered
catalog without initiating a drag. Clicking the artwork instead plays the
mascot's reaction. Its corner grip resizes the mascot between 56 and 176px,
by drag or arrow keys; that size, like its dragged position, lasts only for
the browser tab. Mascot 2 (the Cat sheets) is the default.
To add one, commit `<id>a.webp` (directions) and `<id>b.webp` (reactions) in
`apps/studio/public/mascots/`; normal Studio commands regenerate and validate
`src/generated/mascotCatalog.ts`, which must be committed with the pair.
Generation is serial: one job runs at a time under the model's generation lock;
additional jobs queue. Reference audio and script text share the model context
window, so the available chunk size depends on the selected voice. Long scripts
are split into chunks. The UI reports chunk progress rather than a time
estimate.

Live rows appear above completed history. Queued jobs can be reordered. To
cancel a queued or running job, click **Cancel**, then confirm with the tick.
Cancellation is sent immediately after confirmation—there is no undo timer
toast for canceled generations. A running job stops between streamed audio
pieces (typically about one second), which can be partway through a script
chunk. The
cross button dismisses the confirmation without canceling.

Failed jobs remain visible with the service error. Retry resubmits the same
script and voice; Dismiss removes the failed queue item. A GPU context fault
can fail the running job and queued jobs; restart the backend to recover.

## Review, search, and delete history

Completed voiceovers are newest-first and paginated. Search matches canonical
voice names across the full history; browser-local display-name overrides only
match loaded pages. The left heading shows the total count until rows are
selected, then shows the selected count (using **1 voiceover** for one).
When nothing is selected, the quick filters default to **Select voice**,
**Select duration**, **Select status**, and **Select date range**. They sit on
the right. The row wraps on narrow screens without horizontal scrolling.
Search and filters narrow the history.
The search query, page size, and display-name overrides are stored in this
browser; they are not server-side account data.
To rename a voiceover, click the pencil button beside its name and edit the
field. Clicking the name itself does not enter edit mode; the name field is
read-only until the pencil is used.

Dropdown menus and selectors share the Base UI menu primitives. Tooltips use
the shared Base UI tooltip component, and interface icons use `lucide-react`.

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

During startup, a full-screen overlay reports model initialization after a
short delay. In Vite development, boot status comes from the backend status
file. If the backend is unavailable or model startup fails, the overlay exits
and a pulsing warning button at the lower left opens a modal with the reported
message and a Retry action when available. CPU fallback is supported, but can
be much slower than GPU generation. A failed background history refresh leaves
cached voiceovers visible and does not add an inline notice above the list.
The API serves
`apps/studio/dist` when that build exists; use Vite at `:5173` while developing
the Studio to avoid mistaking a built UI for the live source.
