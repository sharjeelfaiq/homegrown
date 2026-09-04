# Workflow — Voice Clone Studio

How this app is actually used day-to-day, end to end. For architecture/limitations, see `README.md`; for cloud GPU options, see `gpu.txt`.

## 1. Start the app

Two terminals (see `README.md` "Run" section for exact commands):
- Backend: `python -m uvicorn main:app --host 127.0.0.1 --port 8000` from `webapp/backend`
- Frontend: `npm run dev` from `webapp/frontend`

Open `http://localhost:5173`. The header badge shows model load status — wait for "Model ready" before generating (the model + CUDA graphs take a few seconds to a minute to warm up on first request).

## 2. Manage voices (Studio tab → Voices)

Two sections:
- **Studio Voices** — the 8 seeded presets, always available.
- **My Voices** — presets you've created.

To add a voice:
1. "New preset" → name it, upload a reference clip (2-15 seconds, clean audio — longer clips produce unstable/garbled generations on this hardware, enforced server-side).
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

"+ Add another script" adds more blocks — write as many voiceovers as you want in one sitting, each with a different voice if needed. Style and Stability (and Language) apply to the whole batch, not per-block.

Click **Generate All** — every valid block (non-empty text, a voice picked, under the char limit) gets submitted to the queue at once, and the app switches you to **Queue & History** so you can watch them process.

## 4. Monitor the queue (Queue & History tab)

Jobs process **one at a time** (this is a single-GPU setup — the model can't run two generations concurrently, so there's no point pretending otherwise). Each row shows:
- **Queued** — waiting, with an estimated wait time (accounts for the job currently running plus everything ahead of it in line)
- **Processing** — chunk N/M complete, with a live "time remaining" estimate
- **Done** — audio ready, playable inline, downloadable
- **Failed** — error message shown directly (e.g. a GPU driver reset, or a chunk that failed twice)
- **Canceled** — you canceled it before it started

For jobs still in the **Queued** state you can reorder (^/v) or cancel (trash icon) — once a job starts Processing it runs to completion or failure, no mid-job cancellation.

## 5. Review history

Every finished job lands in History below the queue: preset used, style/stability, estimated vs. actual generation time, inline playback, download.

**Re-queue with edits** (wand icon) pulls that job's script and voice back into a fresh Studio script block and switches you back to the Studio tab — the fastest way to tweak and regenerate something.

## What's happening underneath (brief)

- **Long scripts are chunked**, not sent as one giant generation — each chunk gets a fresh KV cache, which is what prevents the audio from degrading into noise on long text (a real bug this session's development fixed; see `README.md`'s "Long-form generation" section for the full story).
- **Time estimates** come from a rolling average of chars/second across the last 20 completed jobs (seeded from `history.json` on restart, so estimates are sane immediately, not just after the first job of a session).
- **The queue survives a backend restart** — `queue.json` persists queued/in-flight jobs and resumes them (from the start of that job, not mid-chunk) on the next startup.
- **The waveform visual** on the Studio tab is decorative except when something is actually playing, at which point it reflects real audio amplitude via the Web Audio API.
