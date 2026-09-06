import { useEffect, useRef, useState } from 'react'
import { mediaUrl, type Preset } from '../api'
import { useAudioActivity } from '../AudioActivityContext'
import { useGenerationActivity } from '../GenerationActivityContext'
import { PauseIcon, PlayIcon } from './Icons'

interface Props {
  presets: Preset[]
  selectedPresetId: string | null
  onSelect: (id: string) => void
}

/** Voice picker: a native <select> plus one audition button.
 *
 * Replaces a row of chips. A <select> can't hold per-voice actions, so
 * auditioning collapses to a single button that previews whichever voice is
 * currently chosen -- you pick, you hear it, you move on. Deleting a voice
 * moved into the new-voice modal, which is where voices are managed; it does
 * not belong on the compose path.
 *
 * The generating indicator survives as a dot on the field, so you can still
 * see at a glance that the selected voice is mid-job. */
export default function VoicePicker({ presets, selectedPresetId, onSelect }: Props) {
  const [previewing, setPreviewing] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { setActiveAudio, releaseAudio } = useAudioActivity()
  const { runningPresetNames } = useGenerationActivity()

  const selected = presets.find((p) => p.id === selectedPresetId) ?? null
  const generating = selected != null && runningPresetNames.has(selected.name)

  // Switching voices mid-preview should stop the old preview, not leave it
  // playing under a name that is no longer selected.
  useEffect(() => {
    const audio = audioRef.current
    if (audio && !audio.paused) audio.pause()
    setPreviewing(false)
  }, [selectedPresetId])

  function toggle() {
    const audio = audioRef.current
    if (!audio || !selected) return
    if (previewing) {
      audio.pause()
      return
    }
    audio.src = mediaUrl(selected.preview_url)
    audio.play().catch(() => {})
    setPreviewing(true)
  }

  if (presets.length === 0) {
    return <span className="empty-inline">No voices yet — add one to get started.</span>
  }

  return (
    <>
      <select
        className="select"
        aria-label="Voice"
        value={selectedPresetId ?? ''}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="" disabled>
          Choose a voice…
        </option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="icon-btn audition-btn"
        disabled={!selected}
        aria-label={
          selected
            ? previewing
              ? `Stop preview of ${selected.name}`
              : `Preview ${selected.name}`
            : 'Preview voice'
        }
        onClick={toggle}
      >
        {previewing ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
      </button>

      {generating && (
        <span className="generating-dot" title={`${selected?.name} is generating`} aria-hidden="true" />
      )}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        preload="none"
        onPlay={(e) => setActiveAudio(e.currentTarget)}
        onPause={(e) => {
          setPreviewing(false)
          releaseAudio(e.currentTarget)
        }}
        onEnded={(e) => {
          setPreviewing(false)
          releaseAudio(e.currentTarget)
        }}
        style={{ display: 'none' }}
      />
    </>
  )
}
