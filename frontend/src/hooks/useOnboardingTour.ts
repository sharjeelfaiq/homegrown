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
        { popover: { title: 'Welcome to Homegrown', description: 'Create reusable voices and turn scripts into voiceovers—all from this studio.', nextBtnText: 'Take the tour' } },
        { element: '[data-tour="header-controls"]', popover: { title: 'Make it yours', description: 'Switch the studio theme here. This help button is always available when you want to replay the tour.', side: 'bottom', align: 'end' } },
        { element: '[data-tour="voice-controls"]', popover: { title: 'Choose a voice', description: 'Select an existing voice and preview it, or add a short reference clip to create a reusable voice.', side: 'bottom', align: 'end' } },
        { element: '[data-tour="script-editor"]', popover: { title: 'Write the script', description: 'Type what the voice should say. Press / anytime to focus this editor.', side: 'bottom', align: 'start' } },
        { element: '[data-tour="generate-control"]', popover: { title: 'Generate a voiceover', description: 'Choose a voice and add a script, then generate. Ctrl/Cmd + Enter works too.', side: 'top', align: 'start' } },
        { element: '[data-tour="voiceovers"]', popover: { title: 'Follow every voiceover', description: 'See queued and finished work here, play it back, download it, or reuse its script.', side: 'top', align: 'start' } },
        { element: '[data-tour="voiceover-search-filters"]', popover: { title: 'Find past work', description: 'Search voiceovers by name or voice, and narrow the list with filters.', side: 'bottom', align: 'end' } },
        { popover: { title: 'You are ready', description: 'Your voices, draft, and voiceover history stay close at hand. Replay this tour from the help button whenever you need it.', doneBtnText: 'Done' } },
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
