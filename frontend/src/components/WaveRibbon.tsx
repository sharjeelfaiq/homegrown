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

/** 2.5D waveform ribbon on a 2D canvas: extruded underside, gradient body,
 * top-edge highlight. Doubles as the seek slider. Draws statically; a rAF
 * loop runs only while this row's audio is playing. */
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

    const drawEnvelope = (from: number, to: number, style: 'base' | 'played') => {
      const x0 = from * W
      const x1 = to * W
      ctx.save()
      ctx.beginPath()
      ctx.rect(x0, 0, x1 - x0, H)
      ctx.clip()

      for (let i = 0; i < n; i++) {
        const x = i * step
        if (x + barW < x0 || x > x1) continue
        const h = Math.max(2, peaks[i] * (H - 8))

        if (style === 'played') {
          ctx.shadowColor = 'rgba(59, 130, 246, 0.5)'
          ctx.shadowBlur = 8
        } else {
          ctx.shadowBlur = 0
        }

        // Pass 1: extrusion underside, offset down.
        ctx.fillStyle = style === 'played' ? 'rgba(30, 58, 138, 0.8)' : 'rgba(0, 0, 0, 0.45)'
        ctx.fillRect(x, mid - h / 2 + 2, barW, h)

        // Pass 2: body with vertical light->dark gradient.
        const grad = ctx.createLinearGradient(0, mid - h / 2, 0, mid + h / 2)
        if (style === 'played') {
          grad.addColorStop(0, 'rgba(147, 197, 253, 0.95)')
          grad.addColorStop(1, 'rgba(37, 99, 235, 0.85)')
        } else {
          grad.addColorStop(0, 'rgba(180, 182, 188, 0.55)')
          grad.addColorStop(1, 'rgba(92, 95, 102, 0.4)')
        }
        ctx.fillStyle = grad
        ctx.fillRect(x, mid - h / 2, barW, h)

        // Pass 3: top-edge highlight.
        ctx.shadowBlur = 0
        ctx.fillStyle = style === 'played' ? 'rgba(219, 234, 254, 0.5)' : 'rgba(255, 255, 255, 0.25)'
        ctx.fillRect(x, mid - h / 2, barW, 1)
      }
      ctx.restore()
    }

    drawEnvelope(0, 1, 'base')
    if (progress > 0) {
      drawEnvelope(0, progress, 'played')
      ctx.fillStyle = 'rgba(59, 130, 246, 0.95)'
      ctx.fillRect(progress * W - 1, 2, 2, H - 4)
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
