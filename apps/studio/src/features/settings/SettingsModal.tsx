import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Palette, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { formatToastDescription, formatToastTitle } from '../../lib/messageFormatting'
import Modal from '../../components/ui/Modal'
import ConfirmDeleteModal from '../../components/ui/ConfirmDeleteModal'
import StatusMark from '../../components/ui/StatusMark'
import type { BulkDeleteResult } from '../../lib/api'
import ThemeSwitch from './ThemeSwitch'
import './SettingsModal.css'

interface Props {
  open: boolean
  onClose: () => void
  mascotEnabled: boolean
  onMascotEnabledChange: (next: boolean) => void
  onBulkDelete: (kind: 'history' | 'presets', adminPassword: string) => Promise<BulkDeleteResult>
}

interface ModelChoice { available: boolean; reason: string | null; installed: boolean; device?: string; status?: string; gpu?: { available: boolean; status: string }; cpu?: { available: boolean; status: string } }

function VoiceModelAvailability({ open }: { open: boolean }) {
  const [choices, setChoices] = useState<Record<string, ModelChoice> | null>(null)
  const [recommended, setRecommended] = useState('standard')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    fetch('/api/models').then((response) => response.ok ? response.json() : null).then((body) => {
      if (active) { setChoices(body?.choices ?? null); setRecommended(body?.recommended ?? 'standard') }
    }).catch(() => { if (active) setChoices(null) })
    return () => { active = false }
  }, [open])
  const labels = [['standard', 'Standard'], ['higher', 'Higher quality']] as const
  return <section className="settings-section mt-6" aria-labelledby="voice-model-heading">
    <h3 id="voice-model-heading" className="m-0 font-mono text-[11px] font-normal tracking-[0.1em] uppercase text-muted">Voice model</h3>
    <p className="settings-section-description">Hardware fit is assessed for GPU and CPU. Estimated and unknown choices remain available; successful loading and generation provide stronger validation.</p>
    <div className="mt-3 grid gap-2">
      {labels.map(([key, label]) => {
        const choice = choices?.[key]
        const available = choice?.available === true || choice?.status === 'Unknown'
        const reason = choice?.reason ?? 'Hardware details are unavailable; download remains available.'
        return <div key={key} className={`model-setup-option ${available ? '' : 'model-setup-option-unavailable'}`}>
          <span className="model-setup-option-copy"><strong>{label}{recommended === key ? ' · Recommended' : ''}</strong><span>{reason} {choice?.installed ? 'Installed.' : ''}</span></span>
          <span className="model-setup-option-tag">{choice?.status ?? 'Unknown'} · {choice?.device ?? 'Unknown'}</span>
          <button type="button" className="ghost-btn" disabled={busy || (choice?.available === false && choice?.status !== 'Unknown')} onClick={async () => {
            setBusy(true); setMessage('')
            try {
              const selected = await fetch('/api/models/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ selection: key }) })
              const body = await selected.json()
              if (!selected.ok) throw new Error(body.detail || 'Could not select this model.')
              if (body.state === 'needs_download') {
                const downloaded = await fetch('/api/models/download', { method: 'POST' })
                const result = await downloaded.json()
                if (!downloaded.ok) throw new Error(result.detail || 'Could not start the download.')
                setMessage(`${label} download started.`)
              } else setMessage(`${label} is loading.`)
            } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not select this model.') }
            finally { setBusy(false) }
          }}>{choice?.installed ? 'Use model' : 'Download'}</button>
        </div>
      })}
      {!choices && <p className="m-0 text-[12px] text-muted">Could not confirm model compatibility. Try again when the backend is available.</p>}
      {message && <p role="status" className="m-0 text-[12px] text-muted">{message}</p>}
    </div>
  </section>
}

/** A small home for durable Studio preferences. */
export default function SettingsModal({ open, onClose, mascotEnabled, onMascotEnabledChange, onBulkDelete }: Props) {
  const [activeTab, setActiveTab] = useState<'appearance' | 'danger'>('appearance')
  const [confirm, setConfirm] = useState<'history' | 'presets' | null>(null)
  const [busy, setBusy] = useState(false)
  const [passwordStep, setPasswordStep] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const busyRef = useRef(false)
  useEffect(() => {
    if (!open) setActiveTab('appearance')
  }, [open])
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

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const currentIndex = tabs.indexOf(event.target as HTMLButtonElement)
    if (currentIndex < 0) return
    let nextIndex = currentIndex
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = tabs.length - 1
    else return
    event.preventDefault()
    const nextTab = tabs[nextIndex]
    nextTab.focus()
    setActiveTab(nextTab.dataset.settingsTab as 'appearance' | 'danger')
  }

  return (
    <>
    <Modal open={open && confirm === null} title="Settings" onClose={onClose} size="settings">
      <div className="settings-layout">
        <div className="settings-sidebar" role="tablist" aria-label="Settings sections" onKeyDown={handleTabKeyDown}>
          <button
            id="settings-tab-appearance"
            type="button"
            role="tab"
            aria-selected={activeTab === 'appearance'}
            aria-controls="settings-panel-appearance"
            tabIndex={activeTab === 'appearance' ? 0 : -1}
            data-settings-tab="appearance"
            className={`settings-sidebar-tab ${activeTab === 'appearance' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            <Palette size={15} aria-hidden="true" />
            <span>Appearance</span>
          </button>
          <button
            id="settings-tab-danger"
            type="button"
            role="tab"
            aria-selected={activeTab === 'danger'}
            aria-controls="settings-panel-danger"
            tabIndex={activeTab === 'danger' ? 0 : -1}
            data-settings-tab="danger"
            className={`settings-sidebar-tab is-danger ${activeTab === 'danger' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('danger')}
          >
            <TriangleAlert size={15} aria-hidden="true" />
            <span>Danger Zone</span>
          </button>
        </div>
        <div
          id={`settings-panel-${activeTab}`}
          className="settings-content"
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab}`}
          tabIndex={0}
        >
        {activeTab === 'appearance' ? <section className="settings-section" aria-labelledby="appearance-heading">
        <div className="flex items-center gap-2">
          <Palette size={15} className="text-muted" aria-hidden="true" />
          <h3 id="appearance-heading" className="m-0 font-mono text-[11px] font-normal tracking-[0.1em] uppercase text-muted">Appearance</h3>
        </div>
        <div className="mt-4">
          <ThemeSwitch />
        </div>
        <VoiceModelAvailability open={open && activeTab === 'appearance'} />
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
        : <section className="settings-section settings-danger-section" aria-labelledby="danger-zone-heading">
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
        }
        </div>
        <div
          id={`settings-panel-${activeTab === 'appearance' ? 'danger' : 'appearance'}`}
          role="tabpanel"
          aria-labelledby={`settings-tab-${activeTab === 'appearance' ? 'danger' : 'appearance'}`}
          hidden
        />
      </div>
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
