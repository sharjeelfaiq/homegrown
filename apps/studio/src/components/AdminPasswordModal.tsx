import { useState, type FormEvent } from 'react'
import Modal from './Modal'

interface Props {
  open: boolean
  title: string
  description: string
  onClose: () => void
  onSubmit: (password: string) => Promise<void>
}

export default function AdminPasswordModal({ open, title, description, onClose, onSubmit }: Props) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  function close() {
    if (busy) return
    setPassword('')
    onClose()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      await onSubmit(password)
      setPassword('')
      onClose()
    } catch {
      setPassword('')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title={title} onClose={close}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <p className="m-0 text-sm text-muted">{description}</p>
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Admin password
          <input className="mt-1 h-9 w-full rounded-sm border border-control bg-control-fill px-2 text-ink" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} />
        </label>
        <div className="flex justify-end gap-2">
          <button className="ghost-btn" type="button" onClick={close} disabled={busy}>Cancel</button>
          <button className="ghost-btn ghost-btn-danger" type="submit" disabled={busy || !password}>{busy ? 'Deleting…' : 'Confirm delete'}</button>
        </div>
      </form>
    </Modal>
  )
}
