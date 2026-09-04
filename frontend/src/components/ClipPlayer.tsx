import { useEffect, useRef, useState } from 'react'
import { useAudioActivity } from '../AudioActivityContext'
import { getPeaks, proceduralPeaks } from '../audio/waveformPeaks'
import { formatDuration } from '../format'
import { PauseIcon, PlayIcon } from './Icons'
import WaveRibbon from './WaveRibbon'

interface Props {
  src: string
  durationS: number | null
  /** Stable key (entry/job id) seeding the placeholder waveform. */
  entryKey: string
  label: string
}

/** Custom transport for a generated clip: play/pause, 2.5D waveform ribbon
 * (doubles as the seek slider), and a mono data readout. The hidden <audio>
 * reports into AudioActivityContext exactly like the old native controls,
 * so the orb and live meter keep reacting. */
export default function ClipPlayer({ src, durationS, entryKey, label }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const { setActiveAudio } = useAudioActivity()
  const [playing, setPlaying] = useState(false)
  const [peaks, setPeaks] = useState<Float32Array>(() => proceduralPeaks(entryKey))
  const [sampleRate, setSampleRate] = useState<number | null>(null)
  const [decodedDuration, setDecodedDuration] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    getPeaks(src).then((result) => {
      if (cancelled || !result) return
      setPeaks(result.peaks)
      setSampleRate(result.sampleRate)
      setDecodedDuration(result.duration)
    })
    return () => {
      cancelled = true
    }
  }, [src])

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }

  const duration = durationS ?? decodedDuration

  return (
    <div className="clip-player">
      <button
        type="button"
        className="icon-btn clip-play-btn"
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        onClick={toggle}
      >
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
      </button>
      <WaveRibbon
        peaks={peaks}
        audioRef={audioRef}
        playing={playing}
        durationS={duration}
        label={label}
      />
      <span className="mono clip-readout">
        {duration != null ? formatDuration(duration) : '--:--'}
        {sampleRate != null && ` · ${(sampleRate / 1000).toFixed(1)} kHz`}
      </span>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        crossOrigin="anonymous"
        ref={audioRef}
        src={src}
        preload="none"
        onPlay={(e) => {
          setPlaying(true)
          setActiveAudio(e.currentTarget)
        }}
        onPause={() => {
          setPlaying(false)
          setActiveAudio(null)
        }}
        onEnded={() => {
          setPlaying(false)
          setActiveAudio(null)
        }}
        style={{ display: 'none' }}
      />
    </div>
  )
}
