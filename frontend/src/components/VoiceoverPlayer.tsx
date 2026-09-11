import { useEffect, useState, type RefObject } from 'react'
import { useAudioActivity } from '../AudioActivityContext'
import { getPeaks, proceduralPeaks } from '../audio/waveformPeaks'
import { PauseIcon, PlayIcon } from './Icons'
import WaveRibbon from './WaveRibbon'

interface Props {
  src: string
  durationS: number | null
  /** Stable key (entry/job id) seeding the placeholder waveform. */
  entryKey: string
  label: string
  /** Owned by the row, not by this component, so a sibling readout can watch
   * the same element. WaveRibbon already took a ref this way. */
  audioRef: RefObject<HTMLAudioElement | null>
}

/** Custom transport for a generated voiceover: play/pause plus the 2.5D
 * waveform ribbon, which doubles as the seek slider. The hidden <audio> reports
 * into AudioActivityContext exactly like the old native controls, so the orb
 * and live meter keep reacting.
 *
 * Deliberately carries no text readout: TransportTime renders the position and
 * total on the row's third line, off the same audio element. The sample rate
 * used to sit here and is gone -- it told the user nothing they could act on
 * (it is always the model's 24kHz). */
export default function VoiceoverPlayer({
  src,
  durationS,
  entryKey,
  label,
  audioRef,
}: Props) {
  const { setActiveAudio, releaseAudio } = useAudioActivity()
  const [playing, setPlaying] = useState(false)
  const [peaks, setPeaks] = useState<Float32Array>(() => proceduralPeaks(entryKey))
  const [decodedDuration, setDecodedDuration] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    getPeaks(src).then((result) => {
      if (cancelled || !result) return
      setPeaks(result.peaks)
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
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <button
        type="button"
        className="icon-btn size-6 flex-none border-none bg-transparent text-muted hover:text-audio"
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        onClick={toggle}
      >
        {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
      </button>
      <WaveRibbon
        peaks={peaks}
        audioRef={audioRef}
        playing={playing}
        durationS={duration}
        label={label}
      />
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
        onPause={(e) => {
          setPlaying(false)
          releaseAudio(e.currentTarget)
        }}
        onEnded={(e) => {
          setPlaying(false)
          releaseAudio(e.currentTarget)
        }}
        style={{ display: 'none' }}
      />
    </div>
  )
}
