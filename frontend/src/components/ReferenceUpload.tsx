import { useRef, useState } from 'react'
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
 * The over-length warning that used to sit here is gone with it. It probed
 * the file's duration client-side to guess at a trim before saving; the
 * create response now reports what was actually cut, which is both the truth
 * and available without a second read of the file.
 *
 * This is a real drop target as well as a picker, and both are needed. There
 * is a window-wide handler too (useFileDrop) that opens this dialog, but once
 * the dialog is open that handler is behind an overlay -- so dropping onto
 * the zone itself has to work on its own terms.
 */
export default function ReferenceUpload({ onFileSelected, uploading, error }: Props) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
        {!uploading && <UploadIcon />}
        <span className="break-all">
          {uploading
            ? 'Cloning the voice…'
            : 'Drop a reference clip here, or click to browse'}
        </span>
      </div>

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
