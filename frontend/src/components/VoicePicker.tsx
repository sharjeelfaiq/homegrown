import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { mediaUrl, type Preset } from '../api'
import { useAudioActivity } from '../AudioActivityContext'
import { useGenerationActivity } from '../GenerationActivityContext'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
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
  // Below the breakpoint it gives way instead, down to a 124px floor. At
  // 320px the row is now [+] 32 + gap 8 + 168, which leaves real slack rather
  // than the 12px the old 220px left -- that margin vanished the moment a
  // scrollbar appeared.
  return (
    <div
      className="relative min-w-[124px] flex-[0_1_168px] wide:min-w-0 wide:flex-[0_0_168px]"
      ref={rootRef}
    >
      <button
        type="button"
        ref={triggerRef}
        className="select flex w-full items-center gap-1.5 text-left"
        aria-label="Voice"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">{selected ? selected.name : 'Choose a voice…'}</span>
        {generating && (
          <span
            className={`size-1.5 rounded-full bg-progress ${reduced ? '' : 'animate-pulse-soft'}`}
            title={`${selected?.name} is generating`}
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <ul
          className="absolute top-[calc(100%+4px)] right-0 left-0 z-50 m-0 max-h-[280px] list-none overflow-y-auto rounded-md border border-control bg-surface-card p-1 shadow-(--shadow-menu)"
          onKeyDown={onMenuKeyDown}
        >
          {presets.map((p) => (
            <li
              key={p.id}
              className="flex min-h-9 items-center gap-1 border-b border-hairline last:border-b-0"
            >
              <button
                type="button"
                className="voice-menu-pick flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm bg-transparent py-0 pr-1 pl-1.5 text-left text-[13px] text-muted transition-[color,background] duration-(--fast) ease-(--ease) hover:bg-surface-hover hover:text-ink aria-[current=true]:text-ink"
                aria-current={p.id === selectedPresetId}
                onClick={() => {
                  onSelect(p.id)
                  close()
                  triggerRef.current?.focus()
                }}
              >
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{p.name}</span>
                {runningPresetIds.has(p.id) && (
                  <span
                    className={`size-1.5 rounded-full bg-progress ${reduced ? '' : 'animate-pulse-soft'}`}
                    title={`${p.name} is generating`}
                    aria-hidden="true"
                  />
                )}
              </button>

              {/* Audition only. Deleting a voice is destructive and lives in
                  the Voices dialog, where voices are managed -- it does not
                  belong on a dropdown you open to pick one. */}
              <span className="ml-auto flex flex-none items-center gap-0.5">
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
