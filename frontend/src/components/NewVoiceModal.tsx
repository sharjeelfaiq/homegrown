import { useEffect, useRef, useState } from 'react'
import { mediaUrl, type Preset } from '../api'
import { useAudioActivity } from '../AudioActivityContext'
import Modal from './Modal'
import ReferenceUpload from './ReferenceUpload'
import { PauseIcon, PlayIcon, TrashIcon } from './Icons'

interface Props {
  open: boolean
  onClose: () => void
  presets: Preset[]
  name: string
  onNameChange: (value: string) => void
  file: File | null
  onFileSelected: (file: File | null) => void
  language: string
  onLanguageChange: (value: string) => void
  languages: string[]
  creating: boolean
  onCreate: () => void
  onDelete: (id: string) => void
}

/** Add a voice, and manage the ones already saved.
 *
 * Deletion lives here rather than next to the picker on the compose path: it
 * is a management action, it is destructive, and it was the reason the old
 * chip row needed three controls per voice. Confirmation is inline (the row
 * flips to Delete/Keep) rather than window.confirm, which blocks the page and
 * looks nothing like the rest of the app.
 *
 * Each row also plays its reference clip. Without it the recording a voice was
 * cloned from was write-only: you could upload it and delete it, but never hear
 * what the clone was actually built on. */
export default function NewVoiceModal({
  open,
  onClose,
  presets,
  name,
  onNameChange,
  file,
  onFileSelected,
  language,
  onLanguageChange,
  languages,
  creating,
  onCreate,
  onDelete,
}: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { setActiveAudio, releaseAudio } = useAudioActivity()

  // Closing the dialog has to stop the clip too, or it keeps playing behind a
  // dismissed modal with no visible control to stop it.
  useEffect(() => {
    if (open) return
    const audio = audioRef.current
    if (audio && !audio.paused) audio.pause()
    setPreviewingId(null)
    setConfirmingId(null)
  }, [open])

  function togglePreview(preset: Preset) {
    const audio = audioRef.current
    if (!audio) return
    if (previewingId === preset.id) {
      audio.pause()
      return
    }
    // One <audio> for the whole list, so reassigning src is what stops the
    // previously playing row -- two clips can never overlap.
    audio.src = mediaUrl(preset.preview_url)
    audio.play().catch(() => {})
    setPreviewingId(preset.id)
  }

  return (
    <Modal open={open} title="Voices" onClose={onClose}>
      <ReferenceUpload
        name={name}
        onNameChange={onNameChange}
        fileName={file?.name ?? null}
        file={file}
        onFileSelected={onFileSelected}
        language={language}
        onLanguageChange={onLanguageChange}
        languages={languages}
        creating={creating}
        onCreate={onCreate}
      />

      {/* No is_builtin filter: no preset is ever builtin (see CLAUDE.md), so
          filtering on it only ever returned the whole list. */}
      {presets.length > 0 && (
        <section className="voice-manage">
          <h3 className="section-rule">
            <span>Your voices</span>
          </h3>
          <ul className="voice-manage-list">
            {presets.map((preset) => (
              <li key={preset.id} className="voice-manage-row">
                <span className="voice-manage-name">{preset.name}</span>
                {confirmingId === preset.id ? (
                  <span className="voice-manage-confirm">
                    <button
                      type="button"
                      className="ghost-btn ghost-btn-danger"
                      onClick={() => {
                        onDelete(preset.id)
                        setConfirmingId(null)
                      }}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => setConfirmingId(null)}
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <span className="voice-manage-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={
                        previewingId === preset.id
                          ? `Stop ${preset.name} reference clip`
                          : `Play ${preset.name} reference clip`
                      }
                      title="Play reference clip"
                      onClick={() => togglePreview(preset)}
                    >
                      {previewingId === preset.id ? (
                        <PauseIcon size={13} />
                      ) : (
                        <PlayIcon size={13} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      aria-label={`Delete ${preset.name}`}
                      title="Delete voice"
                      onClick={() => setConfirmingId(preset.id)}
                    >
                      <TrashIcon size={13} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* crossOrigin is required even though this element only plays and never
          decodes: setActiveAudio hands it to AudioEngine, which wires it
          through createMediaElementSource. In split-origin dev the clip is
          served from VITE_BACKEND_URL while the page is on :5173, and a
          cross-origin source without CORS is tainted -- a tainted
          MediaElementAudioSourceNode emits silence, so the button appears to
          work and nothing is heard. /refs already returns the matching
          access-control-allow-origin. */}
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
    </Modal>
  )
}
