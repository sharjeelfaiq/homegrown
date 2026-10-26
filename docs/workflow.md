# Homegrown workflow

This guide describes the current local Studio workflow. For first-time setup
and safety boundaries, see [README.md](../README.md); for the frozen Windows
build, see [build.md](build.md). GPU measurements are historical and collected
on the hardware identified in [gpu-notes.md](gpu-notes.md).
For isolated, offline generation profiling and paired comparison commands, see
[the voice benchmark procedure](../scripts/benchmarks/voice_generation.md).

## Start and safety

From the repository root, run:

```bash
npm run dev
```

Open `http://localhost:5173`. The script starts Vite on `:5173` first, then
FastAPI on `127.0.0.1:8000`. FastAPI begins serving while a background startup
task probes the device, loads Qwen3-TTS, restores the queue, and starts the
worker. The boot-status file reports the startup phase, and `/api/health`
remains responsive with readiness and error details. At viewport widths of
1600px and wider, the Studio shows generic voice-engine readiness and the
active compute device in the outer left gutter. It does not display model
identifiers or model-type clues. Other `/api/*` requests
wait up to ten minutes and receive HTTP 503 if initialization fails or times
out. Vite proxies `/api`, `/audio`, and `/refs` to the API.
`npm run dev` prints a LAN address because Vite listens on the network interfaces.
There are no accounts or general API authentication. Ordinary actions,
including individual deletes, are unauthenticated. Permanent bulk deletion
requires the local `HOMEGROWN_ADMIN_PASSWORD`; expose the API only to a trusted
network.

For manual startup, create and activate the Python environment as described in
the README. Start Vite in one terminal and wait for it to serve `:5173`, then
start FastAPI in another terminal. The static Studio shell appears immediately;
API-backed content uses skeletons until its requests complete:

```bash
cd apps/studio && npm run dev
```

```bash
cd services/voice-api && ../../.venv/Scripts/python.exe -m uvicorn homegrown_api.app:app --host 127.0.0.1 --port 8000
```

Set `MODEL_PATH` in `services/voice-api/.env` to the downloaded local model.
The app has no accounts or general API authentication: requests use the single
local user. Individual deletes and other ordinary API operations do not require
a password; only permanent bulk deletion requires `HOMEGROWN_ADMIN_PASSWORD`.

## First-run orientation

Once the model is ready, Studio automatically offers a concise, read-only tour.
It covers Settings (themes, mascot visibility, and Danger Zone), voice
selection and batch cloning, script and language entry, Generate and the
generation queue, then Voiceovers playback, reuse, search, and filters. It
explains queue behavior without targeting queue rows, which may not exist on a
fresh launch. Escape or the close button dismisses the tour; the header help
button replays it. The mascot and transient error states are not tour targets.

Open **Settings** in the header to choose **System** or a named Studio theme.
The selected theme follows system appearance only while **System** is selected.
The complete theme list stays visible in its original order after a selection.
Settings also contains the **Pet animal** switch, which hides or shows the
mascot. These preferences are stored in the browser; they do not affect
presets, generated audio, or other clients.

The **Danger Zone** section has two permanent bulk actions: **Delete all generated
voiceovers** and **Delete all uploaded voices**. Both require confirmation and
have no Undo window. Voiceover deletion includes every page and its generated
audio; cloned-voice deletion preserves completed voiceovers and legacy built-in records.
Finish or cancel generation first, and let all waiting/active clones finish before
deleting uploaded voices. The second confirmation requires the password set as
`HOMEGROWN_ADMIN_PASSWORD` in `services/voice-api/.env`; if it is unset, the
backend refuses the operation. Never commit that `.env` file. The app reports
any audio files it could not remove.

## Create and manage voices

Choose **Clone voice** in the Voices card to select one or more audio files,
or drag and drop multiple audio files directly onto that card. Dropping files
elsewhere does not clone them. Uploads up to 30 minutes
are accepted; clips longer
than 40 seconds are shortened to the first 40 seconds of speech. A
10–20-second, dry, close-mic recording is a useful starting point. The voice
name starts from the filename, language is detected, and faster-whisper
transcribes the reference. There is no language selector on upload.

The Script editor uses a responsive height of `clamp(300px, 39svh, 400px)`.
Its footer holds the script-language control on the left and Generate on the
right. The word/character count appears inside the editor at the lower right.
The selected voice is not repeated above the script text.
The language control begins at **Select language**. Generation
requires choosing an explicit language, even
though the backend can fall back to the voice's stamped language. Choosing one
of the loaded model's languages reads the script in that language with the same
cloned voice. The choice stays until you change it and is not saved across
reloads. The list comes from the loaded model, so a language it does not speak
is never offered and is refused if requested. Reading a script in a language
the voice was not cloned from usually keeps the speaker's accent — check the
first voiceover before committing to a long one. The language dropdown is
150px wide to preserve room for Generate. Use the Voices card above the composer
to search and select a voice. Voice names are read-only by default. Click the
pencil icon button to edit a name; it hides during editing and returns when
editing ends. Use the row's **Play**,
download, and **Delete** actions. Delete opens a confirmation with **Cancel** and
**Delete**. Cancel leaves the voice untouched. Confirming hides the row and
shows a seven-second **Undo** toast; Undo restores it. When the countdown ends,
the server deletes the preset and its reference audio. Preset deletion can make
queued jobs using that voice fail.

The Script textarea receives focus on initial load. A printable key pressed on
a non-editable Studio surface returns focus to the textarea and inserts that
character at the caret. Search fields and other editable controls keep their
own typing behavior; modifier shortcuts, composition input, menus, and dialogs
are not intercepted.

Use the clipboard icon at the Script editor's top-right to paste clipboard
text. Clicking it calls the browser clipboard API and lets the browser show its
permission prompt when needed. It replaces the selected text when the textarea
is focused, and appends when it is not. The paste is limited to the remaining
space under the 60,000-character script limit. If access is unavailable or was
denied, Studio shows a toast with guidance to use Ctrl+V or check this site's
browser permission. The clear icon button below Paste is disabled when the
textarea is empty; clicking it clears the script when text is present. Undo and
Redo sit above the count in the same right-side column. They support typing,
paste, clear, and scripts loaded from voiceover reuse; rapid typing is grouped,
and the last 100 history steps are retained. Ctrl/Cmd+Z undoes, while
Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes when the textarea is focused. Each
control is disabled when its corresponding history is empty.

Use the compact **Search voices** field in the Voices card to search names
case-insensitively on the server. Only cloned voices appear in results and
pages. The card offers 50, 80, or 100 rows per page (default 50), with
page navigation and a matching-voice total in the footer; its page size is
stored independently from the Voiceovers page size. Changing the search or
page size returns to page one. Clicking a matching row selects that voice. An
unmatched query shows **No matching voices.** without changing the stored voice
selection. With no voices at all, the card keeps its empty-collection message.
Each row also shows the number of completed voiceovers associated with that
voice, including zero. Queued and running jobs are excluded. Counts refresh
when generation completes and after individual or bulk history deletion.

During cloning, the **Clone voice** label and Upload icon remain unchanged,
and you can keep selecting or dropping more files. Each file joins the end of
a queue; one voice is cloned at a time, in the order files were added.

Waiting files show a **Your uploaded voice is waiting to be cloned.** toast
with an animated dashed icon. When a file starts, the same toast changes to
**Your uploaded voice is getting cloned.** with the amber spinner. Each toast
includes its filename. Success changes the spinner into a green tick and says
**Your voice has been cloned.** for one second. The next file starts immediately
after the previous request finishes; a failed file shows an error and does not
stop the remaining queue.

The queue belongs to this open Studio page. Leaving or reloading the page drops
files that have not started. A request already sent to the server can still
finish. If the model temporarily becomes unavailable, waiting files pause
until it is ready again.

Voice names are stored by the API and appear on future voiceovers. Renaming a
voice does not rewrite names already recorded in history. Reference downloads
are the original uploaded audio.

## Generate and cancel voiceovers

Write up to 60,000 characters in the Script editor, choose a voice in the
Voices card and a script language in the footer, then select **Generate**. The button is enabled only
when the script has non-whitespace text, an available voice and language are
selected, health confirms the model is loaded on a CUDA device, and no
submission is in progress. Ctrl/Cmd+Enter generates when the form is ready.
During startup, Generate shows **Waiting for the voice model to load.** The
language selector, voice picker, and Clone voice control remain visible but
disabled; hovering them shows **Available when the voice model is ready.** If
model loading falls back to CPU,
Clone voice becomes available when loading completes but
Generate remains disabled because Studio generation requires CUDA. The compact
Generate action is right-aligned in the editor footer. The fixed mascot is dragged by
the mascot artwork itself, while its subdued side arrows cycle the numbered
catalog without initiating a drag. Clicking the artwork instead plays the
mascot's reaction. Its corner grip resizes the mascot between 56 and 176px,
by drag or arrow keys; that size, like its dragged position, lasts only for
the browser tab. Mascot 2 (the Cat sheets) is the default.
To add one, commit `<id>a.webp` (directions) and `<id>b.webp` (reactions) in
`apps/studio/public/mascots/`; normal Studio commands regenerate and validate
`src/features/mascots/generated/mascotCatalog.ts`, which must be committed with the pair.
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
match loaded pages. Open the filter button beside search to set Voice, Date
range, Duration, or Generation status. The four equal-width controls form two
rows: Voice and Date range, then Duration and Generation status. The total
count appears in the compact card footer. Selecting a filter applies it immediately while leaving the filter
popover open; its Clear action and active-filter count update at once. The
popover closes only when clicked outside or dismissed with Escape. Custom date
and duration ranges stay open through their Apply button. The row wraps on
narrow screens without horizontal scrolling.
Search and filters narrow the history.
The page size, filter selections, and display-name overrides are stored in this
browser; the search query is not persisted. These preferences are not
server-side account data.
To rename a voiceover, click the pencil button beside its name and edit the
field. Clicking the name itself does not enter edit mode; the name field is
read-only until the pencil is used.

Dropdown menus and selectors share the Base UI menu primitives. Tooltips use
the shared Base UI tooltip component, and interface icons use `lucide-react`.

Each completed row keeps a fixed-width editable name followed by a truncated
script preview and timestamp. Its transport row provides play/pause and a
seekable progress bar; download and a three-dot menu sit at the right. The menu
contains **Delete**. Clicking the script preview reuses the saved script, voice,
and language. Generating and queued rows also reuse their script from the
preview and have no three-dot menu. Downloads produce an MP3. Live rows use the
same compact name/script arrangement, with queue/progress controls instead of
completed-row download and overflow actions.

Delete opens a confirmation with **Cancel** and **Delete**. Cancel leaves the
voiceover untouched. Confirming schedules a server delete and shows a
seven-second Undo toast. The row remains until the timer expires and the
refreshed history no longer includes it. Undo cancels the pending request.
Both voice and voiceover delete toasts use the same amber status ring as voice
cloning. The ring shows remaining Undo time; hovering the toast does not extend
that deadline. After seven seconds, Undo disappears and the ring spins while
the server deletes the item. Successful deletion animates a green tick, then
the toast disappears after one second. Failed requests keep the existing error
feedback and rollback behavior.

Leaving the page before the timer expires cancels the pending client-side delete;
the history entry remains on the server. Individual deletes remain separate
actions; Settings provides the confirmed, permanent bulk actions described above.

Reusing a finished voiceover's script fills the composer with its saved script,
voice, and generation language. Reusing a queued job restores the same three
fields. Each voiceover retains the language chosen for that generation, which
can differ from the reference voice's language. Older entries without a saved
language require choosing a language again. If this replaces text already in the composer, the app offers a separate
Undo that restores the previous script, voice, and language.

## Persistence and startup

Presets, completed history, and the generation queue are persisted under
`services/voice-api/storage/` in a source checkout. The browser API cache
persists history pages, voice-list pages (including display counts), and model
language options in localStorage for up to 24 hours; query data is stale after
one minute and retained in memory for 20 minutes. Queue snapshots, readiness,
scripts, uploads, and generated audio are excluded from that API cache. The
queue is polled into memory while Studio is open; its server records still
survive backend restarts. Browser-local names, history and voice page-size
preferences, filter selections, theme choice, and mascot-visibility preference
are stored separately in localStorage. A running job
restarts from the beginning of that job, not from its last chunk.

During Vite development, Studio renders its real header, logo, editor, cards,
and static controls immediately. Skeletons appear only in API-backed voice
rows, language options, and uncached history or initial queue rows until those
queries load. The backend status file reports startup phases, and health
reports readiness and errors; no full-screen startup gate covers the Studio.
Generate and Clone voice
remain disabled while the model loads. Once loading completes, Clone voice is
available even on CPU fallback, while Generate stays disabled unless health
confirms a CUDA device. The runtime readout shows loading or unavailable values
instead of stale readiness or device details and hides below 1600px. If the backend is
unavailable or model startup fails,
a pulsing warning button at the lower left opens a modal with the reported
message and a Retry action when available. A failed background history refresh
leaves cached voiceovers visible and does not add an inline notice above the
list. The API serves `apps/studio/dist` when that build exists;
use Vite at `:5173` while developing Studio to avoid mistaking a built UI for
the live source.
