import { useRef, useState, type FormEvent } from 'react'
import { Palette, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { formatToastDescription, formatToastTitle } from '../../lib/messageFormatting'
import Modal from '../../components/ui/Modal'
import ConfirmDeleteModal from '../../components/ui/ConfirmDeleteModal'
import StatusMark from '../../components/ui/StatusMark'
import type { BulkDeleteResult } from '../../lib/api'
import ThemeSwitch from './ThemeSwitch'

interface Props {
  open: boolean
  onClose: () => void
  mascotEnabled: boolean
  onMascotEnabledChange: (next: boolean) => void
  onBulkDelete: (kind: 'history' | 'presets', adminPassword: string) => Promise<BulkDeleteResult>
}

/** A small home for durable Studio preferences. */
export default function SettingsModal({ open, onClose, mascotEnabled, onMascotEnabledChange, onBulkDelete }: Props) {
  const [confirm, setConfirm] = useState<'history' | 'presets' | null>(null)
  const [busy, setBusy] = useState(false)
  const [passwordStep, setPasswordStep] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const busyRef = useRef(false)
  async function removeAll(kind: 'history' | 'presets', password: string): Promise<boolean> {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    const label = kind === 'history' ? 'generated voiceovers' : 'uploaded voices'
    const id = toast(formatToastTitle(`Deleting ${label}…`), { duration: Infinity, icon: <StatusMark status="running" size={18} color="var(--progress)" /> })
    try {
      const result = await onBulkDelete(kind, password)
      const count = result.deleted_ids.length
      const deletedLabel = count === 1 ? (kind === 'history' ? 'generated voiceover' : 'uploaded voice') : label
      if (result.cleanup_failed.length) {
        const failures = result.cleanup_failed.length
        toast.error(formatToastTitle(`Deleted ${count} ${deletedLabel}, but some media files could not be removed`), { id, duration: 6000, description: formatToastDescription(`${failures} media ${failures === 1 ? 'file remains' : 'files remain'} on disk`) })
      } else {
        toast(formatToastTitle(`Deleted ${count} ${deletedLabel}.`), { id, duration: 1000, icon: <StatusMark status="done" size={18} doneColor="var(--green)" /> })
      }
      return true
    } catch (error) {
      toast.dismiss(id)
      setPasswordError(error instanceof Error ? error.message : 'Could not verify the admin password. Try again.')
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  function closeConfirmation() {
    setConfirm(null)
    setPasswordStep(false)
    setAdminPassword('')
    setPasswordError('')
  }

  async function submitAdminPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!confirm || !adminPassword) {
      setPasswordError('Enter the admin password to continue.')
      return
    }
    setPasswordError('')
    if (await removeAll(confirm, adminPassword)) closeConfirmation()
  }

  return (
    <>
    <Modal open={open && confirm === null} title="Settings" onClose={onClose} size="settings">
      <section className="settings-section" aria-labelledby="appearance-heading">
        <div className="flex items-center gap-2">
          <Palette size={15} className="text-muted" aria-hidden="true" />
          <h3 id="appearance-heading" className="m-0 font-mono text-[11px] font-normal tracking-[0.1em] uppercase text-muted">Appearance</h3>
        </div>
        <div className="mt-4">
          <ThemeSwitch />
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={mascotEnabled}
          className="settings-preference-row mt-4 w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--line-focus)"
          onClick={() => onMascotEnabledChange(!mascotEnabled)}
        >
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-ink">Pet animal</span>
            <span className="mt-0.5 block text-[12px] text-muted">{mascotEnabled ? 'Mascot is visible' : 'Mascot is hidden'}</span>
          </span>
          <span className={`relative h-5 w-9 rounded-full transition-colors ${mascotEnabled ? 'bg-audio' : 'bg-surface-card border border-control'}`} aria-hidden="true"><span className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${mascotEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} /></span>
        </button>
      </section>
      <section className="settings-section settings-danger-section" aria-labelledby="danger-zone-heading">
        <div className="flex items-center gap-2">
          <TriangleAlert size={15} className="text-danger" aria-hidden="true" />
          <h3 id="danger-zone-heading" className="m-0 font-mono text-[11px] font-normal tracking-[0.1em] uppercase text-danger">Danger Zone</h3>
        </div>
        <p className="settings-section-description">These permanent actions cannot be undone.</p>
        <div aria-busy={busy}>
          <div className="settings-danger-row">
            <span><span className="settings-row-label">Generated voiceovers</span><span className="settings-row-description">History, transcripts, and audio</span></span>
            <button type="button" aria-label="Delete all generated voiceovers" className="ghost-btn ghost-btn-danger" disabled={busy} onClick={() => setConfirm('history')}>Delete all</button>
          </div>
          <div className="settings-danger-row">
            <span><span className="settings-row-label">Uploaded voices</span><span className="settings-row-description">Cloned voices and reference audio</span></span>
            <button type="button" aria-label="Delete all uploaded voices" className="ghost-btn ghost-btn-danger" disabled={busy} onClick={() => setConfirm('presets')}>Delete all</button>
          </div>
        </div>
      </section>
    </Modal>
    <ConfirmDeleteModal
      open={open && confirm !== null && !passwordStep}
      title={confirm === 'history' ? 'Delete all generated voiceovers?' : 'Delete all uploaded voices?'}
      description={confirm === 'history'
        ? 'Permanently delete every generated voiceover, its transcript and audio, across all pages. Uploaded voices will be kept. Finish or cancel generation first. This cannot be undone.'
        : 'Permanently delete every cloned voice and its reference audio. Generated voiceovers will be kept. Finish cloning and finish or cancel generation first. This cannot be undone.'}
      onClose={closeConfirmation}
      onConfirm={() => setPasswordStep(true)}
      closeOnConfirm={false}
    />
    <Modal open={open && confirm !== null && passwordStep} title="Admin password required" onClose={busy ? () => {} : closeConfirmation}>
      <form className="flex flex-col gap-4" onSubmit={submitAdminPassword}>
        <p className="m-0 text-[13px]/[1.55] text-muted">Enter the admin password to permanently delete {confirm === 'history' ? 'all generated voiceovers' : 'all uploaded voices'}.</p>
        <label className="flex flex-col gap-2 text-[13px] font-medium text-ink" htmlFor="bulk-delete-admin-password">
          Admin password
          <input
            id="bulk-delete-admin-password"
            type="password"
            name="admin-password"
            autoComplete="current-password"
            autoFocus
            required
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.currentTarget.value)}
            className="voiceover-search h-10 w-full rounded-sm border border-control bg-surface-raised px-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-(--line-focus)"
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? 'admin-password-error' : undefined}
            disabled={busy}
          />
        </label>
        {passwordError && <p id="admin-password-error" role="alert" className="m-0 text-[12px] text-danger">{passwordError}</p>}
        <div className="flex justify-end gap-2.5">
          <button type="button" className="ghost-btn" onClick={closeConfirmation} disabled={busy}>Cancel</button>
          <button type="submit" className="ghost-btn ghost-btn-danger" disabled={busy}>Delete permanently</button>
        </div>
      </form>
    </Modal>
    </>
  )
}
