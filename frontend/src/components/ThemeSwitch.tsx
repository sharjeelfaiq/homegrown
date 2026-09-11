import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useTheme } from '../ThemeContext'
import { THEMES, type ThemeChoice } from '../theme'
import { CheckIcon, ThemeIcon } from './Icons'

interface MenuPos {
  top: number
  right: number
}

/** Theme picker, in the header. A menu rather than a two-state toggle because
 * there are five themes plus System, and a toggle has nowhere to put them.
 *
 * Modelled on VoicePicker: same pointerdown-to-close, same Escape handling,
 * same arrow-key walk. Two things differ deliberately -- the roles are
 * menu/menuitemradio rather than VoicePicker's listbox-over-a-role-less-list,
 * and focus moves into the menu on open. A menu button that opens a menu and
 * leaves focus behind is a keyboard dead end. */
export default function ThemeSwitch() {
  const { choice, theme, setChoice } = useTheme()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)

  const close = useCallback(() => setOpen(false), [])

  const closeAndReturnFocus = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  // The menu is position: fixed, so its coordinates come off the trigger's
  // viewport rect at open time.
  //
  // Fixed, NOT absolute: above 1025px `.studio` is `height: 100svh;
  // overflow: hidden`, so a menu hanging off the header would be clipped to
  // the header's own ~87px box and show about one row. Nothing in the
  // ancestor chain sets transform, filter or contain -- checked -- so a fixed
  // element escapes the clip without needing a portal.
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

  // Move focus into the menu once it is positioned, onto the checked row.
  useEffect(() => {
    if (!open || !pos) return
    const picks = menuRef.current?.querySelectorAll<HTMLButtonElement>('.theme-menu-pick')
    if (!picks?.length) return
    const checked = Array.from(picks).find((b) => b.getAttribute('aria-checked') === 'true')
    ;(checked ?? picks[0]).focus()
  }, [open, pos])

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
    // Reposition is not worth it -- closing is more predictable, and both of
    // these mean the user has stopped interacting with the menu anyway.
    // Scroll is captured because below 1025px the scroller is the page and
    // above it the results list, and this way neither needs special-casing.
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

  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLUListElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const picks = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('.theme-menu-pick') ?? [],
    )
    if (picks.length === 0) return
    e.preventDefault()
    const at = picks.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1
    picks[(next + picks.length) % picks.length].focus()
  }

  function pick(next: ThemeChoice) {
    setChoice(next)
    closeAndReturnFocus()
  }

  const active = THEMES.find((t) => t.id === theme)
  // The trigger says what is in effect, but System has to read as System --
  // "Theme: Studio" when the user picked System and the OS is dark would make
  // the menu's tick look wrong.
  const activeLabel = choice === 'system' ? `System (${active?.label ?? theme})` : active?.label

  return (
    <div
      className="absolute top-1/2 right-(--gutter) -translate-y-1/2 font-body text-[13px]/[1.55] font-normal tracking-normal normal-case text-left"
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
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ThemeIcon size={16} />
      </button>

      {open && (
        <ul
          className="fixed z-150 m-0 min-w-[208px] list-none rounded-md border border-control bg-surface-card p-1 shadow-(--shadow-menu)"
          ref={menuRef}
          role="menu"
          aria-label="Theme"
          onKeyDown={onMenuKeyDown}
          style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }}
        >
          {THEMES.map((t) => (
            <li key={t.id} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={choice === t.id}
                className="theme-menu-pick flex w-full min-h-9 items-start gap-2 rounded-sm px-[9px] py-[7px] text-left text-muted transition-[color,background] duration-(--fast) ease-(--ease) hover:bg-surface-hover hover:text-ink focus-visible:bg-surface-hover focus-visible:text-ink"
                onClick={() => pick(t.id)}
              >
                <span className="grid h-[18px] flex-[0_0_12px] place-items-center text-audio" aria-hidden="true">
                  {choice === t.id && <CheckIcon size={12} />}
                </span>
                <span className="flex flex-col gap-px">
                  {t.label}
                  <span className="text-[11px] text-faint">{t.hint}</span>
                </span>
              </button>
            </li>
          ))}
          <li role="none">
            <hr className="my-1 h-0 border-0 border-t border-hairline" />
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={choice === 'system'}
              className="theme-menu-pick flex w-full min-h-9 items-start gap-2 rounded-sm px-[9px] py-[7px] text-left text-muted transition-[color,background] duration-(--fast) ease-(--ease) hover:bg-surface-hover hover:text-ink focus-visible:bg-surface-hover focus-visible:text-ink"
              onClick={() => pick('system')}
            >
              <span className="grid h-[18px] flex-[0_0_12px] place-items-center text-audio" aria-hidden="true">
                {choice === 'system' && <CheckIcon size={12} />}
              </span>
              <span className="flex flex-col gap-px">
                System
                <span className="text-[11px] text-faint">Follows your OS setting</span>
              </span>
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}
