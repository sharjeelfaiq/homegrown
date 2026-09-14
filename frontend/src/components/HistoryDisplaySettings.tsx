import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { type HistoryDisplayMode } from '../historyDisplay'
import { CheckIcon, SettingsIcon } from './Icons'

interface Props {
  mode: HistoryDisplayMode
  onChange: (mode: HistoryDisplayMode) => void
}

/** Header control deliberately follows ThemeSwitch's fixed-menu behaviour. */
export default function HistoryDisplaySettings({ mode, onChange }: Props) {
  const reduced = usePrefersReducedMotion()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])

  useLayoutEffect(() => {
    if (!open) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: Math.round(rect.bottom + 6), right: Math.round(document.documentElement.clientWidth - rect.right) })
  }, [open])

  useEffect(() => {
    if (!open || !pos) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"], [role="menuitemradio"]')?.focus()
  }, [open, pos])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      close()
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open, close])

  return (
    <div className="relative z-150 font-body text-[13px]/[1.55] font-normal tracking-normal normal-case text-left" ref={rootRef}>
      <button type="button" ref={triggerRef} className="icon-btn size-8" aria-label="Voiceover display settings" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <SettingsIcon size={16} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={reduced ? false : { opacity: 0, scale: 0.97, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, scale: 0.97, y: -4 }} transition={{ duration: reduced ? 0 : 0.14, ease: [0.2, 0, 0, 1] }} className="fixed z-150 min-w-[208px] origin-top-right rounded-md border border-control bg-surface-card p-1 shadow-(--shadow-menu)" ref={menuRef} style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }} role="menu" aria-label="Voiceover display">
            {([['infinite', 'Infinite scroll'], ['paginated', 'Paginated display']] as const).map(([value, label]) => (
              <button key={value} type="button" role="menuitemradio" aria-checked={mode === value} className="flex w-full min-h-9 items-center gap-2 rounded-sm px-[9px] py-[7px] text-left text-muted transition-[color,background] duration-(--fast) ease-(--ease) hover:bg-surface-hover hover:text-ink focus-visible:bg-surface-hover focus-visible:text-ink" onClick={() => { onChange(value); close() }}>
                <span className="grid flex-[0_0_12px] place-items-center text-audio" aria-hidden="true">{mode === value && <CheckIcon size={12} />}</span>
                {label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
