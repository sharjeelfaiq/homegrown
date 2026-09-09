import { useCallback, useEffect, useRef, useState } from 'react'
import '../App.css'
import NewVoiceModal from './NewVoiceModal'
import VoicePicker from './VoicePicker'
import ScriptBlock from './ScriptBlock'
import HistoryList from './HistoryList'
import GenerateButton from './GenerateButton'
import { MAX_SCRIPT_CHARS } from '../constants'
import { presetNameFromFile } from '../format'
import { PlusIcon } from './Icons'
import { useGenerationActivity } from '../GenerationActivityContext'
import { bootTagline, bootWord, useBootStatus } from '../hooks/useBootStatus'
import { useFileDrop } from '../hooks/useFileDrop'
import { useHotkeys } from '../hooks/useHotkeys'
import { wakeBackend } from '../wake'
import {
  ApiError,
  HISTORY_INITIAL_COUNT,
  HISTORY_LOAD_MORE_COUNT,
  createPreset,
  deleteHistoryEntry,
  deletePreset,
  getHealth,
  getLanguages,
  listHistory,
  listPresets,
  startGenerate,
  type Estimate,
  type HistoryEntry,
  type Preset,
} from '../api'

export default function StudioShell() {
  const [modelStatus, setModelStatus] = useState<'checking' | 'ready' | 'down'>('checking')
  const [wakeMessage, setWakeMessage] = useState<string | null>(null)
  const [wakeNonce, setWakeNonce] = useState(0)
  const [warmingUp, setWarmingUp] = useState(false)
  const [languages, setLanguages] = useState<string[]>([])
  const [cpuNotice, setCpuNotice] = useState<string | null>(null)

  const [presets, setPresets] = useState<Preset[]>([])
  const [voiceId, setVoiceId] = useState<string | null>(null)

  const [newPresetName, setNewPresetName] = useState('')
  const [refFile, setRefFile] = useState<File | null>(null)
  const [voicesOpen, setVoicesOpen] = useState(false)
  const [creatingPreset, setCreatingPreset] = useState(false)

  // One script, not a list: the "+ Add block" control is gone, so there is no
  // way to create a second one. startGenerate is still called per-script below,
  // so the backend contract is unchanged.
  const [script, setScript] = useState('')
  // Only the new-voice form writes this now: it is the language stamped onto a
  // voice at creation. Generation reads the chosen voice's own language instead
  // (see handleGenerate), so the two can no longer disagree.
  const [newPresetLanguage, setNewPresetLanguage] = useState('English')

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
        getLanguages()
          .then((r) => !cancelled && setLanguages(r.languages))
          .catch(() => {})
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
  // Only fills a blank field: a name the user has already typed outranks
  // anything guessable from a filename.
  function handleRefFileSelected(file: File | null) {
    setRefFile(file)
    if (file && !newPresetName.trim()) {
      setNewPresetName(presetNameFromFile(file.name))
    }
  }

  // Dropping an audio file anywhere opens the voices modal with it loaded.
  const dragging = useFileDrop((file) => {
    handleRefFileSelected(file)
    setVoicesOpen(true)
  })

  async function handleCreatePreset() {
    if (!refFile) return
    setCreatingPreset(true)
    setError(null)
    try {
      const preset = await createPreset(newPresetName, refFile, '', newPresetLanguage)
      setPresets((prev) => [preset, ...prev])
      setVoiceId(preset.id) // a voice you just made is the one you want to use
      setNewPresetName('')
      setRefFile(null)
      setVoicesOpen(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save voice')
    } finally {
      setCreatingPreset(false)
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
    <div className="studio">
      <h1 className="studio-title">Homegrown</h1>

      <main className="workspace">
        <div className="composer">
          {/* Pairs with the Voiceovers heading opposite, same .section-rule
              treatment: you write a script here, the voiceovers appear there.
              "Script" rather than "Compose" or "New voiceover" because it is
              the word the terminology table fixes for the text the user
              writes. */}
          <h2 className="section-rule">
            <span>Script</span>
          </h2>

          {/* No "Ready" indicator: GenerateButton already says what is missing
              ("Waiting for the voice model") whenever the model is not up.
              The DOWN state is different -- it is the only state the user can
              act on, and Retry is the app's only recovery control, so it moved
              here rather than disappearing with the header. */}
          {modelStatus === 'down' && (
            <p className="error status-down-row" role="alert">
              <span>{wakeMessage ?? 'Backend unreachable'}</span>
              <button type="button" className="ghost-btn" onClick={() => setWakeNonce((n) => n + 1)}>
                Retry
              </button>
            </p>
          )}

          {/* The startup wait used to be a greyed-out button and nothing else,
              while wakeMessage's elapsed counter was computed every poll and
              rendered nowhere -- it only ever appeared in the DOWN row above.
              `boot` adds the phase on top when a dev server is serving it; the
              elapsed seconds carry the row on their own when it isn't. */}
          {modelStatus === 'checking' && (
            <section className="notice boot-row" role="status" aria-live="polite">
              <div className="boot-line">
                <span className="boot-phase">
                  {boot ? bootWord(boot.phase) : 'Waking up'}
                </span>
                {wakeMessage && <span className="mono boot-elapsed">{wakeMessage}</span>}
              </div>
              <p className="boot-tagline">
                {boot ? bootTagline(boot.phase) : 'Homegrown is starting.'}
              </p>
              {/* Its own slot, not appended to the prose above. The launcher
                  learned this one the hard way: letting the backend's `detail`
                  replace the copy meant the whole screen read
                  "0.0 GB of 2.5 GB" and the one reassuring sentence vanished
                  exactly when it was needed. */}
              {boot?.detail && <p className="mono boot-detail">{boot.detail}</p>}
              <div
                className={`boot-bar${boot?.percent == null ? ' is-indeterminate' : ''}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={boot?.percent ?? undefined}
              >
                <div
                  className="boot-bar-fill"
                  style={boot?.percent == null ? undefined : { width: `${boot.percent}%` }}
                />
              </div>
            </section>
          )}

          {cpuNotice && (
            <p className="notice">Running on CPU — generation will be very slow. {cpuNotice}</p>
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
          {estimate?.warning && <p className="notice">{estimate.warning}</p>}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {/* One action row under the script: add-voice, voice, generate.
              The voice picker sits here rather than inside the card, so the
              script box stays the script box.
              GenerateButton stays a button throughout -- progress now lives in
              the Voiceovers column, as the first row, where the finished
              voiceover will land. */}
          <section className="compose-bar">
            <button
              type="button"
              className="icon-btn compose-add"
              aria-label="Add a voice"
              title="Add a voice"
              onClick={() => setVoicesOpen(true)}
            >
              <PlusIcon size={15} />
            </button>

            <VoicePicker
              presets={presets}
              selectedPresetId={voiceId}
              onSelect={setVoiceId}
              loading={modelStatus === 'checking'}
            />

            <GenerateButton
              disabled={!canGenerate}
              blockedReason={blockedReason}
              busy={submitting}
              warming={warmingUp}
              count={scriptReady ? 1 : 0}
              onClick={handleGenerate}
            />
          </section>

        </div>

        <aside className="aside" ref={resultsRef}>
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
            loading={modelStatus === 'checking'}
          />
        </aside>
      </main>

      <NewVoiceModal
        open={voicesOpen}
        onClose={() => setVoicesOpen(false)}
        presets={presets}
        name={newPresetName}
        onNameChange={setNewPresetName}
        file={refFile}
        onFileSelected={handleRefFileSelected}
        language={newPresetLanguage}
        onLanguageChange={setNewPresetLanguage}
        languages={languages}
        creating={creatingPreset}
        onCreate={handleCreatePreset}
        onDelete={handleDeletePreset}
      />

      {dragging && (
        <div className="drop-veil">
          <p>Drop a reference clip to make a voice</p>
        </div>
      )}
    </div>
  )
}
