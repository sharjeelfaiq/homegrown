import { useRef, useState } from 'react'
import { UploadIcon } from './Icons'

interface Props {
  name: string
  onNameChange: (value: string) => void
  fileName: string | null
  onFileSelected: (file: File | null) => void
  creating: boolean
  onCreate: () => void
}

/** The new-voice form. Lives inside Modal now, so it no longer draws its own
 * panel chrome -- the dialog supplies that.
 *
 * The dropzone is a real drop target as well as a file picker. There is also a
 * window-wide one (useFileDrop) that opens this modal pre-filled, but once the
 * modal is open the window handler is behind an overlay, so dropping onto the
 * zone itself has to work on its own terms. */
export default function ReferenceUpload({
  name,
  onNameChange,
  fileName,
  onFileSelected,
  creating,
  onCreate,
}: Props) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function accept(file: File | undefined) {
    if (!file) return
    const named = /\.(wav|mp3|m4a|flac|ogg|opus|webm|aac)$/i.test(file.name)
    if (file.type.startsWith('audio/') || named) onFileSelected(file)
  }

  return (
    <div className="voice-form">
      <label className="labelled">
        <span className="labelled-text">Name</span>
        <input
          type="text"
          placeholder='e.g. "Narrator"'
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </label>

      <div
        className={`dropzone${fileName ? ' dropzone-filled' : ''}${over ? ' dropzone-over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOver(true)
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
        aria-label="Choose or drop a reference audio file"
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          onChange={(e) => accept(e.target.files?.[0])}
        />
        <UploadIcon />
        <span className="dropzone-text">
          {fileName ?? 'Drop a reference clip here, or click to browse'}
        </span>
        {fileName && (
          <button
            type="button"
            className="dropzone-clear"
            aria-label="Remove selected file"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              onFileSelected(null)
            }}
          >
            ✕
          </button>
        )}
      </div>

      <p className="hint">10–20 seconds of clean, single-speaker audio clones best.</p>

      <button
        type="button"
        className="primary-btn"
        disabled={!name.trim() || !fileName || creating}
        onClick={onCreate}
      >
        {creating ? 'Saving…' : 'Save voice'}
      </button>
    </div>
  )
}
