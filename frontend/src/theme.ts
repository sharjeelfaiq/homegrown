/* Theme model and DOM application. No React in here on purpose -- the
 * provider in ThemeContext.tsx owns the React lifecycle, this owns the
 * definition of what a theme is and what applying one does to the document.
 *
 * THE LIST BELOW IS MIRRORED in frontend/index.html's pre-paint script, and
 * it has to be. That script decides the theme before the first frame, which
 * means before any module has loaded, so it cannot import from here and stay
 * blocking. Same convention as launcher.py mirroring the palette: the mirror
 * is unavoidable, the drift is not -- add a theme and you touch both.
 *
 * The two never disagree at runtime because they read the same key, validate
 * the same way, and fall back the same way. applyTheme() then writes exactly
 * what the script already wrote, so booting causes no attribute change, no
 * style invalidation and no second paint.
 */

export type ThemeId = 'studio' | 'daylight' | 'tape' | 'greenroom' | 'booth'

/** What the user picked. 'system' is a real choice, not a theme. */
export type ThemeChoice = ThemeId | 'system'

export interface ThemeMeta {
  id: ThemeId
  label: string
  mode: 'dark' | 'light'
  /** One line, shown under the name in the menu. */
  hint: string
}

export const THEMES: readonly ThemeMeta[] = [
  { id: 'studio', label: 'Studio', mode: 'dark', hint: 'Charcoal and cyan' },
  { id: 'daylight', label: 'Daylight', mode: 'light', hint: 'Neutral, bright' },
  { id: 'tape', label: 'Tape', mode: 'light', hint: 'Warm paper and rust' },
  { id: 'greenroom', label: 'Greenroom', mode: 'dark', hint: 'Deep green and jade' },
  { id: 'booth', label: 'Booth', mode: 'dark', hint: 'Near-black, on air' },
] as const

export const DEFAULT_THEME: ThemeId = 'studio'

const BY_ID = new Map(THEMES.map((t) => [t.id, t]))

export const STORAGE_KEY = 'homegrown-theme'

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && BY_ID.has(value as ThemeId)
}

export function themeMode(id: ThemeId): 'dark' | 'light' {
  return BY_ID.get(id)?.mode ?? 'dark'
}

/** Read the stored CHOICE. Anything unrecognised degrades to 'system'. */
export function readStoredChoice(): ThemeChoice {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Private browsing and some locked-down configurations throw on read.
    // Not being able to remember a preference is not a reason to fail.
    return 'system'
  }
  if (raw === 'system') return 'system'
  return isThemeId(raw) ? raw : 'system'
}

export function writeStoredChoice(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    // Same as above. The switcher still works for this session.
  }
}

/** Collapse a choice plus the OS preference into the theme actually shown. */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ThemeId {
  if (choice !== 'system') return choice
  return systemPrefersDark ? 'studio' : 'daylight'
}

/* ---- Waveform palette ---------------------------------------------------
 *
 * The canvas cannot read CSS custom properties. That is why WaveRibbon.tsx
 * used to carry three hand-mirrored colour literals, and why the drift guard
 * in scripts/ exists at all.
 *
 * It cannot be fixed by reading the tokens directly either: an unregistered
 * custom property computes to its *token sequence*, so
 * getComputedStyle(html).getPropertyValue('--wave-base') hands back the
 * literal text "color-mix(in srgb, rgb(77, 212, 232) 34%, transparent)" --
 * var() substituted, color-mix NOT evaluated. Assigning that to fillStyle is
 * a no-op, and a no-op assignment silently leaves the PREVIOUS colour in
 * place, so the failure would look like "the theme didn't change" rather
 * than like an error.
 *
 * Real colour properties do resolve, at computed-value time. So the three
 * tokens go onto three real properties of one throwaway element and come
 * back as rgb()/rgba() strings, which fillStyle has always accepted.
 *
 * One element, three reads off one CSSStyleDeclaration: a single style
 * recalc per theme change for the whole page. The obvious alternative --
 * getComputedStyle inside each ribbon -- is up to twenty forced recalcs to
 * answer one question, since that is how many the history window mounts.
 */

export interface WavePalette {
  base: string
  played: string
  playhead: string
}

const PROBE_STYLE =
  'position:absolute;left:-9999px;top:0;width:0;height:0;' +
  'color:var(--wave-base);' +
  'border-top-color:var(--wave-played);' +
  'background-color:var(--wave-playhead);'

const RESOLVED = /^(rgb|color|#)/

export function resolveWavePalette(): WavePalette {
  const probe = document.createElement('span')
  probe.setAttribute('style', PROBE_STYLE)
  probe.setAttribute('aria-hidden', 'true')
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const palette: WavePalette = {
    base: cs.color,
    played: cs.borderTopColor,
    playhead: cs.backgroundColor,
  }
  probe.remove()

  if (import.meta.env.DEV) {
    for (const [k, v] of Object.entries(palette)) {
      if (!RESOLVED.test(v)) {
        // Not a hard failure: fillStyle will ignore it and the ribbon keeps
        // its previous colour, which is survivable. Worth shouting about in
        // dev though, because the symptom is invisible.
        console.warn(
          `[theme] --wave-${k} did not resolve to a colour (got ${v || 'empty'}). ` +
            'The waveform will not follow the theme.',
        )
      }
    }
  }
  return palette
}

export function sameWavePalette(a: WavePalette, b: WavePalette): boolean {
  return a.base === b.base && a.played === b.played && a.playhead === b.playhead
}

/* ---- Applying a theme -------------------------------------------------- */

export function applyTheme(theme: ThemeId): void {
  const el = document.documentElement
  el.setAttribute('data-theme', theme)
  // index.html sets this inline pre-paint, and an inline style beats every
  // stylesheet rule -- including the per-theme `color-scheme` in tokens.css.
  // So it has to be kept in step here or the first switch would leave native
  // scrollbars and form controls on the old theme's scheme forever.
  el.style.colorScheme = themeMode(theme)

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (meta) {
    // --bg-nav is a plain hex in every theme block, not a color-mix(), so the
    // computed custom property is usable as-is and needs no probe.
    const nav = getComputedStyle(el).getPropertyValue('--bg-nav').trim()
    if (nav) meta.content = nav
  }
}
