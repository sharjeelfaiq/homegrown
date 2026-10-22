import { useCallback, useEffect, useRef } from 'react'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import { formatTutorialMessage } from '../../lib/messageFormatting'

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
        { popover: { title: formatTutorialMessage('Welcome to Homegrown'), description: formatTutorialMessage('Choose a voice, write a script, and manage results in one studio. Voices sit left on wide screens; cards stack on smaller screens.'), nextBtnText: 'Take the tour' } },
        { element: '[data-tour="header-controls"]', popover: { title: formatTutorialMessage('Settings and help'), description: formatTutorialMessage('Open Settings to choose a theme, show or hide the pet, or find bulk deletion in Danger Zone. Use the help button to replay this tour.'), side: 'bottom', align: 'end' } },
        { element: '[data-tour="voice-controls"]', popover: { title: formatTutorialMessage('Choose or add a voice'), description: formatTutorialMessage('Select a voice by clicking its row. Search, preview, download, rename, or delete voices; use Clone voice or drop multiple audio files here to queue uploads.'), side: 'bottom', align: 'end' } },
        { element: '[data-tour="script-editor"]', popover: { title: formatTutorialMessage('Write the script'), description: formatTutorialMessage('Type or paste what the selected voice should say. Choose its language in the footer; the word count appears at lower right.'), side: 'bottom', align: 'start' } },
        { element: '[data-tour="generate-control"]', popover: { title: formatTutorialMessage('Generate a voiceover'), description: formatTutorialMessage('Generate submits your script, voice, and language when the model is ready. Extra requests join the generation queue. Track active work in Voiceovers; cancel queued jobs there.'), side: 'top', align: 'end' } },
        { element: '[data-tour="voiceovers"]', popover: { title: formatTutorialMessage('Voiceover history'), description: formatTutorialMessage('Completed voiceovers appear here. Play, seek, download, rename, or delete them; Reuse restores the script, voice, and language.'), side: 'top', align: 'start' } },
        { element: '[data-tour="voiceover-search-filters"]', popover: { title: formatTutorialMessage('Search and filter voiceovers'), description: formatTutorialMessage('Search by voiceover or voice name. Open the filter button to narrow results by voice, date range, duration, or generation status.'), side: 'bottom', align: 'end' } },
        { popover: { title: formatTutorialMessage('You are ready'), description: formatTutorialMessage('Choose a voice, write a script, and select its language. Generate to save results in the Voiceovers card below.'), doneBtnText: 'Done' } },
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
