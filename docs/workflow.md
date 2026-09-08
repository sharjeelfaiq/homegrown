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

Jobs process **one at a time** — single GPU, one worker thread, one lock. The **Generate** button *becomes*
the progress display: state, voice, time remaining, and a bar with hairline ticks at the chunk boundaries.
Anything queued behind it shows as a `(+N queued)` count.

**Cancel** stops a running job after the current chunk, within about a second.

The voice dropdown stays usable while a job runs, so you can line up the next one.

There is no queue list and no reorder control in the UI, although `POST /api/queue/reorder` exists and
works. If the backend becomes unreachable, an error row with a **Retry** button appears above the script.

## 5. Review past voiceovers

Finished jobs land in **Voiceovers** in the right-hand column, newest first, 20 per page. Each is three
lines:

1. Its **name**, and on the right the **voice** that spoke it. `Voiceover 1` is the oldest — the number
   comes from position, so deleting one renumbers the rest. The name is click-to-edit: type, click away to
   save, **Escape** to revert, clear it to fall back to `Voiceover N`. Whatever you call it is also the
   download filename, and the rename persists in `localStorage`. The field hugs its own text.
2. **Play** and the waveform, which doubles as the seek bar (click or arrow-key). Actions sit at the
   right, dimmed until you hover the row: **download**, **re-queue** (wand — pulls that script and voice
   back into the script box), and **delete**.
3. A **`0:12 / 1:06`** clock and the first words of the script. Click the left half to switch it to time
   remaining (`-0:54`); the total on the right stays put.

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
  session). They are no longer displayed next to the script box; the estimate is still used for the queue's
  time-remaining readout, and its `warning` field is what surfaces the long-reference-clip notice.
- **The queue survives a backend restart** — `queue.json` persists queued/in-flight jobs and resumes them
  (from the start of that job, not mid-chunk) on the next startup.
- **The waveform** reflects real audio amplitude via the Web Audio API while something plays. Only one
  element plays at a time; starting a second stops the first.
