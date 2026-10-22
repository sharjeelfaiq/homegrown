import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Download as DownloadIcon, Ellipsis as EllipsisIcon, Pause as PauseIcon, Play as PlayIcon, Trash2 as TrashIcon, Upload as UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { mediaUrl, presetDownloadUrl, type Preset } from '../../lib/api'
import { useAudioActivity } from '../../lib/audio/AudioActivityContext'
import { useGenerationActivity } from '../generation/GenerationActivityContext'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import { Dropdown } from '../../components/ui/Dropdown'
import ConfirmDeleteModal from '../../components/ui/ConfirmDeleteModal'
import InlineName from '../../components/ui/InlineName'
import { useVoiceCloneQueue } from './useVoiceCloneQueue'
import { AppTooltip } from '../../components/ui/Tooltip'

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
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [deletePreset, setDeletePreset] = useState<Preset | null>(null)
  const rootRef = useRef<HTMLElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const previewRequestRef = useRef(0)
  const previewObjectUrlRef = useRef<string | null>(null)
  const voiceUploadRef = useRef<HTMLInputElement>(null)
  const enqueueVoiceFiles = useVoiceCloneQueue({ modelReady, onAddVoice, onBusyChange: onCloneBusyChange })
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
        toast.error(error instanceof Error ? error.message : `Could not play ${preset.name}.`)
      }
    }
  }

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const filteredPresets = normalizedSearchQuery
    ? presets.filter((preset) => preset.name.toLowerCase().includes(normalizedSearchQuery))
    : presets
  const cloneCount = presets.filter((preset) => !preset.is_builtin).length
  const cloneDisabled = !modelReady
  const cloneTooltip = modelLoading
    ? 'Voice model is loading — this can take up to 3 minutes.'
    : !modelReady
      ? 'The voice model is unavailable. Open the backend warning for details.'
      : 'Clone voice'

  function onListKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
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
        <span role="status">Cloned voices · {cloneCount}</span>
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
        <span className="ml-auto inline-flex shrink-0">
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
      {presets.length === 0 ? (
        <p className="cloned-voices-empty m-0 text-[12px] text-faint">{loading ? 'Loading your voices…' : 'No voices yet — add one to get started.'}</p>
      ) : (
        <ul className="result-list cloned-voices-list" role="listbox" onKeyDown={onListKeyDown}>
          {filteredPresets.length === 0 ? (
            <li className="list-none px-2 py-3 text-[12px] text-faint" role="presentation">No matching voices.</li>
          ) : filteredPresets.map((preset, index) => (
            <Fragment key={preset.id}>
            {preset.is_builtin && (index === 0 || preset.is_builtin !== filteredPresets[index - 1].is_builtin) && (
              <li key={`${preset.id}-heading`} className="list-none px-2 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-faint" role="presentation">
                Built-in voices
              </li>
            )}
            <li
              key={preset.id}
              className={`voice-menu-pick -mx-2 flex min-h-9 items-center gap-1 border-b border-hairline px-2 last:border-b-0 hover:bg-surface-hover focus:bg-surface-hover focus:outline-none ${preset.id === selectedPresetId ? 'voice-menu-pick-selected' : ''}`}
              role="option"
              tabIndex={0}
              aria-selected={preset.id === selectedPresetId}
              aria-current={preset.id === selectedPresetId ? 'true' : undefined}
              onClick={() => onSelect(preset.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onSelect(preset.id)
              }}
            >
              <span className="flex min-w-0 flex-1 items-center">
                <span className="min-w-0 flex-1" onKeyDown={(event) => event.stopPropagation()}>
                  {preset.is_builtin ? <span className="result-name voice-picker-name">{preset.name}</span> : <InlineName value={preset.name} placeholder="Name this voice" ariaLabel={`Name of voice ${preset.name}`} title={`“${preset.name}” — use the pencil to edit voice name`} onCommit={(next, opts) => onRename(preset.id, next, opts)} minChars={1} className="result-name voice-picker-name" editOnPencil />}
                </span>
                {runningPresetIds.has(preset.id) && <span className={`size-1.5 rounded-full bg-progress ${reduced ? '' : 'animate-pulse-soft'}`} aria-hidden="true" />}
              </span>
              <span className="ml-auto flex flex-none items-center gap-0.5" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <AppTooltip content={previewingId === preset.id ? 'Stop preview' : 'Preview voice'}><button type="button" className="icon-btn" aria-label={previewingId === preset.id ? `Stop preview of ${preset.name}` : `Preview ${preset.name}`} onClick={() => void togglePreview(preset)}>{previewingId === preset.id ? <PauseIcon size={13} /> : <PlayIcon size={13} />}</button></AppTooltip>
                {!preset.is_builtin && <>
                <AppTooltip content="Download reference clip"><a href={presetDownloadUrl(preset.id)} download className="icon-btn" aria-label={`Download ${preset.name} reference clip`}><DownloadIcon size={13} /></a></AppTooltip>
                <Dropdown.Root>
                  <AppTooltip content="More voice actions">
                    <Dropdown.Trigger className="icon-btn" aria-label={`More actions for ${preset.name}`}><EllipsisIcon size={14} /></Dropdown.Trigger>
                  </AppTooltip>
                  <Dropdown.Content side="bottom" align="end" sideOffset={4} className="row-actions-menu">
                    <Dropdown.Item className="dropdown-menu-item dropdown-menu-item-danger gap-2" onClick={() => { stopPreview(); setDeletePreset(preset) }}><TrashIcon size={14} aria-hidden="true" /> Delete</Dropdown.Item>
                  </Dropdown.Content>
                </Dropdown.Root></>}
              </span>
            </li></Fragment>
          ))}
        </ul>
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
