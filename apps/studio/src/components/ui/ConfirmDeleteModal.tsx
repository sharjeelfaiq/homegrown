import Modal from './Modal'

interface Props {
  open: boolean
  title: string
  description: string
  onClose: () => void
  onConfirm: () => void
}

/** A deliberate second step for destructive actions, without an auth prompt. */
export default function ConfirmDeleteModal({ open, title, description, onClose, onConfirm }: Props) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p className="m-0 text-[13px]/[1.55] text-muted">{description}</p>
      <div className="flex justify-end gap-2.5">
        <button type="button" className="ghost-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="ghost-btn ghost-btn-danger" onClick={() => { onConfirm(); onClose() }}>Delete</button>
      </div>
    </Modal>
  )
}
