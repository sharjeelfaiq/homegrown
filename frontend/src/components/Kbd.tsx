interface Props {
  children: string
  className?: string
}

/** A key cap.
 *
 * Decorative to assistive tech -- the real information is the
 * `aria-keyshortcuts` on the control this sits inside, which screen readers
 * announce in their own words. Reading the glyph "⌘↩" aloud helps nobody.
 *
 * The platform modifier lives in `src/keys.ts`, not here: a module that
 * exports both a component and a constant is not fast-refresh-safe, which
 * oxlint reports as react/only-export-components. Callers that need it import
 * MOD_KEY / MOD_ARIA from there directly.
 */
export default function Kbd({ children, className = '' }: Props) {
  return (
    <kbd
      aria-hidden="true"
      className={`mono pointer-events-none inline-flex select-none items-center rounded-[3px] border border-hairline-strong px-1 py-px text-[10px]/[1.4] text-faint ${className}`}
    >
      {children}
    </kbd>
  )
}
