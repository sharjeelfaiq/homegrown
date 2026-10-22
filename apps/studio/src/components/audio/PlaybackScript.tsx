import { useEffect, useState, type RefObject } from 'react'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'

/** A compact transcript whose audio-accent colour tracks the played fraction. */
export default function PlaybackScript({
  text,
  audioRef,
  durationS,
  fullText,
}: {
  text: string
  audioRef: RefObject<HTMLAudioElement | null>
  durationS: number | null
  fullText: string
}) {
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const sync = () => {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : durationS ?? 0
      setProgress(duration > 0 ? Math.min(1, Math.max(0, audio.currentTime / duration)) : 0)
      setPlaying(!audio.paused && !audio.ended)
    }

    sync()
    const events = ['play', 'playing', 'pause', 'ended', 'timeupdate', 'seeked', 'loadedmetadata', 'durationchange'] as const
    for (const event of events) audio.addEventListener(event, sync)
    return () => {
      for (const event of events) audio.removeEventListener(event, sync)
    }
  }, [audioRef, durationS])

  useEffect(() => {
    if (!playing || reducedMotion) return
    let frame = 0
    const update = () => {
      const audio = audioRef.current
      const duration = audio && Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : durationS ?? 0
      if (audio && duration > 0) setProgress(Math.min(1, Math.max(0, audio.currentTime / duration)))
      frame = requestAnimationFrame(update)
    }
    frame = requestAnimationFrame(update)
    return () => cancelAnimationFrame(frame)
  }, [audioRef, durationS, playing, reducedMotion])

  return (
    <span className="relative block min-w-0 overflow-hidden pb-1 text-ellipsis whitespace-nowrap text-[12px] text-faint" title={fullText}>
      <span className="relative block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        {text}
        <span
          className="pointer-events-none absolute inset-0 block overflow-hidden text-ellipsis whitespace-nowrap text-audio"
          style={{ clipPath: `inset(0 ${100 - progress * 100}% 0 0)` }}
          aria-hidden="true"
        >
          {text}
        </span>
      </span>
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line" aria-hidden="true">
        <span className="block h-full bg-audio" style={{ width: `${progress * 100}%` }} />
      </span>
    </span>
  )
}
