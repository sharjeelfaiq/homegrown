import { useCallback, useEffect, useRef } from 'react'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

const STORAGE_KEY = 'homegrown-onboarding-tour.v1'

function hasCompletedTour() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null
  } catch {
    return false
  }
}

function rememberTour() {
  try {
    localStorage.setItem(STORAGE_KEY, 'dismissed')
  } catch {
    // Storage is an enhancement: a private or restricted browser can still tour.
  }
}

type StartOptions = { force?: boolean }

/** A deliberately read-only introduction to the studio controls. */
export function useOnboardingTour(modelStatus: 'checking' | 'ready' | 'down') {
  const instanceRef = useRef<Driver | null>(null)
  const startedRef = useRef(false)
  const persistOnDestroyRef = useRef(true)
  const reducedMotion = usePrefersReducedMotion()

  const startTour = useCallback(({ force = false }: StartOptions = {}) => {
    if (instanceRef.current?.isActive() || startedRef.current) return
    if (!force && hasCompletedTour()) return

    startedRef.current = true
    persistOnDestroyRef.current = true
    const instance = driver({
      animate: !reducedMotion,
      duration: reducedMotion ? 0 : 180,
      allowClose: true,
      allowKeyboardControl: true,
      allowScroll: true,
      overlayClickBehavior: 'close',
      smoothScroll: !reducedMotion,
      disableActiveInteraction: false,
      skipMissingElement: true,
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      showButtons: ['previous', 'next', 'close'],
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      popoverClass: 'homegrown-tour',
      onDestroyed: () => {
        if (persistOnDestroyRef.current) rememberTour()
        if (instanceRef.current === instance) instanceRef.current = null
        startedRef.current = false
      },
      steps: [
        { popover: { title: 'Welcome to Homegrown', description: 'Choose a voice, write a script, and manage generated voiceovers in one studio. At wider sizes, Voices sits left while the editor and history stack on the right; on smaller screens, the cards stack.', nextBtnText: 'Take the tour' } },
        { element: '[data-tour="header-controls"]', popover: { title: 'Theme and help', description: 'Switch between the available themes here, or use the help button to replay this tour.', side: 'bottom', align: 'end' } },
        { element: '[data-tour="voice-controls"]', popover: { title: 'Choose or add a voice', description: 'Select a voice by clicking its row. Search, preview, download, rename, or delete voices here; use Clone voice to add one from an audio clip.', side: 'bottom', align: 'end' } },
        { element: '[data-tour="script-editor"]', popover: { title: 'Write the script', description: 'Type or paste what the selected voice should say. The word count appears in the lower-right corner.', side: 'bottom', align: 'start' } },
        { element: '[data-tour="generate-control"]', popover: { title: 'Generate a voiceover', description: 'Generate is at the lower-right of the script card. Select a voice and language, enter a script, and wait for the voice model to be ready before generating. Hover Generate for its keyboard shortcut.', side: 'top', align: 'end' } },
        { element: '[data-tour="voiceovers"]', popover: { title: 'Voiceover history', description: 'Generated voiceovers appear in this card. Play or download a result, reuse its script, and manage its name or deletion from the row actions.', side: 'top', align: 'start' } },
        { element: '[data-tour="voiceover-search-filters"]', popover: { title: 'Search and filter voiceovers', description: 'Search by voiceover or voice name. Open the filter button to narrow results by voice, date range, duration, or generation status.', side: 'bottom', align: 'end' } },
        { popover: { title: 'You are ready', description: 'Choose a voice, write a script, select its language, then generate. Your results stay in the Voiceovers card below the editor. Replay this tour from the help button whenever you need it.', doneBtnText: 'Done' } },
      ],
    })
    instanceRef.current = instance
    instance.drive()
  }, [reducedMotion])

  useEffect(() => {
    if (modelStatus === 'ready') startTour()
  }, [modelStatus, startTour])

  useEffect(() => () => {
    persistOnDestroyRef.current = false
    instanceRef.current?.destroy()
    instanceRef.current = null
    startedRef.current = false
  }, [])

  return { startTour }
}
