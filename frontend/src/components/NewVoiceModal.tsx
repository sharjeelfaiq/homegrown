import { useEffect, useRef, useState } from 'react'
import { mediaUrl, presetDownloadUrl, type Preset } from '../api'
import { PADDING_SAFE_MIN_CHARS } from '../constants'
import { useAudioActivity } from '../AudioActivityContext'
import { useGenerationActivity } from '../GenerationActivityContext'
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
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

/** True when this voice's reference clip is long enough to hurt output quality.
 *
 * Tests `chunk_chars` rather than the clip duration, because duration is only a
 * proxy: the speaker's rate and the transcript length move the budget too, so a
 * 40s clip can be fine and a shorter one from a fast reader may not be. The
 * backend derives both per request (see Preset in api.ts), which is what makes
 * this work on voices created before clip-trimming existed -- they have no
 * stored field to read, and they are exactly the voices worth flagging.
 *
 * Undefined chunk_chars (an older backend, or a clip that could not be
 * measured) reads as NOT flagged. A badge that appears because something failed
 * to load would send people to delete a healthy voice.
 */
function overCap(preset: Preset): boolean {
  return preset.chunk_chars != null && preset.chunk_chars < PADDING_SAFE_MIN_CHARS
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
  onRename,
  onDelete,
}: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [previewingId, setPreviewingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const { setActiveAudio, releaseAudio } = useAudioActivity()
  const { runningPresetIds } = useGenerationActivity()

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
      <ReferenceUpload onFileSelected={onFileSelected} uploading={uploading} />

      {/* Rendered unconditionally, and that is the point rather than an
          oversight. It used to be behind `presets.length > 0`, which meant
          the very first voice made the dialog jump by a whole list -- the
          worst instance of the shift voice-list exists to remove. The empty
          state fills the reserved window instead.

          No is_builtin filter: no preset is ever builtin (see CLAUDE.md), so
          filtering on it only ever returned the whole list. */}
      <ul className="voice-list">
        {presets.length === 0 ? (
          <li className="grid h-full place-items-center text-[13px] text-faint">No voices yet.</li>
        ) : (
          presets.map((preset) => (
            <li key={preset.id} className="border-b border-hairline py-1 pl-2 last:border-b-0">
              <div className="flex min-h-9 items-center justify-between gap-3">
                <InlineName
                  value={preset.name}
                  placeholder="Name this voice"
                  ariaLabel={`Name of voice ${preset.name}`}
                  title="Click to rename"
                  onCommit={(next) => onRename(preset.id, next)}
                />

                {confirmingId === preset.id ? (
                  <span className="flex flex-none items-center gap-1.5">
                    {/* Only on a voice that is mid-generation. The dropdown has
                        marked these for a while; this dialog, which is the only
                        place a voice can be DELETED, said nothing -- and the
                        queued voiceovers behind it then fail with a 404 on
                        retry. The delete is still allowed: wanting a voice gone
                        is a legitimate reason to accept that. */}
                    {runningPresetIds.has(preset.id) && (
                      <span className="text-[11px] text-danger">
                        In use — queued voiceovers will fail.
                      </span>
                    )}
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
                    {/* At most ONE badge, never both. The row is a fixed
                        height (voice-list is 6 x --voice-row-h, so a second
                        line cannot be accommodated -- a per-voice note under
                        the row was tried once and broke exactly this), and two
                        badges plus three icon buttons crowd the name out at the
                        modal's width. `busy` wins while it applies: it is
                        transient and time-sensitive, whereas an over-long
                        reference clip is a standing property of the voice and
                        will still be there when the render finishes. */}
                    {runningPresetIds.has(preset.id) ? (
                      <span
                        className="mono mr-1 text-[10px] text-progress"
                        title="This voice is generating a voiceover right now"
                      >
                        busy
                      </span>
                    ) : (
                      overCap(preset) && (
                        <span
                          className="mono mr-1 text-[10px] text-progress"
                          title={
                            `Cloned from a ${Math.round(preset.ref_seconds ?? 0)}s reference clip, which leaves ` +
                            `room for only ${preset.chunk_chars}-character chunks -- below the ` +
                            `${PADDING_SAFE_MIN_CHARS}-character point where quality starts to suffer. ` +
                            `Delete this voice and re-create it from a 10-20s clip.`
                          }
                        >
                          {Math.round(preset.ref_seconds ?? 0)}s
                        </span>
                      )
                    )}
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
            </li>
          ))
        )}
      </ul>

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
