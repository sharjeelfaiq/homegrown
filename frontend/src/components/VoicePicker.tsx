import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { mediaUrl, type Preset } from '../api'
import { useAudioActivity } from '../AudioActivityContext'
import { useGenerationActivity } from '../GenerationActivityContext'
import { PauseIcon, PlayIcon } from './Icons'

interface Props {
  presets: Preset[]
  selectedPresetId: string | null
  onSelect: (id: string) => void
  /** True before the first fetch has returned. An empty list means two
   * completely different things -- "you have no voices" and "we have not asked
   * yet" -- and only one of them is the user's problem to fix. */
  loading?: boolean
}

/** Voice picker: a trigger button plus a popover list, each row carrying its
 * own audition and delete buttons on the right.
 *
 * Deliberately NOT a native <select>, and that is the whole reason this control
 * is hand-rolled: an <option> cannot contain a button. Browsers ignore markup
 * inside it, so there is no element to click and no way to hang per-voice
 * actions off a row. Anyone tempted to simplify this back to a <select> loses
 * the play and delete buttons with it.
 *
 * Delete keeps the two-step inline confirm used in NewVoiceModal (the row flips
 * to Delete/Keep) rather than window.confirm, which blocks the page. Deleting
 * the selected voice needs no special handling here -- StudioShell's
 * handleDeletePreset already clears the selection.
 *
 * The generating indicator shows in two places on purpose: on the trigger for
 * the selected voice, and on any row whose voice is mid-job. */
export default function VoicePicker({
  presets,
  selectedPresetId,
  onSelect,
  loading = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { setActiveAudio, releaseAudio } = useAudioActivity()
  const { runningPresetNames } = useGenerationActivity()

  const selected = presets.find((p) => p.id === selectedPresetId) ?? null
  const generating = selected != null && runningPresetNames.has(selected.name)

  const stopPreview = useCallback(() => {
    const audio = audioRef.current
    if (audio && !audio.paused) audio.pause()
    setPreviewingId(null)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    // A preview belongs to the open menu. Leaving it playing under a closed
    // popover gives audio with no visible source and no way to stop it.
    stopPreview()
  }, [stopPreview])

  // Click-outside and Escape. pointerdown rather than click, so the menu closes
  // on press the way a native select does.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      close()
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

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

  // Arrow keys walk the rows. Every row is a real button, so Tab already works;
  // this only adds the movement people expect from a dropdown.
  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLUListElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const picks = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>('.voice-menu-pick') ?? [],
    )
    if (picks.length === 0) return
    e.preventDefault()
    const at = picks.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1
    picks[(next + picks.length) % picks.length].focus()
  }

  if (presets.length === 0) {
    return (
      <span className="empty-inline">
        {loading ? 'Loading your voices…' : 'No voices yet — add one to get started.'}
      </span>
    )
  }

  return (
    <div className="voice-field" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="select voice-trigger"
        aria-label="Voice"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="voice-trigger-label">{selected ? selected.name : 'Choose a voice…'}</span>
        {generating && (
          <span
            className="generating-dot"
            title={`${selected?.name} is generating`}
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <ul className="voice-menu" onKeyDown={onMenuKeyDown}>
          {presets.map((p) => (
            <li key={p.id} className="voice-menu-row">
              <button
                type="button"
                className="voice-menu-pick"
                aria-current={p.id === selectedPresetId}
                onClick={() => {
                  onSelect(p.id)
                  close()
                  triggerRef.current?.focus()
                }}
              >
                <span className="voice-menu-name">{p.name}</span>
                {runningPresetNames.has(p.name) && (
                  <span
                    className="generating-dot"
                    title={`${p.name} is generating`}
                    aria-hidden="true"
                  />
                )}
              </button>

              {/* Audition only. Deleting a voice is destructive and lives in
                  the Voices dialog, where voices are managed -- it does not
                  belong on a dropdown you open to pick one. */}
              <span className="voice-menu-actions">
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
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* crossOrigin is load-bearing, not boilerplate. setActiveAudio routes
          every element through AudioEngine's createMediaElementSource, and in
          split-origin dev the clip comes from VITE_BACKEND_URL while the page
          is on :5173 -- a cross-origin source without CORS is tainted, and a
          tainted MediaElementAudioSourceNode outputs silence. The transport
          runs, the waveform moves, and nothing is audible. */}
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
