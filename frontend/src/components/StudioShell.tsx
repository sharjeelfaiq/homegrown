import { useCallback, useEffect, useRef, useState } from 'react'
import '../App.css'
import NewVoiceModal from './NewVoiceModal'
import VoicePicker from './VoicePicker'
import ScriptBlock from './ScriptBlock'
import HistoryList from './HistoryList'
import GenerateButton from './GenerateButton'
import { MAX_SCRIPT_CHARS } from '../constants'
import { useGenerationActivity } from '../GenerationActivityContext'
import { useFileDrop } from '../hooks/useFileDrop'
import { useHotkeys } from '../hooks/useHotkeys'
import { wakeBackend } from '../wake'
import {
  ApiError,
  HISTORY_PAGE_SIZE,
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
  const [language, setLanguage] = useState('English')

  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [historyNonce, setHistoryNonce] = useState(0)
  const [pendingNew, setPendingNew] = useState(0)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasRendered, setHasRendered] = useState(false)
  const [estimate, setEstimate] = useState<Estimate | null>(null)

  const { queue, refresh: refreshQueue } = useGenerationActivity()
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
    setModelStatus('checking')
    setWakeMessage(null)
    wakeBackend((status, elapsedMs) => {
      if (cancelled || status !== 'starting') return
      setModelStatus('checking')
      setWakeMessage(`Loading the voice model… ${Math.round(elapsedMs / 1000)}s`)
    })
      .then(() => {
        if (cancelled) return
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
        if (cancelled) return
        setModelStatus('down')
        setWakeMessage(e instanceof Error ? e.message : 'Backend unreachable.')
      })
    return () => {
      cancelled = true
    }
  }, [wakeNonce, refreshHistory])

  // Single place that loads a page of voiceovers. Re-runs on page change and on any
  // explicit refresh (job finished, entry deleted).
  useEffect(() => {
    let cancelled = false
    listHistory(HISTORY_PAGE_SIZE, page * HISTORY_PAGE_SIZE)
      .then((r) => {
        if (cancelled) return
        setHistory(r.history)
        setHistoryTotal(r.total)
        // Deleting the last row of the last page leaves this page empty while
        // earlier pages still have content -- step back rather than showing a
        // blank list under a paginator that says "3 / 2".
        const lastPage = Math.max(0, Math.ceil(r.total / HISTORY_PAGE_SIZE) - 1)
        if (page > lastPage) setPage(lastPage)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [page, historyNonce])

  // A finished job must not yank a user off the page they are reading. On page
  // 0 the new voiceover belongs at the top, so refresh in place; deeper in, count it
  // and let them choose when to jump.
  const doneCount = queue.filter((e) => e.status === 'done').length
  const lastDoneCount = useRef(doneCount)
  useEffect(() => {
    if (doneCount <= lastDoneCount.current) {
      lastDoneCount.current = doneCount
      return
    }
    const added = doneCount - lastDoneCount.current
    lastDoneCount.current = doneCount
    // The first render after the backend boots also captures CUDA graphs, so it
    // runs well slower than the history-seeded estimate. Once anything has
    // finished, the estimate is trustworthy again and the caveat comes off.
    setHasRendered(true)
    if (page === 0) refreshHistory()
    else setPendingNew((n) => n + added)
  }, [doneCount, page, refreshHistory])

  // Navigating back to the newest page by any route means the "new voiceovers"
  // badge has served its purpose -- otherwise it lingers over content the user
  // is already looking at.
  useEffect(() => {
    if (page === 0) setPendingNew(0)
  }, [page])

  function showNewVoiceovers() {
    setPendingNew(0)
    if (page === 0) refreshHistory()
    else setPage(0)
  }

  // Dropping an audio file anywhere opens the voices modal with it loaded.
  const dragging = useFileDrop((file) => {
    setRefFile(file)
    setVoicesOpen(true)
    if (!newPresetName) {
      setNewPresetName(file.name.replace(/\.[^.]+$/, '').slice(0, 40))
    }
  })

  async function handleCreatePreset() {
    if (!refFile) return
    setCreatingPreset(true)
    setError(null)
    try {
      const preset = await createPreset(newPresetName, refFile, '', language, '')
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

  function handleRequeue(entry: HistoryEntry) {
    setScript(entry.text)
    setVoiceId(entry.preset_id)
    setLanguage(entry.language)
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
      await startGenerate({ presetId: voiceId as string, text: script, language })
      setScript('')
      refreshQueue()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  const canGenerate = modelStatus === 'ready' && scriptReady && !submitting && !warmingUp

  // Say what is missing rather than presenting a mute grey slab.
  const blockedReason =
    canGenerate || submitting || warmingUp
      ? null
      : modelStatus !== 'ready'
        ? 'Waiting for the voice model'
        : presets.length === 0
          ? 'Add a voice first'
          : voiceId == null
            ? 'Pick a voice'
            : script.trim().length === 0
              ? 'Write a script'
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
    // transport stays encapsulated where it belongs.
    onPlayPause: () => {
      resultsRef.current?.querySelector<HTMLButtonElement>('.voiceover-play-btn')?.click()
    },
  })

  const statusText =
    modelStatus === 'ready'
      ? 'Ready'
      : modelStatus === 'checking'
        ? (wakeMessage ?? 'Loading model…')
        : (wakeMessage ?? 'Backend unreachable')

  return (
    <div className="studio">
      <header className="studio-header">
        <h1 className="wordmark">Voice Clone Studio</h1>
        <div className="status-group">
          <span className={`status status-${modelStatus}`}>
            <span className="status-dot" />
            {statusText}
          </span>
          {modelStatus === 'down' && (
            <button type="button" className="ghost-btn" onClick={() => setWakeNonce((n) => n + 1)}>
              Retry
            </button>
          )}
        </div>
      </header>

      <main className="workspace">
        <div className="composer">
          {cpuNotice && (
            <p className="notice">Running on CPU — generation will be very slow. {cpuNotice}</p>
          )}

          {/* One row, not two stacked label/field pairs. The old layout left a
              ragged right edge -- the language select stretched the full width
              while the voice select stopped short to share its row. */}
          <section className="toolbar">
            <VoicePicker presets={presets} selectedPresetId={voiceId} onSelect={setVoiceId} />

            <select
              className="select select-language"
              aria-label="Language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {(languages.length ? languages : [language]).map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>

            <button type="button" className="ghost-btn" onClick={() => setVoicesOpen(true)}>
              + New voice
            </button>
          </section>

          <ScriptBlock
            text={script}
            onTextChange={setScript}
            textareaRef={scriptRef}
            presetId={voiceId}
            firstRun={!hasRendered}
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

          <GenerateButton
            disabled={!canGenerate}
            blockedReason={blockedReason}
            busy={submitting}
            warming={warmingUp}
            count={scriptReady ? 1 : 0}
            onClick={handleGenerate}
          />

          <footer className="shortcuts mono">
            <span>
              <kbd>Ctrl ↵</kbd> generate
            </span>
            <span>
              <kbd>Space</kbd> play latest
            </span>
            <span>
              <kbd>/</kbd> jump to script
            </span>
          </footer>
        </div>

        <aside className="aside" ref={resultsRef}>
          <HistoryList
            history={history}
            total={historyTotal}
            page={page}
            pageSize={HISTORY_PAGE_SIZE}
            onPageChange={setPage}
            pendingNew={pendingNew}
            onShowNew={showNewVoiceovers}
            onDelete={handleDeleteHistory}
            onRequeue={handleRequeue}
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
        onFileSelected={setRefFile}
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
