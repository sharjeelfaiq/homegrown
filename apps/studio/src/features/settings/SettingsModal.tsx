import { useRef, useState } from 'react'
import { PawPrint, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
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
  onBulkDelete: (kind: 'history' | 'presets') => Promise<BulkDeleteResult>
}

/** A small home for durable Studio preferences. */
export default function SettingsModal({ open, onClose, mascotEnabled, onMascotEnabledChange, onBulkDelete }: Props) {
  const [confirm, setConfirm] = useState<'history' | 'presets' | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  async function removeAll(kind: 'history' | 'presets') {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const label = kind === 'history' ? 'generated voiceovers' : 'uploaded voices'
    const id = toast(`Deleting ${label}…`, { duration: Infinity, icon: <StatusMark status="running" size={18} color="var(--progress)" /> })
    try {
      const result = await onBulkDelete(kind)
      const count = result.deleted_ids.length
      const deletedLabel = count === 1 ? (kind === 'history' ? 'generated voiceover' : 'uploaded voice') : label
      if (result.cleanup_failed.length) {
        const failures = result.cleanup_failed.length
        toast.error(`Deleted ${count} ${deletedLabel}, but some media files could not be removed.`, { id, duration: 6000, description: `${failures} media ${failures === 1 ? 'file remains' : 'files remain'} on disk.` })
      } else {
        toast(`Deleted ${count} ${deletedLabel}.`, { id, duration: 1000, icon: <StatusMark status="done" size={18} doneColor="var(--green)" /> })
      }
    } catch (error) {
      toast.error(`Could not delete ${label}.`, { id, duration: 6000, description: error instanceof Error ? error.message : 'Please try again.' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  return (
    <>
    <Modal open={open && confirm === null} title="Settings" onClose={onClose} size="settings">
      <section className="settings-section" aria-labelledby="preferences-heading">
        <div className="flex items-center gap-2">
          <Settings2 size={15} className="text-audio" aria-hidden="true" />
          <h3 id="preferences-heading" className="m-0 font-mono text-[11px] font-normal tracking-[0.1em] uppercase text-muted">Preferences</h3>
        </div>
        <div className="mt-4">
          <ThemeSwitch />
        </div>
      </section>
      <section className="settings-section" aria-labelledby="appearance-heading">
        <h3 id="appearance-heading" className="m-0 font-mono text-[11px] font-normal tracking-[0.1em] uppercase text-muted">Appearance</h3>
        <button
          type="button"
          role="switch"
          aria-checked={mascotEnabled}
          className="settings-preference-row mt-4 w-full rounded-md border border-control bg-surface-raised p-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--line-focus)"
          onClick={() => onMascotEnabledChange(!mascotEnabled)}
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-card text-audio"><PawPrint size={16} aria-hidden="true" /></span>
            <span className="min-w-0"><span className="block text-[13px] font-medium text-ink">Pet animal</span><span className="mt-0.5 block text-[12px] text-muted">{mascotEnabled ? 'Mascot is visible' : 'Mascot is hidden'}</span></span>
          </span>
          <span className={`relative h-5 w-9 rounded-full transition-colors ${mascotEnabled ? 'bg-audio' : 'bg-surface-card border border-control'}`} aria-hidden="true"><span className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${mascotEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} /></span>
        </button>
      </section>
      <section className="settings-section settings-danger-section" aria-labelledby="danger-zone-heading">
        <h3 id="danger-zone-heading" className="m-0 font-mono text-[11px] font-normal tracking-[0.1em] uppercase text-danger">Danger Zone</h3>
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
      open={open && confirm !== null}
      title={confirm === 'history' ? 'Delete all generated voiceovers?' : 'Delete all uploaded voices?'}
      description={confirm === 'history'
        ? 'Permanently delete every generated voiceover, its transcript and audio, across all pages. Uploaded voices will be kept. Finish or cancel generation first. This cannot be undone.'
        : 'Permanently delete every uploaded voice and its reference audio. Built-in voices and generated voiceovers will be kept. Finish cloning and finish or cancel generation first. This cannot be undone.'}
      onClose={() => setConfirm(null)}
      onConfirm={() => { if (confirm) void removeAll(confirm) }}
    />
    </>
  )
}
