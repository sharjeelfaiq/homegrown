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
  // Only the new-voice form writes this now: it is the language stamped onto a
  // voice at creation. Generation reads the chosen voice's own language instead
  // (see handleGenerate), so the two can no longer disagree.
  const [newPresetLanguage, setNewPresetLanguage] = useState('English')

  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [historyNonce, setHistoryNonce] = useState(0)
  const [pendingNew, setPendingNew] = useState(0)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
