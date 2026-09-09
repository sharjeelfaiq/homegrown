# Workflow — Homegrown

How this app is actually used day-to-day, end to end. For architecture and limitations, see `README.md`;
for cloud GPU options, see `docs/gpu-notes.md`.

## 1. Start the app

`bash dev.sh` from the repo root starts both processes, tails both logs, and prints when the model has
finished loading. Ctrl-C stops both.

Or the same thing in two terminals by hand (see `README.md` "Running it" for exact commands):
- Backend: `../.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000` from `backend/`
- Frontend: `npm run dev` from `frontend/` (needs `frontend/.env.local` with
  `VITE_BACKEND_URL=http://127.0.0.1:8000` -- there is no dev proxy)

Open `http://localhost:5173` — **`localhost`, not `127.0.0.1`**, unless `backend/.env`'s `ALLOWED_ORIGINS`
lists both; they are different origins to CORS. For the single-port LAN setup instead, see `README.md`.

There is no status badge to wait for. uvicorn runs the model load *before* it binds the socket, so until
the model is ready the port simply refuses connections and every API call fails — that is expected, not a
fault. `dev.sh` prints `model ready on <device>` when it is safe to generate. Until then the Generate
button reads **"Waiting for the voice model"**.

## 2. Add a voice

The **✚** button beside the voice dropdown opens the **Voices** dialog. You can also drop an audio file
anywhere in the window — that opens the same dialog with the file already loaded.

1. Drop or pick a reference clip. **10–20 seconds is the sweet spot**; 2–60s is accepted. Longer is not
   better: the clip and your script share one 1024-position context window, so a long clip crowds out the
   script and the output starts murmuring and dropping words. Past ~23s it has been observed to garble
   regardless. Record dry and close-mic — room reverb gets cloned along with the voice. Measurements are in
   `README.md`, "Making a voice that actually works".
2. The **name** pre-fills from the filename, with separators turned into spaces. Edit it if you like.
3. Pick a **language**. This is stamped onto the voice and is what generation uses — there is no language
   control on the compose path, and re-queueing an old voiceover does not restore a per-job language.
4. **Save voice.** The transcript is always produced automatically with faster-whisper; there is no
   transcript field to fill in.

The dialog also lists your saved voices, each with **▶** to hear its reference clip and a two-step delete
(the row flips to Delete/Keep). Deleting the voice you had selected clears the selection.

Every row of the voice **dropdown** carries the same ▶, so you can audition without opening the dialog.
Delete is only in the dialog — it is destructive, and it does not belong on a menu you open to pick a
voice.

> ▶ plays the stored reference clip, never a live generation — a real generation takes ~85s+ per chunk on
> this hardware.

## 3. Write a script and generate

One script box, up to 60,000 characters, fixed height — drag the corner grip to resize. The footer shows a
**word count** and nothing else.

Underneath sits one action row: **✚**, the **voice dropdown**, and **Generate** at the right.

Style and Stability still exist in the backend and default to `natural`/`balanced`, but nothing in the UI
sends them.

Shortcuts work but are not shown on screen: **Ctrl+Enter** generates, **Space** plays the newest voiceover,
**/** focuses the script, **Escape** dismisses an error.

## 4. Watch it run

Jobs process **one at a time** — single GPU, one worker thread, one lock.

The voiceover being generated appears **immediately as the first row of the Voiceovers column**, laid out
exactly like the finished row it will become — same editable name, same voice — with three swaps: the
waveform is a progress bar, the transport is a labelled **Cancel**, and the clock counts **elapsed** time.
Download and re-queue are absent until there is something to download.

**You can queue more while one runs.** The Generate button stays live — type another script, change
the voice if you want, press it again, and the new voiceover joins the queue rather than being refused.
Queued voiceovers appear as further rows above the finished ones, in the order they will be processed,
and they are **purple** where the one being generated is amber: an empty bar and the word `Queued`
instead of a filling bar and a ticking clock. When the running one finishes, the next promotes in place
and turns amber. Cancel works on either — cancelling a queued voiceover leaves the running one alone.

Elapsed, never remaining: the backend's `eta_s` is a rolling chars/second average that moves in *both*
directions as chunks land, so watching it told you nothing. The **Generate** button just says Generate,
throughout — the Voiceovers column reports the work, so the button does not need to.

**Cancel** stops a running job after the current chunk, within about a second. There is no pause: generation
is serialised behind one GPU lock, so a paused job would stall everything queued behind it.

The voice dropdown stays usable while a job runs, so you can line up the next one.

There is no queue list and no reorder control in the UI, although `POST /api/queue/reorder` exists and
works. If the backend becomes unreachable, an error row with a **Retry** button appears above the script.

**While the backend is still starting**, a status row sits above the script showing the phase
(*Tuning*, *Almost there*), a ticking elapsed counter and a progress bar, and both columns say they are
loading rather than that they are empty. In `vite dev` the phase comes from the backend's own
`boot_status.json`; elsewhere it falls back to the elapsed counter alone. A model that fails to load
reports its actual error here rather than timing out after ten minutes.

## 5. Review past voiceovers

Finished jobs land in **Voiceovers** in the right-hand column, newest first. The column is a **fixed
window showing about eight rows**; the newest 20 load up front and scrolling to the bottom fetches ten
more. There is no paginator
and, on a desktop-width window, no page scroll at all — the list is the only thing that scrolls. Below
1025px the layout collapses to one column — the composer on top, Voiceovers beneath it — and the page
scrolls normally instead, with the list growing to fit rather than scrolling inside itself. The script box
shrinks with the viewport there so it does not bury the history.

Each row is three lines:

1. Its **name**, and on the right the **voice** that spoke it. `Voiceover 1` is the oldest — the number
   comes from position, so deleting one renumbers the rest. The name is click-to-edit: type, click away to
   save, **Escape** to revert, clear it to fall back to `Voiceover N`. Whatever you call it is also the
   download filename, and the rename persists in `localStorage`. The field hugs its own text. A name typed
   into a row that is still generating carries over to the finished voiceover.
2. **Play**, the waveform (which doubles as the seek bar — click or arrow-key), a **`0:12 / 1:06`** clock,
   and the actions at the right, dimmed until you hover the row: **download**, **re-queue** (wand — pulls
   that script and voice back into the script box), and **delete**. Click the clock's left half to switch
   it to time remaining (`-0:54`); the total on the right stays put, and the slot is a fixed width so
   nothing beside it shifts.
3. The first words of the script.

A voiceover finishing while you are scrolled down the list does not move you. It is counted instead, and an
**N new voiceovers — show** button appears above the list.

Hover the name to see when it was created. Persisted to `backend/storage/history.json`, so it survives a
restart.

## What's happening underneath (brief)

- **Long scripts are chunked**, not sent as one giant generation — each chunk gets a fresh KV cache, which
  is what prevents audio degrading into noise on long text. Chunk size is computed per voice from what its
  reference clip leaves in the context window, and chunks are size-balanced so there is no runt final
  chunk. A chunk whose audio comes out wildly longer or shorter than its text warrants is regenerated.
  See `README.md`'s "How generation works".
- **Time estimates** come from a rolling average of chars/second across the last 20 completed jobs (seeded
  from `history.json` on restart, so estimates are sane immediately, not just after the first job of a
  session). Nothing in the UI shows them any more — the in-progress row reports elapsed time instead, and
  the only part of `/api/estimate` that reaches the screen is its `warning` field, which surfaces the
  long-reference-clip notice.
- **The queue survives a backend restart** — `queue.json` persists queued/in-flight jobs and resumes them
  (from the start of that job, not mid-chunk) on the next startup.
- **The waveform** reflects real audio amplitude via the Web Audio API while something plays. Only one
  element plays at a time; starting a second stops the first.
