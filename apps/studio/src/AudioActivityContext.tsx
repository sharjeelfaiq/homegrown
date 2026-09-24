import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { audioEngine } from './audio/AudioEngine'

interface AudioActivityValue {
  activeAudio: HTMLAudioElement | null
  /** Adopt `el` as the one playing element, pausing whatever was playing. */
  setActiveAudio: (el: HTMLAudioElement) => void
  /** Give up the active slot, but only if `el` still holds it. */
  releaseAudio: (el: HTMLAudioElement) => void
}

const AudioActivityContext = createContext<AudioActivityValue | null>(null)

export function AudioActivityProvider({ children }: { children: ReactNode }) {
  const [activeAudio, setActiveAudioState] = useState<HTMLAudioElement | null>(null)
  const currentRef = useRef<HTMLAudioElement | null>(null)

  /** Starting playback stops whatever else was playing.
   *
   * Two voiceovers, or a voiceover and a voice audition, talking over each
   * other, is never what anyone wants -- and comparing two voices means
   * starting the second without hunting for the first's pause button. */
  const setActiveAudio = useCallback((el: HTMLAudioElement) => {
    const previous = currentRef.current
    // Claim the slot BEFORE pausing: pause() dispatches its `pause` event
    // asynchronously, and the outgoing element's handler calls releaseAudio.
    // With the ref already repointed, that late release is correctly ignored
    // instead of clearing the element that just started.
    currentRef.current = el
    if (previous && previous !== el) {
      previous.pause()
    }
    audioEngine.attach(el)
    setActiveAudioState(el)
  }, [])

  const releaseAudio = useCallback((el: HTMLAudioElement) => {
    if (currentRef.current !== el) return // a superseded element's late event
    currentRef.current = null
    setActiveAudioState(null)
  }, [])

  const value = useMemo(
    () => ({ activeAudio, setActiveAudio, releaseAudio }),
    [activeAudio, setActiveAudio, releaseAudio],
  )

  return <AudioActivityContext.Provider value={value}>{children}</AudioActivityContext.Provider>
}

export function useAudioActivity(): AudioActivityValue {
  const ctx = useContext(AudioActivityContext)
  if (!ctx) {
    throw new Error('useAudioActivity must be used within an AudioActivityProvider')
  }
  return ctx
}
