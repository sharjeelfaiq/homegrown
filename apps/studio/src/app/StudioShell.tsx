import { useCallback, useEffect, useRef, useState } from 'react'
import SettingsModal from '../features/settings/SettingsModal'
import ParticleText from '../components/effects/ParticleText'
import ScriptBlock from '../features/generation/ScriptBlock'
import ClonedVoicesSection from '../features/voices/ClonedVoicesSection'
import HistoryList from '../features/history/HistoryList'
import { restoreVoiceoverFilters, type VoiceoverFilterState } from '../features/history/VoiceoverFilters'
import GenerateButton from '../features/generation/GenerateButton'
import MascotPicker from '../features/mascots/MascotPicker'
import { MAX_SCRIPT_CHARS } from '../features/generation/constants'
import { presetNameFromFile } from '../lib/format'
import { CircleAlert as AlertIcon, Check as CheckIcon, CircleHelp as HelpIcon, Settings as SettingsIcon } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { useGenerationActivity } from '../features/generation/GenerationActivityContext'
import { useJobToasts } from '../features/generation/useJobToasts'
import { usePersistedDraft } from '../features/generation/usePersistedDraft'
import { useReuseVoiceover } from '../features/generation/useReuseVoiceover'
import { useErrorToast } from '../hooks/useErrorToast'
import { useTheme } from '../lib/theme/ThemeContext'
import { themeMode } from '../lib/theme/theme'
import { useBootStatus } from '../features/startup/useBootStatus'
import { useHotkeys } from '../hooks/useHotkeys'
import { wakeBackend } from '../features/startup/wake'
import Modal from '../components/ui/Modal'
import CursorGrid from '../components/effects/CursorGrid'
import BootOverlay from '../features/startup/BootOverlay'
import StatusMark from '../components/ui/StatusMark'
import { showUndoDeleteToast } from '../components/ui/UndoDeleteToast'
import { useOnboardingTour } from '../features/onboarding/useOnboardingTour'
import {
  ApiError,
  createPreset,
  deleteHistoryEntry,
  deletePreset,
  getHealth,
  getQueueScript,
  listLanguages,
  listPresets,
  renamePreset,
  startGenerate,
  type Estimate,
  type HistoryEntry,
  type HistoryPage,
  type Preset,
} from '../lib/api'
import { historyQueryClient, invalidateHistory } from '../features/history/historyQuery'
import { Skeleton } from 'boneyard-js/react'
import { StudioStartupFixture } from '../skeletons/BoneyardFixtures'
import { AppTooltip } from '../components/ui/Tooltip'

/** Sent only so the backend has something if language detection comes back
 * empty or names a language this model cannot speak. */
const LANGUAGE_FALLBACK = 'English'
const MODEL_LOADING_TOOLTIP = 'Voice model is loading — this can take up to 3 minutes.'
const MODEL_LOADING_TOAST_ID = 'voice-model-loading'

export default function StudioShell() {
  const voiceoversRef = useRef<HTMLElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mascotEnabled, setMascotEnabled] = useState(() => {
    try { return localStorage.getItem('homegrown-mascot-enabled') !== 'false' } catch { return true }
  })
  const setMascotPreference = useCallback((next: boolean) => {
    setMascotEnabled(next)
    try { localStorage.setItem('homegrown-mascot-enabled', String(next)) } catch { /* storage is optional */ }
  }, [])
  const [modelStatus, setModelStatus] = useState<'checking' | 'ready' | 'down'>('checking')
  const { startTour } = useOnboardingTour(modelStatus)
  const [wakeMessage, setWakeMessage] = useState<string | null>(null)
  const [wakeNonce, setWakeNonce] = useState(0)
  const [backendWarningOpen, setBackendWarningOpen] = useState(false)
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
  const voiceDeleteTimers = useRef(new Set<() => void>())
  useEffect(() => () => {
    for (const cancel of voiceDeleteTimers.current) cancel()
    voiceDeleteTimers.current.clear()
  }, [])
  const [voiceId, setVoiceId] = useState<string | null>(null)

  // Separate from the composer's `error` so upload failures can keep their
  // specific toast title.
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
  const [languageOverride, setLanguageOverride] = useState<string | null>(null)
  const [languages, setLanguages] = useState<string[]>([])
  const [historyFilters, setHistoryFilters] = useState<VoiceoverFilterState>(restoreVoiceoverFilters)
  const [pendingNew, setPendingNew] = useState(0)
  // A ref, not state: read inside a callback that must not be rebuilt on every
  // scroll event.
  const atTopRef = useRef(true)

  useEffect(() => {
    try { localStorage.setItem('voiceoverFilters.v1', JSON.stringify(historyFilters)) } catch { /* storage is optional */ }
  }, [historyFilters])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<Estimate | null>(null)

  const { queue, refresh: refreshQueue, reachable } = useGenerationActivity()
  useJobToasts(queue)
  // Both error states are mirrored to toasts rather than rendered inline.
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

  // Keep one persistent toast visible throughout the initial model load. Use
  // the same indeterminate StatusMark spinner shown by the voice-cloning toast.
  useEffect(() => {
    if (modelStatus === 'checking') {
      toast('Voice model is loading', {
        id: MODEL_LOADING_TOAST_ID,
        duration: Infinity,
        icon: <StatusMark status="running" size={18} strokeWidth={2.2} color="var(--progress)" strike={false} />,
      })
    } else {
      toast.dismiss(MODEL_LOADING_TOAST_ID)
    }
    return () => {
      toast.dismiss(MODEL_LOADING_TOAST_ID)
    }
  }, [modelStatus])

  const refreshHistory = useCallback(() => { void invalidateHistory() }, [])

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
        listLanguages()
          .then((result) => { if (!cancelled) setLanguages(result.languages) })
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

  // Both routes to a reference clip go through here -- the inline upload
  // button and a drop on the Voices card -- so the name gets pre-filled either way.
  //
  // A dropped clip IS the decision -- there is no Save step and no name to
  // fill in. The name comes off the filename and is editable in place on the
  // row this creates, which is the whole point of the dialog now.
  async function handleAddVoice(file: File): Promise<'done' | 'failed'> {
    // The Clone voice button is not the only route to this operation: a file
    // can also be dropped over the page. Keep that path behind the same model
    // readiness gate so it cannot bypass the disabled button during startup.
    if (modelStatus !== 'ready' || warmingUp) return 'failed'
    setVoiceError(null)
    // The queue owns per-file feedback and continues after a rejected request.
    // Language falls back to what faster-whisper detects in the recording.
    const preset = await createPreset(
      presetNameFromFile(file.name), file, '', LANGUAGE_FALLBACK,
    )
    setPresets((prev) => [preset, ...prev])
    setVoiceId(preset.id)
    return 'done'
  }

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

  /** Optimistically remove the voice and defer the server delete for Undo. */
  async function handleDeletePreset(id: string) {
    const doomed = presets.find((p) => p.id === id)
    if (!doomed) return
    const index = presets.findIndex((p) => p.id === id)
    // Captured before the optimistic hide, or the restore below cannot tell
    // "this voice was selected" from "nothing was selected".
    const wasSelected = voiceId === id

    setPresets((prev) => prev.filter((p) => p.id !== id))
    setVoiceId((current) => (current === id ? null : current))

    const restoreVoice = () => {
      setPresets((prev) => prev.some((p) => p.id === id)
        ? prev
        : [...prev.slice(0, Math.min(index, prev.length)), doomed, ...prev.slice(Math.min(index, prev.length))])
      if (wasSelected) setVoiceId(id)
    }
    const cancel = showUndoDeleteToast({
      label: doomed.name,
      onDelete: () => deletePreset(id).then(() => {}),
      onUndo: restoreVoice,
      onError: (e) => {
        restoreVoice()
        setError(e instanceof ApiError ? e.message : 'Failed to delete voice')
      },
      onSettled: () => voiceDeleteTimers.current.delete(cancel),
    })
    voiceDeleteTimers.current.add(cancel)
  }

  async function handleDeleteHistory(id: string) {
    const snapshots = historyQueryClient.getQueriesData<HistoryPage>({ queryKey: ['voiceover-history'] })
    historyQueryClient.setQueriesData<HistoryPage>({ queryKey: ['voiceover-history'] }, (page) => {
      if (!page || !page.history.some((entry) => entry.id === id)) return page
      return { history: page.history.filter((entry) => entry.id !== id), total: Math.max(0, page.total - 1) }
    })
    try {
      await deleteHistoryEntry(id)
      refreshHistory()
    } catch (e) {
      for (const [key, page] of snapshots) historyQueryClient.setQueryData(key, page)
      const message = e instanceof ApiError ? e.message : 'Failed to delete voiceover'
      setError(message)
      throw new Error(message)
    }
  }

  const reuseScript = useReuseVoiceover({
    script, voiceId, language: languageOverride, languages,
    setScript, setVoiceId, setLanguage: setLanguageOverride, textareaRef: scriptRef,
  })

  function handleRequeue(entry: HistoryEntry) {
    reuseScript(entry.text, entry.preset_id, entry.language)
  }

  async function handleReuseQueued(job: import('../lib/api').QueueEntry) {
    try {
      const script = await getQueueScript(job.job_id)
      reuseScript(script.text, script.preset_id, script.language)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load queued script')
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
          ? 'Add a voice first — drop a reference clip on the Voices card.'
          : selectedVoice == null
            ? 'Pick a voice before generating.'
            : 'Write a script before generating.',
      )
      return
    }
    if (languageOverride == null) {
      setError('Select a language before generating.')
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
      await startGenerate({
        presetId: selectedVoice.id,
        text: script,
        language: languageOverride,
      })
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

  // `wakeBackend` resolves only after /api/health confirms model_loaded. This
  // is the single readiness gate for every model-dependent Studio action.
  const modelReady = modelStatus === 'ready' && !warmingUp
  const modelLoading = !modelReady && modelStatus !== 'down'
  const canGenerate = modelReady && scriptReady && selectedVoice != null && languageOverride != null && !submitting

  // Say what is missing rather than presenting a mute grey slab -- but only
  // for prerequisites the user has to go and fix elsewhere. An empty script is
  // not one of those: the cursor is already in the box, so the button just
  // reads "Generate" and stays disabled.
  const blockedReason =
    canGenerate || submitting || !modelReady
      ? null
      : presets.length === 0
          ? 'Add a voice first'
          : selectedVoice == null
            ? 'Pick a voice'
            : languageOverride == null
              ? 'Select a language'
              : script.length > MAX_SCRIPT_CHARS
                ? 'Script is too long'
                : null

  useHotkeys({
    onGenerate: () => {
      if (canGenerate) handleGenerate()
    },
    onCancel: () => setError(null),
  })

  return (
    <Skeleton
      name="studio-startup"
      loading={modelStatus === 'checking'}
      fixture={<StudioStartupFixture />}
      select="viewport"
      snapshotConfig={{ excludeTags: ['svg', 'canvas'], excludeSelectors: ['[data-boneyard-decorative]'] }}
    >
      <div
        className="flex min-h-svh flex-col wide:h-svh wide:overflow-hidden"
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault()
        }}
        onDrop={(event) => {
          // Prevent the browser opening a dropped file outside the Voices card.
          // Cloning itself is handled only by ClonedVoicesSection.onDrop.
          if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault()
        }}
      >
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
        <div className="absolute inset-y-0 right-(--gutter) z-150 flex items-center gap-1" data-tour="header-controls">
          <AppTooltip content="Settings">
            <button
              type="button"
              className="icon-btn focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-audio"
              aria-label="Open settings"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon size={16} />
            </button>
          </AppTooltip>
          <AppTooltip content="Replay tour">
            <button
              type="button"
              className="icon-btn focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-audio"
              aria-label="Replay studio tour"
              onClick={() => startTour({ force: true })}
            >
              <HelpIcon size={16} />
            </button>
          </AppTooltip>
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
      <main className="studio-workspace mx-auto grid w-full max-w-(--shell) grid-cols-[minmax(0,1fr)] items-start gap-[34px] px-(--gutter) pt-8 pb-[72px] wide:min-h-0 wide:flex-auto wide:gap-10 wide:pb-8">
        <div className="composer flex w-full min-w-0 flex-col gap-[22px] wide:h-full wide:min-h-0">
          {/* The voice's own reference clip decides chunk size, so a long
              reference silently multiplies both chunk count and render time.
              The backend only logged this; now it reaches the person who can
              act on it. */}
          <ClonedVoicesSection
            presets={presets}
            selectedPresetId={voiceId}
            onSelect={setVoiceId}
            onRename={handleRenamePreset}
            loading={modelStatus === 'checking'}
            modelReady={modelReady}
            modelLoading={modelLoading}
            onAddVoice={handleAddVoice}
            onDelete={handleDeletePreset}
          />

          {/* GenerateButton stays a button throughout -- progress now lives in
              the Voiceovers column, as the first row, where the finished
              voiceover will land. */}
          {/* No duration estimate beside Generate or in a running row. A number
              quoted before submission reads as a promise, and measured elapsed
              time plus chunk progress are more honest. /api/estimate remains
              on the 400ms debounce solely for exact chunking and the
              long-reference-clip warning rendered above. */}
        </div>

        <aside ref={voiceoversRef} className="relative flex w-full min-w-0 flex-col gap-[22px] wide:h-full wide:min-h-0">
          {cpuNotice && <p className="m-0 rounded-sm border border-progress-line bg-progress-soft px-3 py-2.5 text-[13px] text-progress">Running on CPU — generation will be very slow. {cpuNotice}</p>}
          <ScriptBlock
            text={script}
            onTextChange={setScript}
            textareaRef={scriptRef}
            presetId={voiceId}
            onEstimate={setEstimate}
            languages={languages}
            language={languageOverride}
            onLanguageChange={setLanguageOverride}
            generateAction={<GenerateButton
              disabled={!canGenerate}
              blockedReason={blockedReason}
              tooltip={modelLoading ? MODEL_LOADING_TOOLTIP : modelStatus === 'down' ? 'The voice model is unavailable. Open the backend warning for details.' : undefined}
              busy={submitting}
              warming={warmingUp}
              onClick={handleGenerate}
            />}
          />
          {estimate?.warning && <p className="m-0 rounded-sm border border-progress-line bg-progress-soft px-3 py-2.5 text-[13px] text-progress">{estimate.warning}</p>}
          <HistoryList
            presets={presets}
            filters={historyFilters}
            onFiltersChange={setHistoryFilters}
            pendingNew={pendingNew}
            onShowNew={showNewVoiceovers}
            onAtTopChange={handleAtTopChange}
            onDelete={handleDeleteHistory}
            onRequeue={handleRequeue}
            onReuseQueue={(job) => void handleReuseQueued(job)}
            onError={setError}
            gpuFault={gpuFault != null}
          />
          {mascotEnabled && <MascotPicker anchorRef={voiceoversRef} />}
        </aside>
      </main>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        mascotEnabled={mascotEnabled}
        onMascotEnabledChange={setMascotPreference}
      />

      {modelStatus === 'down' && (
        <AppTooltip content="Backend warning. Open details and retry.">
          <button
            type="button"
            className="backend-warning-button animate-pulse-soft"
            aria-label="Backend warning. Open details and retry."
            onClick={() => setBackendWarningOpen(true)}
          >
            <AlertIcon size={23} />
          </button>
        </AppTooltip>
      )}

      <Modal
        open={backendWarningOpen && modelStatus === 'down'}
        title="Backend unavailable"
        onClose={() => setBackendWarningOpen(false)}
      >
        <p className="m-0 whitespace-pre-wrap text-[13px]/[1.55] text-muted" role="alert">
          {wakeMessage ?? 'Backend unreachable'}
        </p>
        <div className="flex justify-end gap-2.5">
          <button type="button" className="ghost-btn" onClick={() => setBackendWarningOpen(false)}>Close</button>
          <button type="button" className="ghost-btn" onClick={() => {
            setBackendWarningOpen(false)
            setWakeNonce((n) => n + 1)
          }}>Retry</button>
        </div>
      </Modal>

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
          useJobToasts). Everything else dismisses itself, so a second dismiss
          control would be noise. Sonner's default also hangs it 6px
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
              'flex w-full items-center gap-2.5 rounded-md border border-control bg-surface-card px-3.5 py-3 text-[13px] leading-[1.45] text-ink shadow-(--shadow-menu)',
            content: 'flex min-w-0 flex-1 flex-col justify-center gap-0.5',
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
            icon: 'flex size-[18px] flex-none items-center justify-center',
            success: '[&_[data-icon]]:text-green',
            error: '[&_[data-icon]]:text-danger',
            actionButton: 'ghost-btn ml-2 inline-flex h-7 flex-none items-center justify-center px-2.5 text-[12px]',
            closeButton: 'icon-btn ml-1 flex-none self-center',
          },
        }}
      />

      {modelStatus === 'checking' && <BootOverlay boot={boot} elapsed={wakeMessage} />}
      </div>
    </Skeleton>
  )
}
