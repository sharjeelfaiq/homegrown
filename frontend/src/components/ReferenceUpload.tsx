import { useRef, useState } from 'react'
import { REF_TRIM_SECS } from '../constants'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { UploadIcon } from './Icons'

interface Props {
  /** Called with an accepted audio file. The caller uploads it immediately --
   *  there is no pending state here to clear, and no Save step. */
  onFileSelected: (file: File) => void
  /** True while the caller's upload is in flight. */
  uploading: boolean
  /** Why the last upload failed. Belongs here rather than in the composer:
   *  the composer is behind this dialog, so an error reported there is an
   *  error the user cannot see. */
  error: string | null
}

const AUDIO_EXT = /\.(wav|mp3|m4a|flac|ogg|opus|webm|aac)$/i

/** The add-a-voice control: a drop target that is also a file picker.
 *
 * There is no name field and no Save button. A clip that has been dropped has
 * already been chosen -- asking again was a second confirmation of a decision
 * the user had made, and the name it asked for was one the filename already
 * supplied. The voice saves on drop and its name is edited in place on the
 * row it creates, the same way a voiceover's is.
 *
 * The over-length limit is stated here as a flat rule rather than reported
 * per clip. It has now been two other things and neither worked: first a
 * client-side probe of the file's duration, guessing at a trim before saving;
 * then a per-voice note under the row, from the create response's real
 * trimmed_from_seconds. The second was accurate but arrived after the upload
 * it described, and it gave some rows an extra line -- which the dialog's
 * fixed six-row window cannot accommodate, since that window is six times one
 * row height.
 *
 * This is a real drop target as well as a picker, and both are needed. There
 * is a window-wide handler too (useFileDrop) that opens this dialog, but once
 * the dialog is open that handler is behind an overlay -- so dropping onto
 * the zone itself has to work on its own terms.
 */
export default function ReferenceUpload({ onFileSelected, uploading, error }: Props) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const reduced = usePrefersReducedMotion()

  function accept(file: File | undefined) {
    if (!file || uploading) return
    // By MIME type where the OS supplies one, by extension otherwise --
    // Windows hands over an empty type for some formats.
    if (file.type.startsWith('audio/') || AUDIO_EXT.test(file.name)) onFileSelected(file)
  }

  function browse() {
    if (!uploading) inputRef.current?.click()
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className={[
          'relative flex min-h-[72px] items-center justify-center gap-3',
          'rounded-md border border-dashed border-control bg-surface-raised',
          'px-[18px] py-3.5 text-center text-[13px] text-muted',
          'transition-[border-color,color,background] duration-(--fast) ease-(--ease)',
          uploading
            ? 'cursor-progress border-solid border-audio-line text-ink'
            : 'cursor-pointer hover:border-faint hover:text-ink',
          // Solid border while a file is over the zone -- the dash means
          // "nothing here yet", so it goes the moment that stops being true.
          over && !uploading && 'border-solid border-audio bg-audio-soft text-audio',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={browse}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            browse()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          if (!uploading) setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOver(false)
          accept(e.dataTransfer.files?.[0])
        }}
        role="button"
        tabIndex={0}
        aria-busy={uploading}
        aria-label="Choose or drop a reference clip to make a voice"
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          disabled={uploading}
          onChange={(e) => {
            accept(e.target.files?.[0])
            // Clear it, or choosing the same file twice in a row fires no
            // change event and the second attempt silently does nothing.
            e.target.value = ''
          }}
        />
        {/* A spinner, not a progress bar, and the difference is forced rather
            than chosen: createPreset (api.ts) is one fetch() POST of a
            FormData body, fetch exposes no upload-progress events, and the
            server work behind it -- trim, then a faster-whisper transcription
            of the clip -- has no progress channel at all. There is nothing
            honest to drive a percentage from, and the transcription is the
            part that dominates the wait anyway.

            Sized to UploadIcon's own 22px box so swapping one for the other
            does not move the label inside this gap-3 row. Previously the icon
            was simply dropped while uploading and the text slid left. */}
        {uploading ? (
          <span
            className={`size-[22px] flex-none rounded-full border-2 border-progress-line border-t-progress ${
              reduced ? '' : 'animate-boot-spin'
            }`}
            aria-hidden="true"
          />
        ) : (
          <UploadIcon />
        )}
        <span className="break-all">
          {uploading
            ? 'Cloning the voice…'
            : 'Drop a reference clip here, or click to browse'}
        </span>
      </div>

      {/* Stated up front rather than reported afterwards. This replaced a
          per-voice "Trimmed from 2:03 — the first 40s are used." line under
          the row a clip created: that told you about one clip, after you had
          already uploaded it, and it made the rows two different heights,
          which is incompatible with the fixed six-row window the list now
          reserves (see @utility voice-list).

          REF_TRIM_SECS is interpolated, not written out, because the backend
          enforces its own copy of it (backend/main.py) and a hardcoded number
          here would drift silently.

          "of speech", deliberately: pack_speech (backend/audio_stitcher.py)
          collapses long internal pauses before the cap is applied, so a
          three-minute voice note that is mostly hesitation still yields a
          full window. "The first 40 seconds" would be wrong for exactly the
          sparse recordings that packing exists to rescue. */}
      <p className="m-0 text-[11px]/[1.5] text-faint">
        Clips longer than {REF_TRIM_SECS} seconds of speech are trimmed to the first{' '}
        {REF_TRIM_SECS}.
      </p>

      {error && (
        <p
          className="m-0 rounded-sm border border-danger bg-danger-soft px-3 py-2.5 text-[13px] text-danger"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  )
}
