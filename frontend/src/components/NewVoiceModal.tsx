import { useEffect, useRef, useState } from 'react'
import { mediaUrl, presetDownloadUrl, type Preset } from '../api'
import { useAudioActivity } from '../AudioActivityContext'
import { formatClock } from '../format'
import { REF_TRIM_SECS } from '../constants'
import InlineName from './InlineName'
import Modal from './Modal'
import ReferenceUpload from './ReferenceUpload'
import { DownloadIcon, PauseIcon, PlayIcon, TrashIcon } from './Icons'

interface Props {
  open: boolean
  onClose: () => void
  presets: Preset[]
  onFileSelected: (file: File) => void
  uploading: boolean
  /** Why the last upload or rename failed, rendered inside the dialog. */
  error: string | null
  /** Reference clips the backend shortened, by preset id. */
  trimmed: Record<string, number>
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

/** Add a voice, and manage the ones already saved.
 *
 * One dropzone and one row per voice: name on the left, actions on the right.
 * Adding a voice is a single gesture -- the clip saves on drop and the row
 * appears -- so there is no name field and no Save button, and the name is
 * corrected in place afterwards if the filename was not what you wanted.
 *
 * Renaming here goes to the BACKEND, unlike the Voiceovers column, which
 * keeps its names in localStorage. A voice's name is read server-side on
 * every generate and stamped into history, so a client-only rename would
 * disagree with every voiceover the voice had already produced. The shared
 * InlineName knows nothing about either; the difference is in onCommit.
 *
 * Deletion lives here rather than next to the picker on the compose path: it
 * is a management action, it is destructive, and it was the reason the old
 * chip row needed three controls per voice. Confirmation is inline (the row
 * flips to Delete/Keep) rather than window.confirm, which blocks the page and
 * looks nothing like the rest of the app.
 *
 * Each row also plays its reference clip. Without it the recording a voice was
 * cloned from was write-only: you could upload it and delete it, but never hear
 * what the clone was actually built on.
 */
export default function NewVoiceModal({
  open,
  onClose,
  presets,
  onFileSelected,
  uploading,
  error,
  trimmed,
  onRename,
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
      <ReferenceUpload onFileSelected={onFileSelected} uploading={uploading} error={error} />

      {/* No is_builtin filter: no preset is ever builtin (see CLAUDE.md), so
          filtering on it only ever returned the whole list. */}
      {presets.length > 0 && (
        <ul className="m-0 list-none p-0">
          {presets.map((preset) => (
            <li key={preset.id} className="border-b border-hairline py-1 last:border-b-0">
              <div className="flex min-h-9 items-center justify-between gap-3">
                <InlineName
                  value={preset.name}
                  placeholder="Name this voice"
                  ariaLabel={`Name of voice ${preset.name}`}
                  title="Click to rename"
                  onCommit={(next) => onRename(preset.id, next)}
                />

                {confirmingId === preset.id ? (
                  <span className="flex flex-none gap-1.5">
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
                  <span className="flex flex-none items-center gap-0.5">
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
                    {/* An <a download>, matching the voiceover rows. The
                        filename comes from the server, so it follows a
                        rename without this knowing anything about it. */}
                    <a
                      href={presetDownloadUrl(preset.id)}
                      download
                      className="icon-btn"
                      aria-label={`Download ${preset.name} reference clip`}
                      title="Download reference clip"
                    >
                      <DownloadIcon size={13} />
                    </a>
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
              </div>

              {/* Reported after the fact rather than warned about before it.
                  Saving is now one gesture, so there is no moment to warn in
                  -- and this is the measured trim from the server, not a
                  guess from the file's own metadata. The voice is one click
                  from deletion right here if the cut is wrong. */}
              {trimmed[preset.id] != null && (
                <p className="m-0 pb-1 text-[11px] text-faint">
                  Trimmed from {formatClock(trimmed[preset.id])} — the first {REF_TRIM_SECS}s are
                  used.
                </p>
              )}
            </li>
          ))}
        </ul>
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
