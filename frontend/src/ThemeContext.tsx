import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePrefersDark } from './hooks/usePrefersDark'
import {
  applyTheme,
  readStoredChoice,
  resolveTheme,
  resolveWavePalette,
  sameWavePalette,
  writeStoredChoice,
  STORAGE_KEY,
  isThemeId,
  type ThemeChoice,
  type ThemeId,
  type WavePalette,
} from './theme'

interface ThemeValue {
  /** What the user picked -- may be 'system'. This is what the menu ticks. */
  choice: ThemeChoice
  /** What is actually on screen. Never 'system'. */
  theme: ThemeId
  setChoice: (next: ThemeChoice) => void
  /** Resolved canvas colours; see resolveWavePalette in theme.ts. */
  wave: WavePalette
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredChoice())
  const systemDark = usePrefersDark()
  const theme = resolveTheme(choice, systemDark)

  // Seeded synchronously rather than in an effect. Child effects run BEFORE
  // parent effects, so a provider-level effect would be too late: every
  // ribbon already mounted would paint once with a stale palette and only
  // then be corrected. index.html's blocking script has already written the
  // correct data-theme before React boots, so resolving during this first
  // render is already reading the right theme.
  const [wave, setWave] = useState<WavePalette>(() => resolveWavePalette())

  useLayoutEffect(() => {
    applyTheme(theme)
    // Re-read AFTER the attribute lands. getComputedStyle flushes pending
    // style, so this observes the new theme, and useLayoutEffect means it
    // happens before paint -- no frame of old-colour waveform.
    const next = resolveWavePalette()
    // Compare by value, keep the old object when equal. Without this,
    // StrictMode's double-invoke would hand every ribbon a fresh object
    // identity and repaint the whole history list twice on mount.
    setWave((prev) => (sameWavePalette(prev, next) ? prev : next))
  }, [theme])

  // Two tabs on the same machine -- which the LAN deployment makes ordinary,
  // not exotic -- should not disagree about the theme. `storage` only fires
  // in the OTHER tabs, so this cannot loop back on the tab that wrote.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      const next = e.newValue
      setChoiceState(next === 'system' || isThemeId(next) ? next : 'system')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next)
    writeStoredChoice(next)
  }, [])

  const value = useMemo(
    () => ({ choice, theme, setChoice, wave }),
    [choice, theme, setChoice, wave],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}

/** Narrow subscription for the canvas, so a ribbon does not re-render when
 *  only `choice` changed (picking Studio while already on Studio via
 *  'system', for instance). */
export function useWavePalette(): WavePalette {
  return useTheme().wave
}
