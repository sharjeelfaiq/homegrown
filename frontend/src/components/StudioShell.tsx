import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import NewVoiceModal from './NewVoiceModal'
import ThemeSwitch from './ThemeSwitch'
import HistoryDisplaySettings from './HistoryDisplaySettings'
import ParticleText from './ParticleText'
import VoicePicker from './VoicePicker'
import ScriptBlock from './ScriptBlock'
import HistoryList from './HistoryList'
import { restoreVoiceoverFilters, type VoiceoverFilterState } from './VoiceoverFilters'
import GenerateButton from './GenerateButton'
import { MAX_SCRIPT_CHARS, UNDO_MS } from '../constants'
import { presetNameFromFile } from '../format'
import { AlertIcon, CheckIcon, PlusIcon, TrashIcon } from './Icons'
import { Toaster, toast } from 'sonner'
import { useGenerationActivity } from '../GenerationActivityContext'
import { useJobToasts } from '../hooks/useJobToasts'
import { usePersistedDraft } from '../hooks/usePersistedDraft'
import { useErrorToast } from '../hooks/useErrorToast'
import Kbd from './Kbd'
import { useTheme } from '../ThemeContext'
import { themeMode } from '../theme'
import { readHistoryDisplayMode, writeHistoryDisplayMode, type HistoryDisplayMode } from '../historyDisplay'
import { useBootStatus } from '../hooks/useBootStatus'
import { useFileDrop } from '../hooks/useFileDrop'
import { useFlushOnHide } from '../hooks/useFlushOnHide'
import { useHotkeys } from '../hooks/useHotkeys'
import { wakeBackend } from '../wake'
import BootOverlay from './BootOverlay'
import Modal from './Modal'
import UndoCountdown from './UndoCountdown'
import CursorGrid from './CursorGrid'
import {
  ApiError,
  HISTORY_INITIAL_COUNT,
  HISTORY_LOAD_MORE_COUNT,
  createPreset,
  deleteHistoryEntry,
  deletePreset,
  getHealth,
  getQueueScript,
  listHistory,
  listPresets,
  renamePreset,
  startGenerate,
  type Estimate,
  type HistoryEntry,
  type HistoryFilters,
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
  // Persisted, not plain useState. This is the only place in the app where
  // real work lived in memory and nowhere else -- a reload, a crash or a
  // closed tab discarded up to MAX_SCRIPT_CHARS with no recovery and no
  // warning. Restoring it also removes the need for a beforeunload prompt:
  // there is nothing left to lose by leaving, so the browser's generic
  // "Leave site?" dialog would be noise guarding something already safe.
  const [script, setScript] = usePersistedDraft('homegrown-script-draft')
  // Only the new-voice form writes this now: it is the language stamped onto a
  // voice at creation. Generation reads the chosen voice's own language instead
  // (see handleGenerate), so the two can no longer disagree.

  // One accumulating list, not a page. `historyNonce` reloads it from the top,
  // keeping however many slices are already on screen.
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyNonce, setHistoryNonce] = useState(0)
  const [historyFilters, setHistoryFilters] = useState<VoiceoverFilterState>(restoreVoiceoverFilters)
  // Not the query text -- just whether one is running. Filtering is
  // client-side (HistoryList searches names the server has never seen), so
  // all this has to do is make sure the whole history is loaded while a
  // search is on.
  const [searchActive, setSearchActive] = useState(false)
  const [historyDisplayMode, setHistoryDisplayMode] = useState<HistoryDisplayMode>(readHistoryDisplayMode)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [pendingNew, setPendingNew] = useState(0)
  // Refs, not state: read inside callbacks that must not be rebuilt (and so
  // must not re-arm the IntersectionObserver) every time they change.
  const loadedRef = useRef(0)
  const totalRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const atTopRef = useRef(true)
  const serverFilters = useMemo<HistoryFilters>(() => ({
    presetId: historyFilters.presetId, createdFrom: historyFilters.createdFrom,
    createdTo: historyFilters.createdTo, durationMin: historyFilters.durationMin,
    durationMax: historyFilters.durationMax,
  }), [historyFilters])
  const showingHistory = historyFilters.status === 'all' || historyFilters.status === 'completed'

  useEffect(() => {
    try { localStorage.setItem('voiceoverFilters.v1', JSON.stringify(historyFilters)) } catch { /* storage is optional */ }
  }, [historyFilters])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<Estimate | null>(null)

  const { queue, refresh: refreshQueue, reachable } = useGenerationActivity()
  useJobToasts(queue)
  // Both error STATES are mirrored to toasts rather than rendered inline.
  // voiceError used to draw a banner inside the voices dialog, which grew
  // the panel and undid the fixed-height window; sonner sits at z-index
  // 999999999, well above the modal's z-200, so it is visible over the
  // dialog without being laid out inside it.
  useErrorToast(error, 'Something went wrong')
  useErrorToast(voiceError, 'Could not add that voice')
  const { theme } = useTheme()
  // Only while we are actually waiting. Null whenever there is no dev-server
  // status source, which is every non-`vite dev` build -- the row below then
  // falls back to wakeMessage's elapsed counter alone.
  const boot = useBootStatus(modelStatus === 'checking')
  // Set when boot_status reports a failed model load, so the in-flight
  // wakeBackend poll can be ignored rather than cancelled -- see the effect
  // below for why waiting it out is not an option.
  const bootFailedRef = useRef(false)
  const scriptRef = useRef<HTMLTextAreaElement>(null)
  // Held here rather than in HistoryList because the Ctrl+F binding lives
  // here, the same way scriptRef serves "/".
  const searchRef = useRef<HTMLInputElement>(null)

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
  //
  // WHILE A SEARCH IS RUNNING, PULL EVERYTHING. Filtering happens on the
  // client, so anything not fetched cannot match -- a search over the first
  // 20 rows of a 200-row history would silently look like the rest do not
  // exist. totalRef is the count the last response reported; on the very
  // first load it is 0 and the normal page size applies, and the search can
  // only start after that has returned anyway.
  useEffect(() => {
    let cancelled = false
    if (!showingHistory) {
      setHistory([])
      setHistoryTotal(0)
      setHistoryLoading(false)
      loadedRef.current = 0
      totalRef.current = 0
      return
    }
    if (historyDisplayMode === 'paginated') {
      setHistoryLoading(true)
      void (async () => {
        const entries: HistoryEntry[] = []
        let offset = 0
        let total = 0
        while (!cancelled) {
          const page = await listHistory(100, offset, serverFilters)
          total = page.total
          const known = new Set(entries.map((entry) => entry.id))
          entries.push(...page.history.filter((entry) => !known.has(entry.id)))
          offset += page.history.length
          if (page.history.length === 0 || entries.length >= total) break
        }
        if (cancelled) return
        setHistory(entries)
        setHistoryTotal(total)
        loadedRef.current = entries.length
        totalRef.current = total
      })().catch(() => {}).finally(() => { if (!cancelled) setHistoryLoading(false) })
      return () => { cancelled = true }
    }
    setHistoryLoading(true)
    const want = searchActive
      ? Math.max(HISTORY_INITIAL_COUNT, totalRef.current)
      : Math.max(HISTORY_INITIAL_COUNT, loadedRef.current)
    listHistory(want, 0, serverFilters)
      .then((r) => {
        if (cancelled) return
        setHistory(r.history)
        setHistoryTotal(r.total)
        loadedRef.current = r.history.length
        totalRef.current = r.total
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    return () => {
      cancelled = true
    }
  }, [historyNonce, historyDisplayMode, searchActive, serverFilters, showingHistory])

  // Append the next slice. Stable identity on purpose -- HistoryList uses it as
  // an effect dependency to arm its observer.
  const loadMoreHistory = useCallback(() => {
    if (loadingMoreRef.current || loadedRef.current >= totalRef.current) return
    loadingMoreRef.current = true
    listHistory(HISTORY_LOAD_MORE_COUNT, loadedRef.current, serverFilters)
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
  }, [serverFilters])

  // A finished job must not scroll the list out from under a reader. At the top
  // the new voiceover belongs there anyway, so refresh in place; scrolled down,
  // count it and let them choose when to jump. atTopRef, not state, so this
  // effect does not re-run on every scroll event.
  // A backend that stops answering is reported through the SAME 'down' state a
  // failed boot uses, so the existing banner and its Retry do the work -- Retry
  // already bumps wakeNonce, which re-runs the health check and recovers.
  //
  // Only downward. Coming back is the health check's job, not the queue
  // poller's: /api/queue answering again does not mean the model reloaded, and
  // flipping to 'ready' here would clear the banner while generation is still
  // impossible.
  useEffect(() => {
    if (!reachable) setModelStatus('down')
  }, [reachable])

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

  async function handleRenamePreset(id: string, name: string, opts?: { unloading?: boolean }) {
    const trimmedName = name.trim()
    if (!trimmedName) return

    // The page is going away mid-edit. Send the rename with keepalive so the
    // request outlives the document -- a plain fetch here is cancelled -- and
    // skip everything else: there is no point rolling back state that is about
    // to be discarded, and a toast on a page that is unloading is never seen.
    if (opts?.unloading) {
      void renamePreset(id, trimmedName, { keepalive: true }).catch(() => {})
      return
    }

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

  /** Held voice deletes, by preset id: the pending timer and the closure that
   *  settles it on unload. A ref rather than state -- nothing renders from it,
   *  and a re-render must not restart a running undo window. */
  const voiceDeletes = useRef<Map<string, { timer: number; flush: () => void }>>(new Map())

  /** Deleting a voice is DEFERRED behind an Undo toast, the same shape as a
   *  voiceover delete in HistoryList -- and for the same reason: the server
   *  route is irreversible. DELETE /api/presets/{id} rewrites presets.json and
   *  unlinks the reference clip, so there is nothing to restore afterwards. A
   *  real server-side undo would need a deleted_at flag, a restore route and a
   *  way to un-unlink a file, which is a lot for a single-user local tool.
   *
   *  The voice is hidden immediately and the request held for UNDO_MS. The
   *  two-step confirm in the dialog STAYS: unlike a plain yes/no it carries the
   *  "In use -- queued voiceovers will fail" warning, which is information at
   *  decision time rather than friction.
   *
   *  Failure mode, stated so it is not later filed as a bug: close the tab
   *  inside the undo window and the flush below is what sends the DELETE. It
   *  needs keepalive, because an ordinary fetch started during unload is
   *  cancelled with the document -- without it the voice returns on reload.
   *  Safe direction, real inconsistency. */
  function handleDeletePreset(id: string) {
    const doomed = presets.find((p) => p.id === id)
    if (!doomed) return
    const index = presets.findIndex((p) => p.id === id)
    // Captured before the optimistic hide, or the restore below cannot tell
    // "this voice was selected" from "nothing was selected".
    const wasSelected = voiceId === id

    setPresets((prev) => prev.filter((p) => p.id !== id))
    setVoiceId((current) => (current === id ? null : current))

    const settle = async (commit: boolean, unloading = false) => {
      const held = voiceDeletes.current.get(id)
      if (held === undefined) return // already settled by the other path
      window.clearTimeout(held.timer)
      voiceDeletes.current.delete(id)
      if (!commit) {
        // Back at its original position: presets render in list order and a
        // voice reappearing at the bottom reads as a different voice.
        setPresets((prev) => {
          if (prev.some((p) => p.id === id)) return prev
          const next = [...prev]
          next.splice(Math.min(index, next.length), 0, doomed)
          return next
        })
        if (wasSelected) setVoiceId(id)
        return
      }
      if (unloading) {
        void deletePreset(id, { keepalive: true }).catch(() => {})
        return
      }
      try {
        await deletePreset(id)
      } catch (e) {
        // The delete never happened, so put the voice back rather than leaving
        // the list disagreeing with the server.
        setPresets((prev) =>
          prev.some((p) => p.id === id)
            ? prev
            : [...prev.slice(0, index), doomed, ...prev.slice(index)],
        )
        setError(e instanceof ApiError ? e.message : 'Failed to delete voice')
      }
    }

    voiceDeletes.current.set(id, {
      timer: window.setTimeout(() => void settle(true), UNDO_MS),
      flush: () => void settle(true, true),
    })
    toast(`${doomed.name} deleted`, {
      duration: UNDO_MS,
      icon: <TrashIcon size={15} />,
      action: {
        label: (
          <span className="inline-flex items-center gap-1.5">
            Undo
            <UndoCountdown ms={UNDO_MS} />
          </span>
        ),
        onClick: () => void settle(false),
      },
    })
  }

  // Settle any held voice delete on the way out. Idempotent by construction:
  // settle() returns early once its timer has been cleared, so pagehide and
  // visibilitychange both firing costs nothing.
  useFlushOnHide(() => {
    for (const held of [...voiceDeletes.current.values()]) held.flush()
  })

  async function handleDeleteHistory(id: string, opts?: { unloading?: boolean }) {
    // The page is going away with a delete still held behind its Undo window.
    // keepalive so the request outlives the document -- a plain fetch here is
    // cancelled and the voiceover comes back on the next load -- and skip the
    // refresh and the error toast, both of which are pointless on a page that
    // is leaving.
    if (opts?.unloading) {
      void deleteHistoryEntry(id, { keepalive: true }).catch(() => {})
      return
    }
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
  function reuseScript(text: string, presetId: string) {
    // The wand replaces the script box wholesale, which silently threw away
    // anything typed there. Offered as an undo rather than a confirm: a
    // confirm taxes every re-queue to protect the rare one, and window.confirm
    // blocks the page and looks nothing like the rest of the app -- the same
    // reasoning that made voice deletion an inline two-step.
    const previous = script
    const replacing = previous.trim() !== '' && previous !== text
    setScript(text)
    setVoiceId(presetId)
    scriptRef.current?.focus()
    if (!replacing) {
      toast('Script ready to reuse')
      return
    }
    toast('Script replaced', {
      description: 'The script you had written was swapped out.',
      action: { label: 'Undo', onClick: () => setScript(previous) },
    })
  }

  function handleRequeue(entry: HistoryEntry) {
    reuseScript(entry.text, entry.preset_id)
  }

  async function handlePendingScriptReuse(jobId: string) {
    try {
      // Do not touch the composer until the authenticated request succeeds:
      // a job might have disappeared or belong to somebody else by click time.
      const pendingScript = await getQueueScript(jobId)
      reuseScript(pendingScript.text, pendingScript.preset_id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load pending script')
    }
  }

  // An id can outlive its voice when it was deleted elsewhere or between
  // refreshes. Only a currently available preset is valid for generation.
  const selectedVoice = voiceId == null ? null : presets.find((p) => p.id === voiceId) ?? null
  const scriptReady =
    script.trim().length > 0 && script.length <= MAX_SCRIPT_CHARS && selectedVoice != null

  async function handleGenerate() {
    if (!scriptReady || selectedVoice == null) {
      setError(
        presets.length === 0
          ? 'Add a voice first — drop a reference clip anywhere on this page.'
          : selectedVoice == null
            ? 'Pick a voice before generating.'
            : 'Write a script before generating.',
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
      // `scriptReady` above proves this is a current preset, rather than just
      // a stale id that would surface the backend's internal preset error.
      await startGenerate({ presetId: selectedVoice.id, text: script, language: selectedVoice.language })
      setScript('')
      refreshQueue()
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.message.includes('Unknown preset_id') || e.message.includes('Selected voice is unavailable'))
      ) {
        setVoiceId(null)
        refreshPresets()
        setError('The selected voice is no longer available. Pick a voice before generating.')
      } else {
        setError(e instanceof ApiError ? e.message : 'Failed to submit')
      }
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
          : selectedVoice == null
            ? 'Pick a voice'
            : script.length > MAX_SCRIPT_CHARS
              ? 'Script is too long'
              : null

  useHotkeys({
    onGenerate: () => {
      if (canGenerate) handleGenerate()
    },
    onFocusScript: () => scriptRef.current?.focus(),
    // Reports whether it took the key. The search box is only rendered when
    // there is something to search, so with an empty column this returns
    // false and the browser's own find opens instead of being swallowed.
    onFindInApp: () => {
      const el = searchRef.current
      if (!el) return false
      el.focus()
      // Ctrl+F on a box that already has a query should let you retype rather
      // than append to it.
      el.select()
      return true
    },
    onCancel: () => setError(null),
  })

  return (
    <div className="flex min-h-svh flex-col wide:h-svh wide:overflow-hidden">
      {/* First child, and the shell root must stay transform-free: a transform
          here would become the containing block for this fixed element and
          create a stacking context around it -- the same pair of effects that
          once let the search field paint over ThemeSwitch's open menu. */}
      <CursorGrid
        color="var(--accent)"
        cellSize={70}
        radius={140}
        falloff="smooth"
        holdTime={400}
        fadeDuration={800}
        lineWidth={1.2}
        maxOpacity={0.68}
        fillOpacity={0.035}
        gridOpacity={0.055}
        cellRadius={0}
        clickPulse
        pulseSpeed={600}
      />
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
        {/* text-accent, not text-muted. --accent is the theme's IDENTITY colour
            now that --progress carries the "working" state, and the wordmark is
            the one surface every theme shows on every screen -- so it is where
            identity earns its keep. Large text, so the 3:1 non-text bar applies
            rather than 4.5:1; check_palette.py holds every theme's accent above
            that against all three surfaces. */}
        <h1 className="px-(--gutter) py-[25px] text-center leading-none">
          <ParticleText
            text="HOMEGROWN"
            trigger="hover"
            fontSize="clamp(1.7rem, 5vw, 2.2rem)"
            fontWeight={600}
            fontFamily="var(--font-display)"
            particleColor="var(--accent)"
            highlightColor="var(--accent-2-bright)"
            particleSize={1.2}
            density={3}
            scatter={14}
            gatherDuration={320}
          />
        </h1>
        <div className="absolute inset-y-0 right-(--gutter) z-150 flex items-center gap-1">
          <HistoryDisplaySettings mode={historyDisplayMode} onChange={(mode) => { setHistoryDisplayMode(mode); writeHistoryDisplayMode(mode) }} />
          <ThemeSwitch />
        </div>
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
            {/* order-3 puts it past the ::after hairline, i.e. hard right --
                the same trick the Voiceovers heading uses for its count, so
                the two columns' headings stay symmetrical.

                Here rather than inside the script box, which is where it
                started: an absolutely-positioned cap in the box's top-right
                overlapped the first line of text on both axes (cap 11-29px,
                line one 15-40.5px, and a long line runs under it horizontally
                too). The bottom corners were already taken by the word count,
                the resize grip and the scrollbar. */}
            <Kbd className="order-3">/</Kbd>
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



          {/* Above the script box, right-aligned, rather than beside Generate.
              Not folded into the Script heading: that line already carries the
              label, its ::after hairline and the "/" key cap at order-3, and a
              32px dropdown would regrow a ~17px heading -- the mistake the bulk
              bar made. */}
          <div className="-mb-3 flex min-w-0 items-center justify-end gap-2">
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

          {/* One action row under the script: add-voice, voice, generate.
              The voice picker sits here rather than inside the card, so the
              script box stays the script box.
              GenerateButton stays a button throughout -- progress now lives in
              the Voiceovers column, as the first row, where the finished
              voiceover will land. */}
          {/* No duration estimate beside Generate or in a running row. A number
              quoted before submission reads as a promise, and measured elapsed
              time plus chunk progress are more honest. /api/estimate remains
              on the 400ms debounce solely for exact chunking and the
              long-reference-clip warning rendered above. */}
          <section className="compose-bar flex flex-wrap items-center gap-2">
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

        <aside className="min-w-0 wide:h-full wide:min-h-0">
          <HistoryList
            history={history}
            presets={presets}
            filters={historyFilters}
            onFiltersChange={setHistoryFilters}
            searchRef={searchRef}
            onSearchActiveChange={setSearchActive}
            total={historyTotal}
            hasMore={history.length < historyTotal}
            onLoadMore={loadMoreHistory}
            pendingNew={pendingNew}
            onShowNew={showNewVoiceovers}
            onAtTopChange={handleAtTopChange}
            onDelete={handleDeleteHistory}
            onRequeue={handleRequeue}
            onReusePendingScript={handlePendingScriptReuse}
            onError={setError}
            gpuFault={gpuFault != null}
            loading={modelStatus === 'checking' || historyLoading}
            displayMode={historyDisplayMode}
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
        onRename={handleRenamePreset}
        onDelete={handleDeletePreset}
      />

      {/* Everything else on the page is inert until the model is up, so the
          startup screen covers it rather than sitting above the script box.
          Dropped the instant modelStatus leaves 'checking' -- including on
          failure, so the error row below is never trapped behind it. */}
      {modelStatus === 'checking' && <BootOverlay boot={boot} elapsed={wakeMessage} />}

      {/* Toasts. `theme` comes from OUR nine-theme id, not sonner's default
          "light": six of the nine are dark, and a light toast stack over Booth
          is the brightest thing on the screen. themeMode() is the same mapping
          the pre-paint script in index.html uses, so the two cannot disagree.

          `unstyled` drops sonner's OWN appearance styles, which is what lets
          these be built from the app's utilities and tokens like every other
          surface. This replaced a block of CSS variables that existed purely to
          avoid a specificity fight with sonner's stylesheet -- with the
          stylesheet out of the picture, classNames are simply the right tool.

          It costs less than it sounds: sonner gates its APPEARANCE on
          [data-styled='true'], but none of its animation or stacking rules
          require that attribute. Enter/exit transforms, stacking, swipe to
          dismiss and height transitions all still work.

          richColors is deliberately OFF. It ships its own green and red, which
          would be the only two colours in the app that check_design_tokens.py
          cannot see and therefore the only two that could drift from the
          palette unnoticed. Type is carried by the ICON instead -- and only by
          the icon, because a tinted border makes a routine success look like a
          warning.

          closeButton is off HERE and switched on per-toast for the two that use
          duration: Infinity (useErrorToast, and the failure toast in
          useJobToasts). Everything else dismisses itself, and the undo toasts
          have an action that is the entire point of them; a second dismiss
          control beside Undo is noise. Sonner's default also hangs it 6px
          outside the top-LEFT corner, measured. */}
      <Toaster
        theme={themeMode(theme)}
        position="bottom-right"
        gap={10}
        icons={{
          success: <CheckIcon size={15} />,
          error: <AlertIcon size={15} />,
        }}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              'flex w-full items-start gap-2.5 rounded-md border border-control bg-surface-card px-3.5 py-3 text-[13px] leading-[1.45] text-ink shadow-(--shadow-menu)',
            content: 'flex min-w-0 flex-1 flex-col gap-0.5',
            title: 'text-[13px] font-medium text-ink',
            // text-muted! -- the important modifier is load-bearing, and this is
            // the one place `unstyled` does NOT win outright. Sonner gates its
            // appearance on [data-styled='true'], but
            // `[data-sonner-toaster][data-sonner-theme='dark'] [data-description]`
            // carries no such gate, and at three attribute selectors it beats a
            // single utility class. Measured before this: the description came
            // out rgb(232,232,232) at 13.4:1 -- brighter than the muted tone it
            // was meant to be, so the title lost its lead.
            description: 'text-[12px] leading-[1.45] text-muted!',
            // mt-px nudges the icon onto the title's optical baseline; the cap
            // height of 13px text does not start at the top of its line box.
            icon: 'mt-px flex size-[15px] flex-none items-center justify-center',
            success: '[&_[data-icon]]:text-green',
            error: '[&_[data-icon]]:text-danger',
            actionButton: 'ghost-btn ml-2 h-7 flex-none px-2.5 text-[12px]',
            closeButton: 'icon-btn ml-1 flex-none self-start',
          },
        }}
      />

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
