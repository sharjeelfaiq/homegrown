/** The Apple modifier is ⌘, everything else is Ctrl.
 *
 * Resolved ONCE at module scope, not per render. It cannot change for the
 * life of the page, and re-deriving it on every keystroke of the script box
 * (which re-renders the composer) would be work for an answer that is already
 * known.
 *
 * navigator.platform is deprecated but is the only one of the three that is
 * universally present; userAgentData is Chromium-only and userAgent lies by
 * design. All three are consulted and any Apple signal wins, because the cost
 * of being wrong is a label reading "Ctrl" on a Mac, not a broken shortcut --
 * useHotkeys accepts `ctrlKey || metaKey` either way.
 *
 * `typeof navigator` is guarded so importing this module cannot throw if it is
 * ever pulled into a non-DOM context.
 */
const APPLE = /mac|iphone|ipad|ipod/i
const isApple =
  typeof navigator !== 'undefined' &&
  (APPLE.test(
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? '',
  ) ||
    APPLE.test(navigator.platform ?? '') ||
    APPLE.test(navigator.userAgent ?? ''))

/** Displayed on the control. */
export const MOD_KEY = isApple ? '⌘' : 'Ctrl'
/** The value `aria-keyshortcuts` wants, which is a fixed vocabulary and NOT
 *  the glyph above: the spec names the key "Meta" / "Control". */
export const MOD_ARIA = isApple ? 'Meta' : 'Control'
