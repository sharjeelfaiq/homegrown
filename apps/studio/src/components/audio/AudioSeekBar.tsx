import { useEffect, useState, type RefObject } from 'react'
import { formatClock } from '../../lib/format'

/** Low-profile, keyboard-accessible seek control used in compact history rows. */
export default function AudioSeekBar({
  audioRef,
  durationS,
  label,
}: {
  audioRef: RefObject<HTMLAudioElement | null>
  durationS: number | null
  label: string
}) {
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(durationS ?? 0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const sync = () => {
      setPosition(audio.currentTime || 0)
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration)
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
    if (!playing) return
    let frame = 0
    const tick = () => {
      const audio = audioRef.current
      if (audio) setPosition(audio.currentTime || 0)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [audioRef, playing])

  const max = duration > 0 ? duration : 1
  const value = Math.min(max, Math.max(0, position))

  return (
    <input
      type="range"
      min={0}
      max={max}
      step={0.01}
      value={value}
      aria-label={`Seek within ${label}`}
      aria-valuetext={`${formatClock(value)} of ${formatClock(duration)}`}
      className="h-1 min-w-0 flex-1 cursor-pointer accent-audio focus-visible:outline-2 focus-visible:outline-offset-2"
      onChange={(event) => {
        const audio = audioRef.current
        if (!audio || duration <= 0) return
        const next = Number(event.currentTarget.value)
        audio.currentTime = next
        setPosition(next)
      }}
    />
  )
}
