import { useEffect, useState, type CSSProperties } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Clock01Icon } from '@hugeicons/core-free-icons'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

interface Props { ms: number; onUndo: () => void; onComplete?: () => void }

/** A visible, keyboard-accessible fuse for an already-armed undo window. */
export default function FuseButton({ ms, onUndo, onComplete }: Props) {
  const reduced = usePrefersReducedMotion()
  const [remaining, setRemaining] = useState(() => Math.ceil(ms / 1000))
  useEffect(() => {
    const startedAt = Date.now()
    const id = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((ms - (Date.now() - startedAt)) / 1000))
      setRemaining(next)
      if (next === 0) { window.clearInterval(id); onComplete?.() }
    }, 200)
    return () => window.clearInterval(id)
  }, [ms, onComplete])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onUndo() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onUndo])
  return <button type="button" className={`fuse-button ${reduced ? 'fuse-button-reduced' : ''}`} style={{ '--fuse-duration': `${ms}ms` } as CSSProperties} onClick={onUndo} aria-label={`Undo deletion. ${remaining} seconds remaining. Press Escape to undo.`}>
    <HugeiconsIcon icon={Clock01Icon} size={14} strokeWidth={1.8} aria-hidden="true" /><span>Undo</span><span className="mono fuse-button-time" aria-hidden="true">{remaining}</span>
  </button>
}
