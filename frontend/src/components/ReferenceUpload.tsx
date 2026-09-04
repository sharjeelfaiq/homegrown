import { UploadIcon } from './Icons'

interface Props {
  name: string
  onNameChange: (value: string) => void
  fileName: string | null
  onFileSelected: (file: File | null) => void
  creating: boolean
  onCreate: () => void
}

export default function ReferenceUpload({
  name,
  onNameChange,
  fileName,
  onFileSelected,
  creating,
  onCreate,
}: Props) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>New preset</h2>
      </div>
      <input
        type="text"
        placeholder={'Preset name (e.g. "Narrator")'}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
      />
      <label className={fileName ? 'dropzone dropzone-filled' : 'dropzone'}>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFileSelected(file)
          }}
        />
        <UploadIcon />
        {fileName ? <span>{fileName}</span> : <span>Click to choose a reference audio file</span>}
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
            ×
          </button>
        )}
      </label>
      <p className="empty-hint">Up to ~60 seconds of clear audio works best.</p>
      <button
        type="button"
        className="primary-btn"
        disabled={!name.trim() || !fileName || creating}
        onClick={onCreate}
      >
        {creating ? 'Saving...' : 'Save preset'}
      </button>
    </section>
  )
}
