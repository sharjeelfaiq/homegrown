import { useEffect, useRef } from 'react'
import { useAudioActivity } from '../AudioActivityContext'
import { useGenerationActivity } from '../GenerationActivityContext'
import { audioEngine } from '../audio/AudioEngine'
import { usePageVisible } from '../hooks/usePageVisible'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

const MIN_BARS = 24
const BAR_PITCH = 14 // px per bar (width + gap), used to size bar count to the canvas

/** Slim console-style live meter. Three states: idle whisper, processing
 * pulse (queue running), live spectrum (shared analyser). All signal
 * sources live in AudioEngine / GenerationActivityContext. */
export default function AudioWaveform() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { activeAudio } = useAudioActivity()
  const { anyRunning } = useGenerationActivity()
  const pageVisible = usePageVisible()
  const reducedMotion = usePrefersReducedMotion()

  const activeRef = useRef(activeAudio)
  activeRef.current = activeAudio
  const runningRef = useRef(anyRunning)
  runningRef.current = anyRunning

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    let width = 0
    let height = 0

    function resize() {
      const rect = container!.getBoundingClientRect()
      width = rect.width
      height = rect.height
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas!.width = width * dpr
      canvas!.height = height * dpr
      ctx2d!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(() => {
      resize()
      if (reducedMotion) drawFrame(0)
    })
    ro.observe(container)

    let frame = 0
    let raf = 0

    function drawFrame(f: number) {
      ctx2d!.clearRect(0, 0, width, height)

      const barCount = Math.max(MIN_BARS, Math.floor(width / BAR_PITCH))
      const el = activeRef.current
      const data = el && !el.paused ? audioEngine.getFrequencyData() : null
      let amplitudes: number[]

      if (reducedMotion) {
        // Static frame: fixed mid-height contour, no animation.
        amplitudes = Array.from({ length: barCount }, (_, i) => 0.18 + 0.1 * Math.abs(Math.sin(i * 0.35)))
      } else if (data) {
        amplitudes = Array.from({ length: barCount }, (_, i) => {
          const idx = Math.floor((i / barCount) * data.length)
          return data[idx] / 255
        })
      } else if (runningRef.current) {
        amplitudes = Array.from({ length: barCount }, (_, i) => {
          const t = f * 0.09 + i * 0.5
          return 0.32 + 0.34 * Math.abs(Math.sin(t))
        })
      } else {
        amplitudes = Array.from({ length: barCount }, (_, i) => {
          const t = f * 0.02 + i * 0.35
          return 0.1 + 0.08 * Math.abs(Math.sin(t))
        })
      }

      const gap = 3
      const barWidth = Math.max(2, width / barCount - gap)

      for (let i = 0; i < barCount; i++) {
        const amp = amplitudes[i]
        const barHeight = Math.max(2, amp * height * 0.85)
        const x = i * (barWidth + gap)
        const y = (height - barHeight) / 2

        // Pseudo-3D: bars near center read taller/brighter, edges recede.
        const centerFactor = 1 - Math.abs(i - barCount / 2) / (barCount / 2)
        const alpha = 0.35 + 0.55 * centerFactor
        const radius = Math.min(barWidth / 2, 3)

        const grad = ctx2d!.createLinearGradient(0, y, 0, y + barHeight)
        grad.addColorStop(0, `rgba(59, 130, 246, ${alpha})`)
        grad.addColorStop(1, `rgba(37, 99, 235, ${alpha * 0.7})`)

        ctx2d!.fillStyle = grad
        ctx2d!.shadowColor = 'rgba(59, 130, 246, 0.45)'
        ctx2d!.shadowBlur = 8 * centerFactor + 2

        ctx2d!.beginPath()
        ctx2d!.moveTo(x, y + radius)
        ctx2d!.arcTo(x, y, x + radius, y, radius)
        ctx2d!.lineTo(x + barWidth - radius, y)
        ctx2d!.arcTo(x + barWidth, y, x + barWidth, y + radius, radius)
        ctx2d!.lineTo(x + barWidth, y + barHeight - radius)
        ctx2d!.arcTo(x + barWidth, y + barHeight, x + barWidth - radius, y + barHeight, radius)
        ctx2d!.lineTo(x + radius, y + barHeight)
        ctx2d!.arcTo(x, y + barHeight, x, y + barHeight - radius, radius)
        ctx2d!.closePath()
        ctx2d!.fill()
      }
    }

    if (reducedMotion || !pageVisible) {
      drawFrame(0)
      return () => ro.disconnect()
    }

    function loop() {
      frame++
      drawFrame(frame)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [reducedMotion, pageVisible])

  return (
    <div className="waveform-meter" ref={containerRef}>
      <canvas ref={canvasRef} />
    </div>
  )
}
