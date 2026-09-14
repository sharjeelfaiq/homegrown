import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { useTheme } from '../ThemeContext'
import { THEMES, type ThemeId } from '../theme'
import { CheckIcon, ThemeIcon } from './Icons'
import OptionWheel from './OptionWheel'

interface MenuPos {
  top: number
  right: number
}

/** Theme picker, in the header. A menu rather than a two-state toggle because
 * there are nine themes plus System, and a toggle has nowhere to put them.
 *
 * NO TRANSFORM ON THE ROOT, and that is load-bearing twice over. It used to
 * centre itself with `top-1/2 -translate-y-1/2`, and a transform does two
 * things a transform is not usually wanted for:
 *
 *  - it creates a STACKING CONTEXT, which trapped the menu's z-150 inside a
 *    root that had no z-index of its own. <main> comes later in the DOM with
 *    z-index: auto, so the voiceovers search field painted straight over an
 *    open menu.
 *  - it becomes the CONTAINING BLOCK for `position: fixed` descendants, so the
 *    menu's coordinates -- computed from getBoundingClientRect(), i.e. from the
 *    viewport -- were being resolved against the root's box instead.
 *
 * `inset-y-0 flex items-center` centres it with no transform, and z-150 on the
 * root puts the whole switch above <main> rather than relying on the menu to
 * win a fight it could not reach.
 *
 * Modelled on VoicePicker: same pointerdown-to-close, same Escape handling,
 * same arrow-key walk. Two things differ deliberately -- the roles are
 * menu/menuitemradio rather than VoicePicker's listbox-over-a-role-less-list,
 * and focus moves into the menu on open. A menu button that opens a menu and
 * leaves focus behind is a keyboard dead end. */
export default function ThemeSwitch() {
  const { choice, theme, setChoice } = useTheme()
  const reduced = usePrefersReducedMotion()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  // The menu is position: fixed, so its coordinates come off the trigger's
  // viewport rect at open time.
  //
  // Fixed, NOT absolute: above 1025px the shell is `height: 100svh;
  // overflow: hidden`, so a menu hanging off the header would be clipped to
  // the header's own ~87px box and show about one row. Nothing in the ancestor
  // chain sets transform, filter or contain, so a fixed element escapes the
  // clip without needing a portal.
  //
  // That was checked for ANCESTORS and was true. What it missed is that the
  // ROOT OF THIS COMPONENT used to carry `-translate-y-1/2` itself, which made
  // it the containing block for this fixed menu -- so these viewport
  // coordinates were being resolved against the root's own box. The root no
  // longer transforms; see the note on the component above.
  useLayoutEffect(() => {
    if (!open) return
    const r = triggerRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({
      top: Math.round(r.bottom + 6),
      // clientWidth, not innerWidth: below 1025px the page scrolls, and
      // innerWidth includes the scrollbar, which would push the menu off to
      // the right by its width.
      right: Math.round(document.documentElement.clientWidth - r.right),
    })
  }, [open])

  // Move focus into the active picker only after the fixed menu has viewport
  // coordinates. The wheel owns its own Arrow-key navigation.
  useEffect(() => {
    if (!open || !pos) return
    const initial = menuRef.current?.querySelector<HTMLElement>(
      reduced ? '.theme-menu-pick[aria-checked="true"], .theme-menu-pick' : '.option-wheel',
    )
    initial?.focus()
  }, [open, pos, reduced])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      close()
      triggerRef.current?.focus()
    }
    // The menu is position: fixed, so a scroll underneath it would leave it
    // floating away from its trigger -- closing is more predictable than
    // repositioning, and a scroll means the user has moved on anyway.
    //
    function onScroll(e: Event) {
      if (menuRef.current?.contains(e.target as Node)) return
      close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open, close])

  const active = THEMES.find((t) => t.id === theme)
  // The trigger says what is in effect, but System has to read as System --
  // "Theme: Studio" when the user picked System and the OS is dark would make
  // the menu's tick look wrong.
  const activeLabel = choice === 'system' ? `System (${active?.label ?? theme})` : active?.label
  const wheelItems = useMemo(() => THEMES.map(({ id, label }) => ({ value: id, label })), [])

  function pickWheel(themeId: string) {
    // OptionWheel can only emit values supplied by wheelItems; this guard keeps
    // the theme model narrow if its data ever changes independently.
    if (THEMES.some((item) => item.id === themeId)) setChoice(themeId as ThemeId)
  }

  return (
    <div
      className="absolute inset-y-0 right-(--gutter) z-150 flex items-center font-body text-[13px]/[1.55] font-normal tracking-normal normal-case text-left"
      ref={rootRef}
    >
      {/* Borderless, like every other icon button in the app. It briefly had
          a border and a fill, borrowed from .compose-add -- but that one
          earns its edge by sitting in a strip beside a bordered field. This
          one stands alone in an otherwise empty header, where a box around a
          single glyph reads as a stray element rather than as a control. The
          hover state is what says it is interactive. */}
      <button
        type="button"
        ref={triggerRef}
        className="icon-btn size-8"
        aria-label={`Theme: ${activeLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ThemeIcon size={16} />
      </button>

      {/* The transform goes on the MENU, never on the root -- see the note in
          CLAUDE.md. A transform on the root creates a stacking context and
          becomes the containing block for this `fixed` element, which is what
          once let the search field paint over an open menu and threw the
          getBoundingClientRect coordinates off. The menu itself has no fixed
          descendants, so scaling it is safe.

          Origin is top-right because that is the corner it is anchored to. */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduced ? false : { opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: reduced ? 0 : 0.14, ease: [0.2, 0, 0, 1] }}
            className="fixed z-150 min-w-[208px] origin-top-right rounded-md border border-control bg-surface-card p-1 shadow-(--shadow-menu)"
            ref={menuRef}
            style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }}
          >
            {reduced ? (
              <div className="max-h-[min(60svh,332px)] overflow-y-auto [scrollbar-gutter:stable]">
                {(['dark', 'light'] as const).map((mode) => (
                  <div key={mode} role="group" aria-label={`${mode} themes`}>
                    <div aria-hidden="true" className="mono px-[9px] pt-2 pb-1 text-[10px] tracking-[0.12em] text-faint uppercase">{mode}</div>
                    {THEMES.filter((item) => item.mode === mode).map((item) => (
                      <button key={item.id} type="button" role="radio" aria-checked={choice === item.id} className="theme-menu-pick flex w-full min-h-9 items-start gap-2 rounded-sm px-[9px] py-[7px] text-left text-muted transition-[color,background] duration-(--fast) ease-(--ease) hover:bg-surface-hover hover:text-ink focus-visible:bg-surface-hover focus-visible:text-ink" onClick={() => setChoice(item.id)}>
                        <span className="grid h-[18px] flex-[0_0_12px] place-items-center text-audio" aria-hidden="true">{choice === item.id && <CheckIcon size={12} />}</span>
                        <span className="flex flex-col gap-px">{item.label}<span className="text-[11px] text-faint">{item.hint}</span></span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <OptionWheel items={wheelItems} defaultSelected={theme} onChange={pickWheel} optionSpacing={36} labelSize={14} inset={18} smoothing={160} curve={5} tilt={3} blur={1} fade={0.22} loop={false} draggable reducedMotion={false} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
