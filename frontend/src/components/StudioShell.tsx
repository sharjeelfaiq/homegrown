import { useCallback, useEffect, useRef, useState } from 'react'
import NewVoiceModal from './NewVoiceModal'
import ThemeSwitch from './ThemeSwitch'
import VoicePicker from './VoicePicker'
import ScriptBlock from './ScriptBlock'
import HistoryList from './HistoryList'
import GenerateButton from './GenerateButton'
import { MAX_SCRIPT_CHARS } from '../constants'
import { presetNameFromFile } from '../format'
import { PlusIcon } from './Icons'
import { useGenerationActivity } from '../GenerationActivityContext'
import { useBootStatus } from '../hooks/useBootStatus'
import { useFileDrop } from '../hooks/useFileDrop'
import { useHotkeys } from '../hooks/useHotkeys'
import { wakeBackend } from '../wake'
import BootOverlay from './BootOverlay'
import Modal from './Modal'
import {
  ApiError,
  HISTORY_INITIAL_COUNT,
  HISTORY_LOAD_MORE_COUNT,
  createPreset,
  deleteHistoryEntry,
  deletePreset,
  getHealth,
  listHistory,
  listPresets,
  renamePreset,
  startGenerate,
  type Estimate,
  type HistoryEntry,
  type Preset,
} from '../api'

/** Sent only so the backend has something if language detection comes back
 * empty or names a language this model cannot speak. */
const LANGUAGE_FALLBACK = 'English'

export default function StudioShell() {
  const [modelStatus, setModelStatus] = useState<'checking' | 'ready' | 'down'>('checking')
  const [wakeMessage, setWakeMessage] = useState<string | null>(null)
  const [wakeNonce, setWakeNonce] = useState(0)
  const [warmingUp, setWarmingUp] = useState(false)
  const [cpuNotice, setCpuNotice] = useState<string | null>(null)
  // A CUDA fault kills the process's context: the running voiceover dies and
  // so does everything queued behind it, and nothing recovers in-process.
  // Polled rather than read once at startup, because it happens mid-session.
  const [gpuFault, setGpuFault] = useState<string | null>(null)
  // Dismissible, so the failed rows, finished voiceovers and a half-written
  // script all stay reachable underneath. Re-opens if more jobs fail after a
  // dismissal -- the user has evidently tried again and hit the same wall.
  const [faultSeenAt, setFaultSeenAt] = useState<number | null>(null)

  const [presets, setPresets] = useState<Preset[]>([])
  const [voiceId, setVoiceId] = useState<string | null>(null)

  // Reference clips that the backend shortened, by preset id. Session-only:
  // it is a report on what just happened, not a property of the voice.
  const [voicesOpen, setVoicesOpen] = useState(false)
  const [creatingPreset, setCreatingPreset] = useState(false)
  // Separate from the composer's `error`, which renders inside .composer and
  // is therefore UNDERNEATH the open dialog -- a voice that failed to save
  // reported itself on a page the user could not see.
  const [voiceError, setVoiceError] = useState<string | null>(null)

  // One script, not a list: the "+ Add block" control is gone, so there is no
  // way to create a second one. startGenerate is still called per-script below,
  // so the backend contract is unchanged.
  const [script, setScript] = useState('')
  // Only the new-voice form writes this now: it is the language stamped onto a
  // voice at creation. Generation reads the chosen voice's own language instead
  // (see handleGenerate), so the two can no longer disagree.

  // One accumulating list, not a page. `historyNonce` reloads it from the top,
  // keeping however many slices are already on screen.
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyNonce, setHistoryNonce] = useState(0)
  const [pendingNew, setPendingNew] = useState(0)
  // Refs, not state: read inside callbacks that must not be rebuilt (and so
  // must not re-arm the IntersectionObserver) every time they change.
  const loadedRef = useRef(0)
  const totalRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const atTopRef = useRef(true)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<Estimate | null>(null)

  const { queue, refresh: refreshQueue } = useGenerationActivity()
  // Only while we are actually waiting. Null whenever there is no dev-server
  // status source, which is every non-`vite dev` build -- the row below then
  // falls back to wakeMessage's elapsed counter alone.
  const boot = useBootStatus(modelStatus === 'checking')
  // Set when boot_status reports a failed model load, so the in-flight
  // wakeBackend poll can be ignored rather than cancelled -- see the effect
  // below for why waiting it out is not an option.
  const bootFailedRef = useRef(false)
  const scriptRef = useRef<HTMLTextAreaElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const refreshHistory = useCallback(() => setHistoryNonce((n) => n + 1), [])

  function refreshPresets() {
    listPresets()
      .then((r) => {
        setPresets(r.presets)
        // Default to the first voice so a new user can type and hit Generate
        // without first realising a voice must be chosen.
        setVoiceId((current) => current ?? r.presets[0]?.id ?? null)
      })
      .catch(() => {})
  }

  useEffect(() => {
    let cancelled = false
    bootFailedRef.current = false
    setModelStatus('checking')
    setWakeMessage(null)
    wakeBackend((status, elapsedMs) => {
      if (cancelled || status !== 'starting') return
      setModelStatus('checking')
      setWakeMessage(`Loading the voice model… ${Math.round(elapsedMs / 1000)}s`)
    })
      .then(() => {
        if (cancelled || bootFailedRef.current) return
        setModelStatus('ready')
        setWakeMessage(null)
        // The backend runs on CPU when no usable GPU was found. It still works,
        // but generation is orders of magnitude slower -- say so up front rather
        // than letting the first job look like it hung.
        getHealth()
          .then((h) => {
            if (!cancelled && h.device === 'cpu') {
              setCpuNotice(h.device_reason ?? 'No usable GPU found.')
            }
          })
          .catch(() => {})
        refreshPresets()
        refreshHistory()
      })
      .catch((e) => {
        if (cancelled || bootFailedRef.current) return
        setModelStatus('down')
        setWakeMessage(e instanceof Error ? e.message : 'Backend unreachable.')
      })
    return () => {
      cancelled = true
    }
  }, [wakeNonce, refreshHistory])

  // A model that fails to load is the one case wakeBackend cannot diagnose.
  // lifespan() is deliberately fail-soft there -- it keeps serving with
  // model_loaded:false rather than crashing before uvicorn binds -- so
  // callWake() reads that as 'starting' and polls happily for the full
  // LOCAL_TIMEOUT_MS (10 minutes) before reporting a timeout that blames the
  // wrong thing. boot_status has the real reason within seconds. Use it.
  useEffect(() => {
    if (boot?.phase !== 'error') return
    bootFailedRef.current = true
    setModelStatus('down')
    setWakeMessage(boot.detail || 'The voice model failed to load.')
  }, [boot?.phase, boot?.detail])

  // Reload from the top, refetching as many entries as are already on screen so
  // the user's scroll depth survives. Refetching the whole prefix (rather than
  // patching the array) is what keeps deletion correct: removing an entry
  // shifts every later one up by one, so an offset-based append would skip a
  // voiceover. The same applies when a new one lands at the top.
  useEffect(() => {
    let cancelled = false
    const want = Math.max(HISTORY_INITIAL_COUNT, loadedRef.current)
    listHistory(want, 0)
      .then((r) => {
        if (cancelled) return
        setHistory(r.history)
        setHistoryTotal(r.total)
        loadedRef.current = r.history.length
        totalRef.current = r.total
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [historyNonce])

  // Append the next slice. Stable identity on purpose -- HistoryList uses it as
  // an effect dependency to arm its observer.
  const loadMoreHistory = useCallback(() => {
    if (loadingMoreRef.current || loadedRef.current >= totalRef.current) return
    loadingMoreRef.current = true
    listHistory(HISTORY_LOAD_MORE_COUNT, loadedRef.current)
      .then((r) => {
        setHistoryTotal(r.total)
        totalRef.current = r.total
        setHistory((prev) => {
          // De-duplicated by id because offsets are not stable: a voiceover
          // finishing between the two requests shifts everything down one, and
          // a naive append would then show a row twice.
          const seen = new Set(prev.map((e) => e.id))
          const next = [...prev, ...r.history.filter((e) => !seen.has(e.id))]
          loadedRef.current = next.length
          return next
        })
      })
      .catch(() => {})
      .finally(() => {
        loadingMoreRef.current = false
      })
  }, [])

  // A finished job must not scroll the list out from under a reader. At the top
  // the new voiceover belongs there anyway, so refresh in place; scrolled down,
  // count it and let them choose when to jump. atTopRef, not state, so this
  // effect does not re-run on every scroll event.
  // Check health whenever a job has just failed. Cheap (only on transition)
  // and it cannot miss the fault, because the fault is what produced the
  // failure.
  const errorCount = queue.filter((e) => e.status === 'error').length
  useEffect(() => {
    if (errorCount === 0) return
    getHealth()
      .then((h) => setGpuFault(h.gpu_fault ?? null))
      .catch(() => {})
    setFaultSeenAt((seen) => (seen != null && errorCount > seen ? null : seen))
  }, [errorCount])

  const doneCount = queue.filter((e) => e.status === 'done').length
  const lastDoneCount = useRef(doneCount)
  useEffect(() => {
    if (doneCount <= lastDoneCount.current) {
      lastDoneCount.current = doneCount
      return
    }
    const added = doneCount - lastDoneCount.current
    lastDoneCount.current = doneCount
    if (atTopRef.current) refreshHistory()
    else setPendingNew((n) => n + added)
  }, [doneCount, refreshHistory])

  // Scrolling back to the top by any route means the badge has served its
  // purpose -- otherwise it lingers over content the user is already looking at.
  const handleAtTopChange = useCallback((atTop: boolean) => {
    atTopRef.current = atTop
    if (atTop) setPendingNew(0)
  }, [])

  function showNewVoiceovers() {
    setPendingNew(0)
    refreshHistory()
  }

  // Both routes to a reference clip go through here -- the window-wide drop and
  // the modal's own dropzone -- so the name gets pre-filled either way. It used
  // to be derived only on the window-drop path, which meant picking a file
  // inside the modal left the field blank.
  //
  // A dropped clip IS the decision -- there is no Save step and no name to
  // fill in. The name comes off the filename and is editable in place on the
  // row this creates, which is the whole point of the dialog now.
  async function handleAddVoice(file: File) {
    if (creatingPreset) return
    setCreatingPreset(true)
    setVoiceError(null)
    try {
      // Language is a fallback, not a choice: the backend replaces it with
      // whatever faster-whisper detected in the recording itself.
      const preset = await createPreset(
        presetNameFromFile(file.name),
        file,
        '',
        LANGUAGE_FALLBACK,
      )
      setPresets((prev) => [preset, ...prev])
      setVoiceId(preset.id) // a voice you just made is the one you want to use
      // Deliberately NOT closing. The dialog used to close here, back when
      // saving was the last step; now the row it just created -- with its
      // editable name -- is the thing the user came to see.
    } catch (e) {
      setVoiceError(e instanceof ApiError ? e.message : 'Failed to add the voice')
    } finally {
      setCreatingPreset(false)
    }
  }

  // Dropping an audio file anywhere opens the voices dialog. The voice is
  // already saved by the time it appears.
  const dragging = useFileDrop((file) => {
    setVoicesOpen(true)
    void handleAddVoice(file)
  })

  async function handleRenamePreset(id: string, name: string) {
    const trimmedName = name.trim()
    if (!trimmedName) return
    const before = presets
    // Optimistic: the field has already visually committed, and bouncing the
    // text back on a slow round-trip reads as the edit being rejected.
    setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, name: trimmedName } : p)))
    try {
      await renamePreset(id, trimmedName)
    } catch (e) {
      setPresets(before)
      setVoiceError(e instanceof ApiError ? e.message : 'Failed to rename the voice')
    }
  }

  async function handleDeletePreset(id: string) {
    try {
      await deletePreset(id)
      setPresets((prev) => prev.filter((p) => p.id !== id))
      setVoiceId((current) => (current === id ? null : current))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete voice')
    }
  }

  async function handleDeleteHistory(id: string) {
    try {
      await deleteHistoryEntry(id)
      refreshHistory() // the effect above re-clamps the page if this emptied it
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete voiceover')
    }
  }

  // No setLanguage here any more: selecting the voice already determines the
  // language, so restoring the entry's own would just duplicate it -- and would
  // be wrong if the voice has since been recreated in another language.
  function handleRequeue(entry: HistoryEntry) {
    setScript(entry.text)
    setVoiceId(entry.preset_id)
    scriptRef.current?.focus()
  }

  const scriptReady =
    script.trim().length > 0 && script.length <= MAX_SCRIPT_CHARS && voiceId != null

  async function handleGenerate() {
    if (!scriptReady) {
      setError(
        presets.length === 0
          ? 'Add a voice first — drop a reference clip anywhere on this page.'
          : 'Write a script and pick a voice.',
      )
      return
    }
    setError(null)

    // Normally a no-op: canGenerate already requires modelStatus 'ready'. This
    // is the race guard for the model having gone away while the tab sat idle.
    setWarmingUp(true)
    try {
      await wakeBackend((status, elapsedMs) => {
        setWakeMessage(
          status === 'starting' ? `Loading the voice model… ${Math.round(elapsedMs / 1000)}s` : null,
        )
      })
    } catch (e) {
      setWarmingUp(false)
      setWakeMessage(null)
      setModelStatus('down')
      setError(e instanceof Error ? e.message : 'Failed to start the backend.')
      return
    }
    setWarmingUp(false)
    setWakeMessage(null)

    setSubmitting(true)
    try {
      const voiceLanguage = presets.find((p) => p.id === voiceId)?.language || 'English'
      await startGenerate({ presetId: voiceId as string, text: script, language: voiceLanguage })
      setScript('')
      refreshQueue()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  const canGenerate = modelStatus === 'ready' && scriptReady && !submitting && !warmingUp

  // Say what is missing rather than presenting a mute grey slab -- but only
  // for prerequisites the user has to go and fix elsewhere. An empty script is
  // not one of those: the cursor is already in the box, so the button just
  // reads "Generate" and stays disabled.
  const blockedReason =
    canGenerate || submitting || warmingUp
      ? null
      : modelStatus !== 'ready'
        ? 'Waiting for the voice model'
        : presets.length === 0
          ? 'Add a voice first'
          : voiceId == null
            ? 'Pick a voice'
            : script.length > MAX_SCRIPT_CHARS
              ? 'Script is too long'
              : null

  useHotkeys({
    onGenerate: () => {
      if (canGenerate) handleGenerate()
    },
    onFocusScript: () => scriptRef.current?.focus(),
    onCancel: () => setError(null),
    // VoiceoverPlayer owns its own <audio>, so rather than lifting that state up to
    // service one shortcut, Space clicks the newest voiceover's play button. The
    // transport stays encapsulated where it belongs. In-progress rows sit above
    // the finished ones but carry no .voiceover-play-btn -- there is nothing to
    // play yet -- so this still finds the newest playable voiceover.
    onPlayPause: () => {
      resultsRef.current?.querySelector<HTMLButtonElement>('.voiceover-play-btn')?.click()
    },
  })

  return (
    <div className="flex min-h-svh flex-col wide:h-svh wide:overflow-hidden">
      {/* The wrapper exists only to be a positioning context for the theme
          control. It adds no height -- it contains just the h1, which keeps
          its own padding and hairline -- and it is not a flex row, so the
          wordmark stays optically centred in the full page width. An <h1>
          takes phrasing content only, so the control cannot live inside it. */}
      <div className="relative">
        {/* Equal padding top and bottom so the wordmark sits centred between the
            window edge and the rule below it. leading-none is what makes that
            true rather than approximate -- at the inherited 1.55 the line box
            adds ~7px of half-leading, and since uppercase has no descenders
            the glyphs then read as sitting high in their own box.

            The hairline is a full-width border beneath, not an underline on
            the text: it separates the title from the workspace without
            putting a rule through the wordmark's wide tracking. */}
        <h1 className="border-b border-hairline px-(--gutter) py-[30px] text-center font-display text-[26px]/none font-semibold tracking-[0.1em] uppercase text-muted">
          Homegrown
        </h1>
        <ThemeSwitch />
      </div>

      {/* minmax(0, ...) on BOTH tracks is load-bearing: the voiceover
          waveform is a canvas with an intrinsic width, and on an `auto` track
          it refuses to shrink and pushes the layout wider than the viewport.

          `wide:` is 1025px, NOT Tailwind's lg (1024px) -- see --breakpoint-wide
          in index.css. Above it the page is pinned to one viewport and the
          Voiceovers list is the single scrolling region inside it; below it the
          grid is one column and the PAGE scrolls, because a short inner
          scroller inside a locked page is two nested scroll regions on a phone.

          The min-h-0 chain runs .studio -> here -> .aside -> .results ->
          .result-list. A flex item's default min-height:auto refuses to shrink
          below its content, so one missing link puts the scrollbar back on the
          page instead of on the list. All five are marked; do not drop one. */}
      <main className="mx-auto grid w-full max-w-(--shell) grid-cols-[minmax(0,1fr)] items-start gap-[34px] px-(--gutter) pt-8 pb-[72px] wide:min-h-0 wide:flex-auto wide:grid-cols-[minmax(0,1.15fr)_minmax(0,var(--aside))] wide:gap-10 wide:pb-8">
        <div className="composer flex min-w-0 flex-col gap-[22px] wide:min-h-0">
          {/* Pairs with the Voiceovers heading opposite, same .section-rule
              treatment: you write a script here, the voiceovers appear there.
              "Script" rather than "Compose" or "New voiceover" because it is
              the word the terminology table fixes for the text the user
              writes. */}
          {/* -mb-3 cancels the gap difference between the columns: the
              results column is gap-1 (4px + the rule's own 6px = 10px)
              and this one is gap-[22px]. Both headings must sit the same
              distance above their content, and shrinking .composer's gap
              instead would tighten the script card and the notices too. */}
          <h2 className="section-rule -mb-3">
            <span>Script</span>
          </h2>

          {/* No "Ready" indicator: GenerateButton already says what is missing
              ("Waiting for the voice model") whenever the model is not up.
              The DOWN state is different -- it is the only state the user can
              act on, and Retry is the app's only recovery control, so it moved
              here rather than disappearing with the header. */}
          {modelStatus === 'down' && (
            <p className="m-0 rounded-sm border border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger flex items-center justify-between gap-3" role="alert">
              {/* The model-load failure arrives as the backend's own multi-line
                  message rather than as one tidy sentence: wrap it and keep its
                  line breaks, while Retry stays put at the top beside it. */}
              <span className="min-w-0 whitespace-pre-wrap">
                {wakeMessage ?? 'Backend unreachable'}
              </span>
              <button
                type="button"
                className="ghost-btn flex-none self-start"
                onClick={() => setWakeNonce((n) => n + 1)}
              >
                Retry
              </button>
            </p>
          )}


          {cpuNotice && (
            <p className="m-0 rounded-sm border border-progress-line bg-progress-soft px-3 py-2.5 text-[13px] text-progress">Running on CPU — generation will be very slow. {cpuNotice}</p>
          )}



          <ScriptBlock
            text={script}
            onTextChange={setScript}
            textareaRef={scriptRef}
            presetId={voiceId}
            onEstimate={setEstimate}
          />

          {/* The voice's own reference clip decides chunk size, so a long
              reference silently multiplies both chunk count and render time.
              The backend only logged this; now it reaches the person who can
              act on it. */}
          {estimate?.warning && <p className="m-0 rounded-sm border border-progress-line bg-progress-soft px-3 py-2.5 text-[13px] text-progress">{estimate.warning}</p>}

          {error && (
            <p className="m-0 rounded-sm border border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger" role="alert">
              {error}
            </p>
          )}

          {/* One action row under the script: add-voice, voice, generate.
              The voice picker sits here rather than inside the card, so the
              script box stays the script box.
              GenerateButton stays a button throughout -- progress now lives in
              the Voiceovers column, as the first row, where the finished
              voiceover will land. */}
          <section className="compose-bar flex flex-wrap items-center gap-2">
            <GenerateButton
              disabled={!canGenerate}
              blockedReason={blockedReason}
              busy={submitting}
              warming={warmingUp}
              count={scriptReady ? 1 : 0}
              onClick={handleGenerate}
            />

            {/* The voice controls are the row's right-hand anchor now, so
                ml-auto lives here rather than on Generate. Grouped in one
                wrapper so the dropdown and the [+] beside it move together --
                they are one control with an affordance attached, not two
                things that happen to be adjacent. */}
            <div className="ml-auto flex min-w-0 items-center gap-2">
              <VoicePicker
                presets={presets}
                selectedPresetId={voiceId}
                onSelect={setVoiceId}
                loading={modelStatus === 'checking'}
              />

              <button
                type="button"
                className="icon-btn size-8 flex-none border border-control bg-control-fill text-muted hover:border-audio-line hover:bg-control-fill-hover hover:text-audio"
                aria-label="Add a voice"
                title="Add a voice"
                onClick={() => setVoicesOpen(true)}
              >
                <PlusIcon size={15} />
              </button>
            </div>
          </section>

        </div>

        <aside className="min-w-0 wide:h-full wide:min-h-0" ref={resultsRef}>
          <HistoryList
            history={history}
            total={historyTotal}
            hasMore={history.length < historyTotal}
            onLoadMore={loadMoreHistory}
            pendingNew={pendingNew}
            onShowNew={showNewVoiceovers}
            onAtTopChange={handleAtTopChange}
            onDelete={handleDeleteHistory}
            onRequeue={handleRequeue}
            onError={setError}
            gpuFault={gpuFault != null}
            loading={modelStatus === 'checking'}
          />
        </aside>
      </main>

      {/* A modal rather than a line above the script box. This is not a
          message about the script -- it is the whole app being unusable until
          the process is replaced -- and it carries the backend's raw error,
          which is several lines of CUDA text that has no business sitting on
          top of a textarea. Dismissible, so finished voiceovers and a
          part-written script stay reachable. */}
      <Modal
        open={gpuFault != null && faultSeenAt == null}
        title="The graphics driver reset"
        onClose={() => setFaultSeenAt(errorCount)}
      >
        {/* Informational only. The app cannot restart its own backend --
            nothing supervises the process, and launcher.py has already exited
            by the time the app is usable -- so telling the user what to do is
            the honest extent of it. A button that quit but could not reopen
            would be a worse trade than a sentence. */}
        <p className="m-0 mb-3 text-[13px]/[1.55] text-muted">
          Your graphics card stopped responding, so the voiceovers being made just now have
          failed. Everything you finished earlier is safe.
        </p>
        <p className="m-0 mb-3 text-[13px]/[1.55] text-muted">
          Closing Homegrown and opening it again fixes this.
        </p>

        <details className="fault-more m-0 mb-4">
          <summary>Technical details</summary>
          <pre className="mt-2 mb-0 max-h-[140px] overflow-auto rounded-sm border border-danger bg-danger-soft px-3 py-2.5 font-mono text-[11px]/[1.5] break-words whitespace-pre-wrap text-danger-text">
            {gpuFault}
          </pre>
        </details>

        <div className="flex justify-end gap-2.5">
          <button type="button" className="ghost-btn" onClick={() => setFaultSeenAt(errorCount)}>
            Close
          </button>
        </div>
      </Modal>

      <NewVoiceModal
        open={voicesOpen}
        onClose={() => {
          setVoicesOpen(false)
          setVoiceError(null)
        }}
        presets={presets}
        onFileSelected={handleAddVoice}
        uploading={creatingPreset}
        error={voiceError}
        onRename={handleRenamePreset}
        onDelete={handleDeletePreset}
      />

      {/* Everything else on the page is inert until the model is up, so the
          startup screen covers it rather than sitting above the script box.
          Dropped the instant modelStatus leaves 'checking' -- including on
          failure, so the error row below is never trapped behind it. */}
      {modelStatus === 'checking' && <BootOverlay boot={boot} elapsed={wakeMessage} />}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-100 grid place-items-center bg-scrim-drop outline-2 outline-dashed outline-offset-[-14px] outline-audio">
          <p className="m-0 font-mono text-[13px] tracking-[0.06em] text-audio">
            Drop a reference clip to make a voice
          </p>
        </div>
      )}
    </div>
  )
}
