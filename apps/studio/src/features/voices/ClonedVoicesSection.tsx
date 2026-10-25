import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, Download as DownloadIcon, Ellipsis as EllipsisIcon, LoaderCircle, Pause as PauseIcon, Play as PlayIcon, Trash2 as TrashIcon, Upload as UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { formatToastTitle } from '../../lib/messageFormatting'
import { mediaUrl, presetDownloadUrl, type Preset } from '../../lib/api'
import { useAudioActivity } from '../../lib/audio/AudioActivityContext'
import { useGenerationActivity } from '../generation/GenerationActivityContext'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import { Dropdown } from '../../components/ui/Dropdown'
import DropdownSelect from '../../components/ui/DropdownSelect'
import ConfirmDeleteModal from '../../components/ui/ConfirmDeleteModal'
import InlineName from '../../components/ui/InlineName'
import { useVoiceCloneQueue, type CloneQueueDisplayItem } from './useVoiceCloneQueue'
import { AppTooltip } from '../../components/ui/Tooltip'
import { Skeleton } from 'boneyard-js/react'
import { ClonedVoiceRowsFixture } from '../../skeletons/BoneyardFixtures'
import { useQuery } from '@tanstack/react-query'
import { apiQueryKeys, fetchVoicePage } from '../history/historyQuery'

const skeletonSnapshotConfig = {
  excludeTags: ['svg', 'canvas'],
  excludeSelectors: ['[data-boneyard-decorative]'],
}
const MODEL_PICKER_LOADING_TOOLTIP = 'Available when the voice model is ready.'

interface Props {
  presets: Preset[]
  selectedPresetId: string | null
  onSelect: (id: string) => void
  onRename: (id: string, name: string, opts?: { unloading?: boolean }) => void
  loading?: boolean
  modelReady: boolean
  modelLoading: boolean
  onAddVoice: (file: File) => Promise<'done' | 'failed'>
  onDelete: (id: string) => Promise<void>
  onCloneBusyChange?: (busy: boolean) => void
}

/** Persistent voice management surface for cloning, finding, and managing presets. */
export default function ClonedVoicesSection({
  presets,
  selectedPresetId,
  onSelect,
  onRename,
  loading = false,
  modelReady,
  modelLoading,
  onAddVoice,
  onDelete,
  onCloneBusyChange,
}: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [pageSize, setPageSize] = useState(() => {
    try {
      const stored = Number(localStorage.getItem('homegrown.voicePageSize'))
      return [50, 80, 100].includes(stored) ? stored : 50
    } catch { return 50 }
  })
  const [page, setPage] = useState(0)
  const [cloneQueue, setCloneQueue] = useState<CloneQueueDisplayItem[]>([])
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [deletePreset, setDeletePreset] = useState<Preset | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const previewRequestRef = useRef(0)
  const previewObjectUrlRef = useRef<string | null>(null)
  const voiceUploadRef = useRef<HTMLInputElement>(null)
  const enqueueVoiceFiles = useVoiceCloneQueue({ modelReady, onAddVoice, onBusyChange: onCloneBusyChange, onQueueChange: setCloneQueue })
  const { setActiveAudio, releaseAudio } = useAudioActivity()
  const { runningPresetIds } = useGenerationActivity()
  const reduced = usePrefersReducedMotion()

  useEffect(() => () => {
    if (previewObjectUrlRef.current) URL.revokeObjectURL(previewObjectUrlRef.current)
  }, [])

  const stopPreview = useCallback(() => {
    previewRequestRef.current += 1
    const audio = audioRef.current
    if (audio && !audio.paused) audio.pause()
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current)
      previewObjectUrlRef.current = null
    }
    setPreviewingId(null)
  }, [])

  useEffect(() => {
    if (previewingId && !presets.some((preset) => preset.id === previewingId)) stopPreview()
  }, [presets, previewingId, stopPreview])

  const [isDraggingVoiceFile, setIsDraggingVoiceFile] = useState(false)

  function hasFiles(event: { dataTransfer: DataTransfer | null }) {
    return Array.from(event.dataTransfer?.types ?? []).includes('Files')
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    if (!hasFiles(event)) return
    event.preventDefault()
    setIsDraggingVoiceFile(false)
    enqueueVoiceFiles(Array.from(event.dataTransfer.files ?? []))
  }

  async function togglePreview(preset: Preset) {
    const audio = audioRef.current
    if (!audio) return
    if (previewingId === preset.id) {
      stopPreview()
      return
    }
    if (!preset.preview_url) return

    stopPreview()
    const requestId = ++previewRequestRef.current
    setPreviewingId(preset.id)
    try {
      const source = mediaUrl(preset.preview_url)
      audio.src = source
      await audio.play()
    } catch (error) {
      if (requestId === previewRequestRef.current) {
        setPreviewingId(null)
        toast.error(formatToastTitle(error instanceof Error ? error.message : `Could not play ${preset.name}.`))
      }
    }
  }

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const visibleCloneQueue = cloneQueue.filter((item) => !normalizedSearchQuery || item.name.toLowerCase().includes(normalizedSearchQuery))
  const clonedPresets = presets.filter((preset) => !preset.is_builtin)
  const allFilteredPresets = normalizedSearchQuery
    ? clonedPresets.filter((preset) => preset.name.toLowerCase().includes(normalizedSearchQuery))
    : clonedPresets
  const pageQuery = useQuery({
    queryKey: apiQueryKeys.voiceList({ limit: pageSize, offset: page * pageSize, q: normalizedSearchQuery }),
    queryFn: () => fetchVoicePage({ limit: pageSize, offset: page * pageSize, q: normalizedSearchQuery }),
  })
  const activeResult = pageQuery.data ?? null
  const pageCount = Math.max(1, Math.ceil((activeResult?.total ?? allFilteredPresets.length) / pageSize))
  const pageStart = pageCount <= 4 ? 0 : Math.max(0, Math.min(page - 2, pageCount - 5))
  const pageButtons = Array.from({ length: Math.min(pageCount, pageCount <= 4 ? 4 : 5) }, (_, index) => pageStart + index)
  const liveById = new Map(clonedPresets.map((preset) => [preset.id, preset]))
  const serverRecords: Preset[] | null = activeResult?.presets
    .flatMap((pagePreset): Preset[] => {
      const livePreset = liveById.get(pagePreset.id)
      if (!livePreset || (normalizedSearchQuery && !livePreset.name.toLowerCase().includes(normalizedSearchQuery))) return []
      return [{
        ...livePreset,
        // Keep live parent data for row actions, but the paginated API result
        // is authoritative for its freshly aggregated completed-history count.
        completed_voiceovers: pagePreset.completed_voiceovers ?? livePreset.completed_voiceovers ?? 0,
      }]
    })
    ?? null
  const firstServerPresetId = serverRecords?.[0]?.id
  const firstServerIndex = firstServerPresetId ? clonedPresets.findIndex((preset) => preset.id === firstServerPresetId) : -1
  const localAdditions = page === 0 && firstServerIndex > 0
    ? allFilteredPresets.slice(0, firstServerIndex).filter((preset) => !serverRecords?.some((record) => record.id === preset.id))
    : []
  const visiblePresets = (serverRecords ? [...localAdditions, ...serverRecords] : allFilteredPresets.slice(page * pageSize, (page + 1) * pageSize)).slice(0, pageSize)
  const voiceTotal = activeResult?.total ?? allFilteredPresets.length
  useEffect(() => {
    if (!pageQuery.data) return
    const lastPage = Math.max(0, Math.ceil(pageQuery.data.total / pageSize) - 1)
    setPage((active) => Math.min(active, lastPage))
  }, [pageQuery.data, pageSize])
  useEffect(() => { setPage((current) => Math.min(current, pageCount - 1)) }, [pageCount])
  useEffect(() => { setPage(0) }, [normalizedSearchQuery, pageSize])
  function changePageSize(value: number) {
    setPageSize(value)
    try { localStorage.setItem('homegrown.voicePageSize', String(value)) } catch { /* Storage may be unavailable. */ }
  }
  const cloneDisabled = !modelReady
  const cloneTooltip = modelLoading
    ? MODEL_PICKER_LOADING_TOOLTIP
    : !modelReady
      ? 'Voice model unavailable. Open backend details.'
      : 'Clone voice'

  function onListKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    if (modelLoading) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const picks = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('.voice-menu-pick') ?? [])
    if (picks.length === 0) return
    event.preventDefault()
    const at = picks.indexOf(document.activeElement as HTMLElement)
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1
    picks[(next + picks.length) % picks.length].focus()
  }

  return (
    <section
      className={`cloned-voices-section results flex w-full flex-none flex-col wide:min-h-0 wide:flex-1 ${isDraggingVoiceFile ? 'is-file-drop-target' : ''}`}
      aria-labelledby="cloned-voices-heading"
      data-tour="voice-controls"
      ref={rootRef}
      onDragEnter={(event) => { if (hasFiles(event)) { event.preventDefault(); setIsDraggingVoiceFile(true) } }}
      onDragOver={(event) => { if (hasFiles(event)) event.preventDefault() }}
      onDragLeave={(event) => { if (hasFiles(event)) setIsDraggingVoiceFile(false) }}
      onDrop={handleDrop}
    >
      <h3 id="cloned-voices-heading" className="sr-only">Cloned voices</h3>
      <div className="voiceovers-card-header voiceover-history-header shrink-0">
        <div className="mt-1 flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              type="search"
              value={searchQuery}
              aria-label="Search cloned voices"
              placeholder="Search voices…"
              className="voiceover-search h-9 w-full rounded-sm border border-control bg-surface-raised px-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-(--line-focus)"
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
        </div>
      </div>
      <div className="history-context-toolbar cloned-voices-toolbar flex shrink-0 items-center gap-2 text-[11px] text-muted" role="toolbar" aria-label="Cloned voice actions">
        <input
          ref={voiceUploadRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          disabled={cloneDisabled}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            enqueueVoiceFiles(files)
          }}
        />
        <span className="inline-flex shrink-0">
          <AppTooltip content={cloneTooltip}>
            <button
              type="button"
              className="clone-voice-button inline-flex items-center gap-1.5 p-0 text-[11px] text-muted transition-colors hover:text-audio hover:underline disabled:cursor-default disabled:no-underline"
              aria-label="Clone voice"
              disabled={cloneDisabled}
              data-tour="add-voice"
              onClick={() => voiceUploadRef.current?.click()}
            >
              <UploadIcon size={14} />
              <span>Clone voice</span>
            </button>
          </AppTooltip>
        </span>
      </div>
      {loading && presets.length === 0 && !pageQuery.data && visibleCloneQueue.length === 0 ? (
        <Skeleton
          name="cloned-voices"
          loading
          fixture={<ClonedVoiceRowsFixture />}
          select="viewport"
          snapshotConfig={skeletonSnapshotConfig}
        >
          <ClonedVoiceRowsFixture />
        </Skeleton>
      ) : clonedPresets.length === 0 && visibleCloneQueue.length === 0 ? (
        <p className="cloned-voices-empty m-0 text-[12px] text-faint">No voices yet — add one to get started.</p>
      ) : (
        <>
        <ul className="result-list cloned-voices-list" role="listbox" onKeyDown={onListKeyDown}>
          {visibleCloneQueue.map((item) => (
            <li key={`clone-${item.id}`} className="voice-menu-pick -mx-2 flex min-h-9 items-center gap-2 border-b border-hairline px-2" role="option" aria-selected="false" aria-disabled="true" aria-label={`${item.name}, ${item.status === 'cloning' ? 'cloning' : 'in queue'}`}>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {item.status === 'cloning'
                  ? <LoaderCircle size={14} className={reduced ? 'text-progress' : 'animate-spin text-progress'} aria-hidden="true" />
                  : <span className="size-1.5 rounded-full bg-queued" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{item.name}</span>
                <span className="mono flex-none text-[10px] text-faint" role="status">{item.status === 'cloning' ? 'Cloning' : 'In queue'}</span>
              </span>
            </li>
          ))}
          {visiblePresets.length === 0 && visibleCloneQueue.length === 0 ? (
            <li className="list-none px-2 py-3 text-[12px] text-faint" role="presentation">No matching voices.</li>
          ) : visiblePresets.map((preset) => {
            const voiceCount = (
              <span className="voice-generation-count mono flex-none text-[10px] text-faint" aria-label={`${preset.completed_voiceovers ?? 0} completed voiceovers`}>
                {preset.completed_voiceovers ?? 0} voiceover{preset.completed_voiceovers === 1 ? '' : 's'}
              </span>
            )
            const pickerDetails = (
              <span className={`voice-picker-option-details flex min-w-0 flex-1 items-center ${modelLoading ? 'is-disabled' : ''}`}>
                <span className="min-w-0 flex-1" onKeyDown={(event) => event.stopPropagation()}>
                  <InlineName value={preset.name} placeholder="Name this voice" ariaLabel={`Name of voice ${preset.name}`} title={modelLoading ? MODEL_PICKER_LOADING_TOOLTIP : 'Edit voice name'} onCommit={(next, opts) => onRename(preset.id, next, opts)} minChars={1} className="result-name voice-picker-name" editOnPencil />
                </span>
                {runningPresetIds.has(preset.id) && <span className={`voice-generation-indicator size-1.5 rounded-full bg-progress ${reduced ? '' : 'animate-pulse-soft'}`} aria-hidden="true" />}
                {modelLoading
                  ? <AppTooltip content={MODEL_PICKER_LOADING_TOOLTIP}>{voiceCount}</AppTooltip>
                  : voiceCount}
              </span>
            )
            const option = (
            <li
              key={preset.id}
              className={`voice-menu-pick -mx-2 flex min-h-9 items-center gap-1 border-b border-hairline px-2 last:border-b-0 hover:bg-surface-hover focus:bg-surface-hover focus:outline-none ${preset.id === selectedPresetId ? 'voice-menu-pick-selected' : ''}`}
              role="option"
              tabIndex={modelLoading ? -1 : 0}
              aria-disabled={modelLoading || undefined}
              aria-selected={preset.id === selectedPresetId}
              aria-current={preset.id === selectedPresetId ? 'true' : undefined}
              onClick={() => { if (!modelLoading) onSelect(preset.id) }}
              onKeyDown={(event) => {
                if (modelLoading || (event.key !== 'Enter' && event.key !== ' ')) return
                event.preventDefault()
                onSelect(preset.id)
              }}
            >
              {pickerDetails}
              <span className="ml-auto flex flex-none items-center gap-0.5" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <AppTooltip content={previewingId === preset.id ? 'Stop preview' : 'Preview voice'}><button type="button" className="icon-btn" aria-label={previewingId === preset.id ? `Stop preview of ${preset.name}` : `Preview ${preset.name}`} onClick={() => void togglePreview(preset)}>{previewingId === preset.id ? <PauseIcon size={13} /> : <PlayIcon size={13} />}</button></AppTooltip>
                <AppTooltip content="Download reference clip"><a href={presetDownloadUrl(preset.id)} download className="icon-btn" aria-label={`Download ${preset.name} reference clip`}><DownloadIcon size={13} /></a></AppTooltip>
                <Dropdown.Root>
                  <AppTooltip content="More actions">
                    <Dropdown.Trigger className="icon-btn" aria-label={`More actions for ${preset.name}`}><EllipsisIcon size={14} /></Dropdown.Trigger>
                  </AppTooltip>
                  <Dropdown.Content side="bottom" align="end" sideOffset={4} className="row-actions-menu">
                    <Dropdown.Item className="dropdown-menu-item dropdown-menu-item-danger gap-2" onClick={() => { stopPreview(); setDeletePreset(preset) }}><TrashIcon size={14} aria-hidden="true" /> Delete</Dropdown.Item>
                  </Dropdown.Content>
                </Dropdown.Root>
              </span>
            </li>
            )
            return option
          })}
        </ul>
        <div className="voiceover-pager cloned-voices-pager" aria-label="Voice pagination">
          <label className="flex items-center gap-1.5 text-[10px] text-faint">
            <span className="mono uppercase tracking-[0.08em]">Per page</span>
            <DropdownSelect
              className="dropdown-select-compact px-1.5"
              value={String(pageSize)}
              ariaLabel="Voices per page"
              placeholder="Select page size"
              options={[50, 80, 100].map((size) => ({ value: String(size), label: String(size) }))}
              onValueChange={(value) => changePageSize(Number(value))}
            />
          </label>
          <nav
            aria-label="Cloned voice pages"
            className={pageCount > 1 ? undefined : 'is-disabled'}
            aria-disabled={pageCount > 1 ? undefined : true}
            inert={pageCount <= 1}
          >
            <ul className="voiceover-pager-list">
              <li className="voiceover-pager-prev">
                <AppTooltip content="Previous page">
                  <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
                    <ChevronLeft size={14} aria-hidden="true" />
                  </button>
                </AppTooltip>
              </li>
              {pageButtons.map((index) => (
                <li key={index} className={`voiceover-pager-page ${page === index ? 'is-active' : ''}`}>
                  <button type="button" aria-label={`Page ${index + 1}`} aria-current={page === index ? 'page' : undefined} onClick={() => setPage(index)}>{index + 1}</button>
                </li>
              ))}
              <li className="voiceover-pager-next">
                <AppTooltip content="Next page">
                  <button type="button" aria-label="Next page" disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </AppTooltip>
              </li>
            </ul>
          </nav>
          <span className="voiceover-pager-count" aria-label="Total voices">{voiceTotal} voices</span>
        </div>
        </>
      )}
      <ConfirmDeleteModal
        open={deletePreset !== null}
        title="Delete voice?"
        description={deletePreset ? `Delete “${deletePreset.name}” and its reference audio? You can undo this for 7 seconds.` : ''}
        onClose={() => setDeletePreset(null)}
        onConfirm={() => { if (deletePreset) void onDelete(deletePreset.id) }}
      />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio crossOrigin="anonymous" ref={audioRef} preload="none" onPlay={(event) => setActiveAudio(event.currentTarget)} onPause={(event) => { setPreviewingId(null); releaseAudio(event.currentTarget) }} onEnded={(event) => { setPreviewingId(null); releaseAudio(event.currentTarget) }} style={{ display: 'none' }} />
    </section>
  )
}
