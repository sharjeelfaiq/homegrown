import { PawPrint, Settings2 } from 'lucide-react'
import Modal from './Modal'
import ThemeSwitch from './ThemeSwitch'

interface Props {
  open: boolean
  onClose: () => void
  mascotEnabled: boolean
  onMascotEnabledChange: (next: boolean) => void
}

/** A small home for durable Studio preferences. */
export default function SettingsModal({ open, onClose, mascotEnabled, onMascotEnabledChange }: Props) {
  return (
    <Modal open={open} title="Settings" onClose={onClose}>
      <section aria-labelledby="preferences-heading">
        <div className="flex items-center gap-2">
          <Settings2 size={15} className="text-audio" aria-hidden="true" />
          <h3 id="preferences-heading" className="m-0 font-mono text-[11px] font-normal tracking-[0.1em] uppercase text-muted">Preferences</h3>
        </div>
        <div className="mt-4 border-t border-hairline pt-4">
          <ThemeSwitch />
        </div>
      </section>
      <section className="border-t border-hairline pt-5" aria-labelledby="appearance-heading">
        <h3 id="appearance-heading" className="m-0 font-mono text-[11px] font-normal tracking-[0.1em] uppercase text-muted">Appearance</h3>
        <button
          type="button"
          role="switch"
          aria-checked={mascotEnabled}
          className="mt-4 flex w-full items-center gap-3 rounded-md border border-control bg-surface-raised p-3 text-left transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-audio"
          onClick={() => onMascotEnabledChange(!mascotEnabled)}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-card text-audio"><PawPrint size={16} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium text-ink">Pet animal</span><span className="mt-0.5 block text-[12px] text-muted">{mascotEnabled ? 'Mascot is visible' : 'Mascot is hidden'}</span></span>
          <span className={`relative h-5 w-9 rounded-full transition-colors ${mascotEnabled ? 'bg-audio' : 'bg-surface-card border border-control'}`} aria-hidden="true"><span className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${mascotEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} /></span>
        </button>
      </section>
    </Modal>
  )
}
