import { useEffect, useState, type RefObject } from 'react'
import { useAudioActivity } from '../../lib/audio/AudioActivityContext'
import { Pause as PauseIcon, Play as PlayIcon } from 'lucide-react'
import AudioSeekBar from './AudioSeekBar'
import { AppTooltip } from '../ui/Tooltip'

interface Props {
  src: string
  durationS: number | null
  label: string
  /** Owned by the row so its script and transport readouts can watch this
   * same audio element. */
  audioRef: RefObject<HTMLAudioElement | null>
}

/** Custom transport for a generated voiceover: play/pause plus a compact
 * seek slider. The hidden <audio> reports into AudioActivityContext so the orb
 * and live meter keep reacting.
 *
 * TransportTime renders the position and total on the row's transport line,
 * off the same audio element. The sample rate
 * used to sit here and is gone -- it told the user nothing they could act on
 * (it is always the model's 24kHz). */
export default function VoiceoverPlayer({
  src,
  durationS,
  label,
  audioRef,
}: Props) {
  const { setActiveAudio, releaseAudio } = useAudioActivity()
  const [playing, setPlaying] = useState(false)
  // Stop the audio when this row goes away. Nothing else does.
  //
  // releaseAudio is wired only to the element's onPause/onEnded handlers, and
  // neither fires when React removes the element -- a detached media element
  // keeps playing in Chrome. So a playing voiceover whose row disappeared went
  // on playing with no transport anywhere to stop it, while
  // AudioActivityContext still held it as the active element and AudioEngine
  // stayed attached to a node no longer in the document.
  //
  // Two ways to reach that, both recent: deleting a voiceover (the undo-delete
  // hides the row at once) and typing a search that filters the playing row
  // out of the list.
  //
  // Pause BEFORE release. releaseAudio deliberately ignores an element that is
  // not the current one -- that is how a superseded element's late pause event
  // is discarded -- so if another row has already claimed the slot, the
  // release here is correctly a no-op and must not be forced.
  useEffect(() => {
    const audio = audioRef.current
    return () => {
      if (!audio) return
      audio.pause()
      releaseAudio(audio)
    }
    // Mount/unmount only: audioRef is stable for this row's lifetime, and
    // re-running on every releaseAudio identity change would tear down a live
    // element mid-playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <AppTooltip content={playing ? 'Pause voiceover' : 'Play voiceover'}>
        <button
          type="button"
          className="icon-btn size-6 flex-none border-none bg-transparent text-muted hover:text-audio"
          aria-label={playing ? `Pause ${label}` : `Play ${label}`}
          onClick={toggle}
        >
          {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
        </button>
      </AppTooltip>
      <AudioSeekBar audioRef={audioRef} durationS={durationS} label={label} />
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
          // Rewind on completion, so the row reads as ready to play again
          // rather than spent. PLAYBACK was already correct -- calling play()
          // on an element in the `ended` state seeks to the start first, per
          // the media spec -- but nothing reset currentTime, so the clock sat
          // at "1:06 / 1:06" and the playhead stayed pinned to the right edge
          // until playback actually restarted.
          //
          // Seeking clears `ended` and leaves `paused` true; it does not
          // resume. Done BEFORE releaseAudio so the resulting `seeked` event
          // fires while the element is still wired to AudioActivityContext.
          e.currentTarget.currentTime = 0
          releaseAudio(e.currentTarget)
        }}
        style={{ display: 'none' }}
      />
    </div>
  )
}
