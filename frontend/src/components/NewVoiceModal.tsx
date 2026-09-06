import { useState } from 'react'
import type { Preset } from '../api'
import Modal from './Modal'
import ReferenceUpload from './ReferenceUpload'
import { TrashIcon } from './Icons'

interface Props {
  open: boolean
  onClose: () => void
  presets: Preset[]
  name: string
  onNameChange: (value: string) => void
  file: File | null
  onFileSelected: (file: File | null) => void
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
 * looks nothing like the rest of the app. */
export default function NewVoiceModal({
  open,
  onClose,
  presets,
  name,
  onNameChange,
  file,
  onFileSelected,
  creating,
  onCreate,
  onDelete,
}: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const custom = presets.filter((p) => !p.is_builtin)

  return (
    <Modal open={open} title="Voices" onClose={onClose}>
      <ReferenceUpload
        name={name}
        onNameChange={onNameChange}
        fileName={file?.name ?? null}
        onFileSelected={onFileSelected}
        creating={creating}
        onCreate={onCreate}
      />

      {custom.length > 0 && (
        <section className="voice-manage">
          <h3 className="section-rule">
            <span>Your voices</span>
          </h3>
          <ul className="voice-manage-list">
            {custom.map((preset) => (
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
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    aria-label={`Delete ${preset.name}`}
                    onClick={() => setConfirmingId(preset.id)}
                  >
                    <TrashIcon size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Modal>
  )
}
