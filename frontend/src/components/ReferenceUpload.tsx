import { useRef, useState } from 'react'
import { UploadIcon } from './Icons'

interface Props {
  name: string
  onNameChange: (value: string) => void
  fileName: string | null
  onFileSelected: (file: File | null) => void
  /** Language is a property of the voice, set once here at creation -- not a
   * per-script choice on the compose path. */
  language: string
  onLanguageChange: (value: string) => void
  languages: string[]
  creating: boolean
  onCreate: () => void
}

/** The new-voice form. Lives inside Modal now, so it no longer draws its own
 * panel chrome -- the dialog supplies that.
 *
 * The dropzone is a real drop target as well as a file picker. There is also a
 * window-wide one (useFileDrop) that opens this modal pre-filled, but once the
 * modal is open the window handler is behind an overlay, so dropping onto the
 * zone itself has to work on its own terms. Both routes call the same
 * onFileSelected, which is what pre-fills the name.
 *
 * The clip is the subject here, so the dropzone is the only full-width block.
 * Name and Language sit on one row above it as corrections to defaults rather
 * than as fields to fill in. */
export default function ReferenceUpload({
  name,
  onNameChange,
  fileName,
  onFileSelected,
  language,
  onLanguageChange,
  languages,
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
      {/* Name and Language share a row. Both are 36px fields in a 460px dialog,
          and stacking them spent ~106px of a ~320px form on two controls that
          are corrections, not decisions -- the name arrives pre-filled from the
          clip's filename and the language is almost always already right. */}
      <div className="voice-form-row">
        <label className="labelled voice-form-name">
          <span className="labelled-text">Name</span>
          <input
            type="text"
            placeholder='e.g. "Narrator"'
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>

        {/* languages.length ? ... : [language] keeps the field non-empty while
            /api/languages is still in flight. */}
        <label className="labelled voice-form-language">
          <span className="labelled-text">Language</span>
          <select
            className="select"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
          >
            {(languages.length ? languages : [language]).map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </label>
      </div>

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

      {/* No length hint here. The backend enforces 2-60s and returns a specific,
          measured message when a clip misses it ("Reference audio is 100.8s,
          too long (maximum 60.0s)"), which teaches more at the moment it
          matters than a line of prose does before the file is even chosen. */}

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
