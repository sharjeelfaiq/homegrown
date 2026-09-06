import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'

interface Props {
  peaks: Float32Array
  audioRef: RefObject<HTMLAudioElement | null>
  playing: boolean
  /** Fallback duration for aria + seeking before metadata loads. */
  durationS: number | null
  label: string
}

const W = 220
const H = 36

/** Waveform for one voiceover, on a 2D canvas. Doubles as the seek slider:
 * click or drag to scrub, arrow keys to nudge. Draws statically; a rAF loop
 * runs only while this row's audio is playing. */
export default function WaveRibbon({ peaks, audioRef, playing, durationS, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const draggingRef = useRef(false)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== W * dpr) {
      canvas.width = W * dpr
      canvas.height = H * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    const audio = audioRef.current
    const duration = audio?.duration && isFinite(audio.duration) ? audio.duration : (durationS ?? 0)
    const progress = audio && duration > 0 ? Math.min(1, audio.currentTime / duration) : 0

    const mid = H / 2
    const n = peaks.length
    const step = W / n
    const barW = Math.max(1.5, step - 1.2)

    // Canvas can't read CSS custom properties, so the three colours the
    // waveform needs are mirrored from tokens.css here. Keep them in step.
    // The waveform is coloured AT REST, not only once played. An earlier pass
    // painted unplayed audio neutral white and reserved cyan for the played
    // portion -- which meant a voiceover you had not played was grey, and
    // since that is most of them most of the time, the page had no colour in it
    // at all. Unplayed is now dim cyan; playing brightens it.
    const BASE = 'rgba(77, 212, 232, 0.34)' // --accent-2, unplayed
    const ACCENT = '#7ee4f3' // brightened --accent-2, played
    const PLAYHEAD = 'rgba(255, 255, 255, 0.9)'

    const drawEnvelope = (from: number, to: number, style: 'base' | 'played') => {
      const x0 = from * W
      const x1 = to * W
      ctx.save()
      ctx.beginPath()
      ctx.rect(x0, 0, x1 - x0, H)
      ctx.clip()

      // Flat bars: no extrusion, no glow, no gradient. The waveform is the
      // most saturated thing in the app, so it carries the audio accent -- but
      // it still has to sit on the page without shouting. Unplayed is dim cyan,
      // and the played portion brightens behind the playhead, which makes
      // position legible at a glance down a list of voiceovers.
      ctx.shadowBlur = 0
      for (let i = 0; i < n; i++) {
        const x = i * step
        if (x + barW < x0 || x > x1) continue
        const h = Math.max(2, peaks[i] * (H - 8))

        ctx.fillStyle = style === 'played' ? ACCENT : BASE
        ctx.fillRect(x, mid - h / 2, barW, h)
      }
      ctx.restore()
    }

    drawEnvelope(0, 1, 'base')
    if (progress > 0) {
      drawEnvelope(0, progress, 'played')
      ctx.fillStyle = PLAYHEAD
      ctx.fillRect(progress * W - 1, 0, 1, H)
    }
  }, [peaks, audioRef, durationS])

  // Static redraws: new peaks, or progress changes while paused (seek/ended).
  useEffect(() => {
    draw()
    const audio = audioRef.current
    if (!audio) return
    const onStaticUpdate = () => {
      if (!playing) draw()
    }
    audio.addEventListener('timeupdate', onStaticUpdate)
    audio.addEventListener('seeked', onStaticUpdate)
    return () => {
      audio.removeEventListener('timeupdate', onStaticUpdate)
      audio.removeEventListener('seeked', onStaticUpdate)
    }
  }, [draw, playing, audioRef])

  // Smooth progress only while playing.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, draw])

  function seekToFraction(frac: number) {
    const audio = audioRef.current
    if (!audio) return
    const duration = audio.duration && isFinite(audio.duration) ? audio.duration : (durationS ?? 0)
    if (duration <= 0) return
    audio.currentTime = Math.min(duration, Math.max(0, frac * duration))
    draw()
  }

  function fractionFromEvent(e: PointerEvent<HTMLDivElement>): number {
    const rect = e.currentTarget.getBoundingClientRect()
    return (e.clientX - rect.left) / rect.width
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    seekToFraction(fractionFromEvent(e))
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (draggingRef.current) seekToFraction(fractionFromEvent(e))
  }

  function onPointerUp() {
    draggingRef.current = false
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const audio = audioRef.current
    if (!audio) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const delta = e.key === 'ArrowRight' ? 5 : -5
      audio.currentTime = Math.max(0, audio.currentTime + delta)
      draw()
    }
  }

  const audio = audioRef.current
  const duration = audio?.duration && isFinite(audio.duration) ? audio.duration : (durationS ?? 0)

  return (
    <div
      className="wave-ribbon"
      role="slider"
      tabIndex={0}
      aria-label={`Seek within ${label}`}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(audio?.currentTime ?? 0)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: H }} />
    </div>
  )
}
