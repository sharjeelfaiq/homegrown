# Workflow — Voice Clone Studio

How this app is actually used day-to-day, end to end. For architecture/limitations, see `README.md`; for cloud GPU options, see `gpu.txt`.

## 1. Start the app

Two terminals (see `README.md` "Running it" for exact commands):
- Backend: `../.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000` from `backend/`
- Frontend: `npm run dev` from `frontend/` (needs `frontend/.env.local` with
  `VITE_BACKEND_URL=http://127.0.0.1:8000` -- there is no dev proxy)

Open `http://localhost:5173`. For the single-port LAN setup instead, see `README.md`. The header badge shows model load status — wait for "Model ready" before generating (the model + CUDA graphs take a few seconds to a minute to warm up on first request).

## 2. Manage voices (Studio tab → Voices)

Every preset here is one you created — the gallery has a **Studio Voices** section for built-in
presets, but the backend ships none, so in practice you only ever see **My Voices**.

To add a voice:
1. "New preset" → name it, upload a reference clip (**10-20 seconds is the sweet spot**; 2-60s is accepted). Longer is not
   better: the clip and your script share one context window, so a long clip crowds out the script and
   the output starts murmuring and dropping words. Record dry and close-mic -- room reverb gets cloned
   along with the voice. See README.md's preset section for the measurements.
2. Leave the transcript field **blank** to auto-transcribe with faster-whisper, or type the exact words spoken in the clip yourself. This must match the audio precisely — a placeholder or wrong transcript is the single most common cause of bad voice-clone output.
3. Optionally add a mood/style tag (e.g. "Cinematic") — shown on the card, purely descriptive.
4. "Save preset."

Click the play button on any card to **instantly preview the reference clip itself** (not a live generation — a real generation takes ~85s+ per chunk on this hardware, so previews play the stored sample instead).

Clicking a card body assigns that voice to the next script block that doesn't have one yet (a shortcut — the dropdown on each script block is the explicit way to assign voices).

## 3. Write and queue scripts (Studio tab → Scripts)

Each **script block** is independent:
- Its own voice dropdown
- Its own text (up to 60,000 characters, with a live estimated-time readout that updates as you type)
- Its own reorder (^/v) and remove buttons

"+ Add another script" adds more blocks — write as many voiceovers as you want in one sitting, each with a different voice if needed. Language applies to the whole batch, not per-block. (Style and Stability still exist in the backend
and default to natural/balanced, but the current UI does not send them.)

Click **Generate** — every valid block (non-empty text, a voice picked, under the char limit) gets submitted to the queue at once.

## 4. Monitor the queue (Currently Generating)

Jobs process **one at a time** (this is a single-GPU setup — the model can't run two generations concurrently, so there's no point pretending otherwise). **Currently Generating** shows the one job actually on the GPU, as a single row with a progress bar; anything waiting sits under it as a compact line you can reorder (^/v) or cancel (trash icon). Statuses:
- **Queued** — waiting, with an estimated wait time (accounts for the job currently running plus everything ahead of it in line)
- **Processing** — chunk N/M complete, with a live "time remaining" estimate and a progress bar
- **Failed** — error message shown directly (e.g. a GPU driver reset, or a chunk that failed every attempt)
- **Canceled** — you canceled it before it started

Finished jobs do **not** stay here — they move to **Generations**, playable inline and downloadable. A running job can be canceled (it stops after the current chunk); a queued one can be canceled before it starts.

## 5. Review past generations

Every finished job lands in **Generations** below the queue: preset used, stability, estimated vs. actual
generation time, inline playback, download, and a rename field for the downloaded file name.

**Re-queue with edits** (wand icon) pulls that job's script and voice back into a fresh Studio script block and switches you back to the Studio tab — the fastest way to tweak and regenerate something.

## What's happening underneath (brief)

- **Long scripts are chunked**, not sent as one giant generation — each chunk gets a fresh KV cache, which
  is what prevents audio degrading into noise on long text. Chunk size is computed per preset from what
  its reference clip leaves in the context window, and chunks are size-balanced so there is no runt final
  chunk. A chunk whose audio comes out wildly longer or shorter than its text warrants is regenerated.
  See `README.md`'s "How generation works".
- **Time estimates** come from a rolling average of chars/second across the last 20 completed jobs (seeded from `history.json` on restart, so estimates are sane immediately, not just after the first job of a session).
- **The queue survives a backend restart** — `queue.json` persists queued/in-flight jobs and resumes them (from the start of that job, not mid-chunk) on the next startup.
- **The waveform visual** on the Studio tab is decorative except when something is actually playing, at which point it reflects real audio amplitude via the Web Audio API.
