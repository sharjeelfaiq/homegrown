import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { audioEngine } from './audio/AudioEngine'

interface AudioActivityValue {
  activeAudio: HTMLAudioElement | null
  setActiveAudio: (el: HTMLAudioElement | null) => void
}

const AudioActivityContext = createContext<AudioActivityValue | null>(null)

export function AudioActivityProvider({ children }: { children: ReactNode }) {
  const [activeAudio, setActiveAudioState] = useState<HTMLAudioElement | null>(null)
  const currentRef = useRef<HTMLAudioElement | null>(null)

  const setActiveAudio = (el: HTMLAudioElement | null) => {
    currentRef.current = el
    if (el) audioEngine.attach(el)
    setActiveAudioState(el)
  }

  const value = useMemo(() => ({ activeAudio, setActiveAudio }), [activeAudio])

  return <AudioActivityContext.Provider value={value}>{children}</AudioActivityContext.Provider>
}

export function useAudioActivity(): AudioActivityValue {
  const ctx = useContext(AudioActivityContext)
  if (!ctx) {
    throw new Error('useAudioActivity must be used within an AudioActivityProvider')
  }
  return ctx
}
