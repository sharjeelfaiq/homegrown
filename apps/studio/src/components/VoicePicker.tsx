import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { mediaUrl, presetDownloadUrl, type Preset } from '../api'
import { useAudioActivity } from '../AudioActivityContext'
import { useGenerationActivity } from '../GenerationActivityContext'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { ChevronDown, Download as DownloadIcon, Pause as PauseIcon, Play as PlayIcon, Trash2 as TrashIcon } from 'lucide-react'
import AdminPasswordModal from './AdminPasswordModal'
import InlineName from './InlineName'
import { AppTooltip } from './Tooltip'
import { Dropdown } from './Dropdown'

interface Props {
  presets: Preset[]
  selectedPresetId: string | null
  onSelect: (id: string) => void
  onRename: (id: string, name: string, opts?: { unloading?: boolean }) => void
  /** True before the first fetch has returned. An empty list means two
   * completely different things -- "you have no voices" and "we have not asked
   * yet" -- and only one of them is the user's problem to fix. */
  loading?: boolean
  onDelete: (id: string, adminPassword: string) => Promise<void>
}

/** Voice picker: a trigger button plus a popover list, each row carrying its
 * editable name plus audition, download, and delete controls on the right.
 *
 * Deliberately NOT a native <select>, and that is the whole reason this control
 * is hand-rolled: an <option> cannot contain a button. Browsers ignore markup
 * inside it, so there is no element to click and no way to hang per-voice
 * actions off a row. Anyone tempted to simplify this back to a <select> loses
 * the play and delete buttons with it.
 *
 * Delete uses the password confirmation rather than window.confirm, which
 * blocks the page. Deleting
 * the selected voice needs no special handling here -- StudioShell's
 * handleDeletePreset already clears the selection.
 *
 * The generating indicator shows in two places on purpose: on the trigger for
 * the selected voice, and on any row whose voice is mid-job. */
export default function VoicePicker({
  presets,
  selectedPresetId,
  onSelect,
  onRename,
  loading = false,
  onDelete,
}: Props) {
  const [open, setOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const [deletePreset, setDeletePreset] = useState<Preset | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { setActiveAudio, releaseAudio } = useAudioActivity()
  const { runningPresetIds } = useGenerationActivity()
  const reduced = usePrefersReducedMotion()
  // The busy dot pulsed regardless of prefers-reduced-motion. Its duration is a
  // literal 1.4s in --animate-pulse-soft, not one of the --fast/--base/--slow
  // tokens the reduced-motion block in tokens.css zeroes, so that block never
  // touched it -- and it ran for the whole generation, minutes at a time. It
  // was the only infinite animation in the app not gated this way; boot-spin
  // and sheen both already were. The ELEMENT stays either way, so the voice is
  // still marked as busy without the motion.

  const selected = presets.find((p) => p.id === selectedPresetId) ?? null
  const generating = selected != null && runningPresetIds.has(selected.id)

  const stopPreview = useCallback(() => {
    const audio = audioRef.current
    if (audio && !audio.paused) audio.pause()
    setPreviewingId(null)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setSearchQuery('')
    // A preview belongs to the open menu. Leaving it playing under a closed
    // popover gives audio with no visible source and no way to stop it.
    stopPreview()
  }, [stopPreview])

  // Deletion resolves in the parent, so a row can vanish from under an open
  // menu. Without this, a stale confirm row survives and a preview keeps
  // playing audio the backend no longer serves.
  useEffect(() => {
    if (previewingId && !presets.some((p) => p.id === previewingId)) stopPreview()
  }, [presets, previewingId, stopPreview])

  function togglePreview(preset: Preset) {
    const audio = audioRef.current
    if (!audio) return
    if (previewingId === preset.id) {
      audio.pause()
      return
    }
    // Reassigning src is what stops a different row's preview: one <audio>
    // element serves the whole list, so a second play cannot overlap the first.
    audio.src = mediaUrl(preset.preview_url)
    audio.play().catch(() => {})
    setPreviewingId(preset.id)
  }

  function selectPreset(id: string) {
    onSelect(id)
  }

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const filteredPresets = normalizedSearchQuery
    ? presets.filter((preset) => preset.name.toLowerCase().includes(normalizedSearchQuery))
    : presets

  // Arrow keys walk the selectable rows. Inline names and action controls keep
  // their usual Tab behavior and stop their clicks from selecting a row.
  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLUListElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const picks = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>('.voice-menu-pick') ?? [],
    )
    if (picks.length === 0) return
    e.preventDefault()
    const at = picks.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1
    picks[(next + picks.length) % picks.length].focus()
  }

  if (presets.length === 0) {
    return (
      <span className="m-0 text-[12px] text-faint">
        {loading ? 'Loading your voices…' : 'No voices yet — add one to get started.'}
      </span>
    )
  }

  // Fixed on desktop so the field does not read as a search bar -- absorbing
  // the compose row's slack made it as wide as the composer, which looked
  // like search rather than a choice between a handful of voices. 168px is
  // enough for a typical voice name; longer ones truncate with an ellipsis,
  // which they always did.
  //
  // It remains 168px at every viewport: a selection is data, not a layout
  // instruction. Long names truncate inside the stable field rather than
  // changing the composer alignment.
  return (
    <div className="relative w-[168px] flex-none" ref={rootRef}>
      {/* aria-label OVERRIDES the button's text content when computing its
          accessible name, so a bare "Voice" meant a screen reader announced
          "Voice, collapsed" and never said WHICH voice was selected --
          verified against the accessibility tree, which reported the name as
          exactly "Voice" while the button visibly read "Steven Seagal
          Humiliated Bruce Lee on St". The selection has to be in the label. */}
      <Dropdown.Root open={open} onOpenChange={(nextOpen) => nextOpen ? setOpen(true) : close()}>
      <AppTooltip content={selected?.name ?? 'Select voice'}>
        <Dropdown.Trigger
          className={`dropdown-select-trigger voice-picker-trigger w-full ${selected ? 'is-selected' : ''}`}
          aria-label={selected ? `Voice: ${selected.name}${generating ? ', generating' : ''}` : 'Select voice'}
        >
        {/* The tooltip, because the field is deliberately a fixed 168px (see above)
            and a long name is genuinely cut -- measured at 126px visible of
            258px, i.e. under half. Widening it is not the fix; that was tried
            and read as a search bar. Hover reveals the rest instead. */}
        <span className="min-w-0 flex-1 truncate">
          {selected ? selected.name : 'Select voice'}
        </span>
          {generating && (
          <span
            className={`size-1.5 rounded-full bg-progress ${reduced ? '' : 'animate-pulse-soft'}`}
            aria-hidden="true"
          />
          )}
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
        </Dropdown.Trigger>
      </AppTooltip>

      <Dropdown.Content side="bottom" align="start" sideOffset={6} className="voice-picker-dropdown" role="presentation">
          <ul className="voice-picker-list" role="listbox" onKeyDown={onMenuKeyDown}>
            <li className="list-none border-b border-hairline px-1.5 pt-1 pb-1" role="presentation">
              <input
                type="search"
                value={searchQuery}
                aria-label="Search cloned voices"
                placeholder="Search voices…"
                className="h-8 w-full rounded-sm border border-control bg-control-fill px-2 text-[12px] text-ink outline-none placeholder:text-faint focus:border-control focus:ring-0 focus:outline-none"
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Keep typing and arrow keys out of row navigation.
                  event.stopPropagation()
                }}
                onClick={(event) => event.stopPropagation()}
              />
            </li>
            {filteredPresets.length === 0 ? (
              <li className="list-none px-2 py-3 text-[12px] text-faint" role="presentation">
                No matching voices.
              </li>
            ) : filteredPresets.map((p) => (
              <li
                key={p.id}
                className={`voice-menu-pick flex min-h-9 items-center gap-1 rounded-sm border-b border-hairline px-1.5 last:border-b-0 hover:bg-surface-hover focus:bg-surface-hover focus:outline-none ${p.id === selectedPresetId ? 'voice-menu-pick-selected' : ''}`}
                role="option"
                tabIndex={0}
                aria-selected={p.id === selectedPresetId}
                aria-current={p.id === selectedPresetId ? 'true' : undefined}
                onClick={() => {
                  selectPreset(p.id)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  selectPreset(p.id)
                }}
              >
                <span className="flex min-w-0 flex-1 items-center">
                  <span
                    className="min-w-0 flex-1"
                    onClick={(event) => {
                      event.stopPropagation()
                      if (event.target instanceof HTMLInputElement && event.target.readOnly) {
                        selectPreset(p.id)
                      }
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <InlineName
                      value={p.name}
                      placeholder="Name this voice"
                      ariaLabel={`Name of voice ${p.name}`}
                      title="Use the pencil to edit voice name"
                      onCommit={(next, opts) => onRename(p.id, next, opts)}
                      minChars={1}
                      className="result-name voice-picker-name"
                      editOnPencil
                    />
                  </span>
                  {runningPresetIds.has(p.id) && (
                    <span
                      className={`size-1.5 rounded-full bg-progress ${reduced ? '' : 'animate-pulse-soft'}`}
                      aria-hidden="true"
                    />
                  )}
                </span>

                <span
                  className="ml-auto flex flex-none items-center gap-0.5"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <AppTooltip content={previewingId === p.id ? 'Stop preview' : 'Preview voice'}>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={
                        previewingId === p.id ? `Stop preview of ${p.name}` : `Preview ${p.name}`
                      }
                      onClick={() => togglePreview(p)}
                    >
                      {previewingId === p.id ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
                    </button>
                  </AppTooltip>
                  <AppTooltip content="Download reference clip">
                    <a
                      href={presetDownloadUrl(p.id)}
                      download
                      className="icon-btn"
                      aria-label={`Download ${p.name} reference clip`}
                    >
                      <DownloadIcon size={13} />
                    </a>
                  </AppTooltip>
                  <AppTooltip content="Delete voice">
                    <button type="button" className="icon-btn icon-btn-danger" aria-label={`Delete ${p.name}`} onClick={() => { stopPreview(); setDeletePreset(p) }}>
                      <TrashIcon size={13} />
                    </button>
                  </AppTooltip>
                </span>
              </li>
            ))}
          </ul>
      </Dropdown.Content>
      </Dropdown.Root>

      <AdminPasswordModal
        open={deletePreset !== null}
        title="Delete voice"
        description={deletePreset ? `Permanently delete “${deletePreset.name}” and its reference audio?` : ''}
        onClose={() => setDeletePreset(null)}
        onSubmit={async (password) => {
          if (deletePreset) await onDelete(deletePreset.id, password)
        }}
      />

      {/* setActiveAudio routes every element through AudioEngine's
          createMediaElementSource. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        crossOrigin="anonymous"
        ref={audioRef}
        preload="none"
        onPlay={(e) => setActiveAudio(e.currentTarget)}
        onPause={(e) => {
          setPreviewingId(null)
          releaseAudio(e.currentTarget)
        }}
        onEnded={(e) => {
          setPreviewingId(null)
          releaseAudio(e.currentTarget)
        }}
        style={{ display: 'none' }}
      />
    </div>
  )
}
