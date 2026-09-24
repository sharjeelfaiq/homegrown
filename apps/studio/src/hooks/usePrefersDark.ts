import { useEffect, useState } from 'react'

const QUERY = '(prefers-color-scheme: dark)'

/** The OS colour preference, live. Only meaningful while the theme choice is
 *  'system'; the provider reads it unconditionally and ignores it otherwise.
 *
 *  Deliberately identical in shape to usePrefersReducedMotion: the lazy
 *  initialiser reads matchMedia synchronously on first render, so there is no
 *  frame where the app has guessed wrong and then corrected itself. */
export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(QUERY).matches)

  useEffect(() => {
    const mq = window.matchMedia(QUERY)
    const onChange = () => setDark(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return dark
}
