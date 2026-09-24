import { useEffect, useRef } from 'react'
import './CursorGrid.css'

export type CursorGridFalloff = 'linear' | 'smooth'

export interface CursorGridProps {
  /** A CSS colour or token. `var(--accent)` is resolved before Canvas draws. */
  color?: string
  cellSize?: number
  radius?: number
  falloff?: CursorGridFalloff
  holdTime?: number
  fadeDuration?: number
  lineWidth?: number
  maxOpacity?: number
  fillOpacity?: number
  gridOpacity?: number
  cellRadius?: number
  clickPulse?: boolean
  pulseSpeed?: number
  className?: string
}

type Point = { x: number; y: number; until: number }
type Pulse = { x: number; y: number; started: number }
type Rgb = readonly [number, number, number]

const FALLBACK: Rgb = [255, 255, 255]

function resolveCanvasColor(value: string): Rgb {
  const probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = `position:absolute;left:-9999px;top:0;color:${value}`
  document.body.appendChild(probe)
  const computed = getComputedStyle(probe).color
  probe.remove()

  const channels = computed.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3 || channels.some(Number.isNaN)) return FALLBACK
  // Canvas rgba() takes 0..255 channels. `color(srgb …)` is 0..1 while
  // computed rgb() is already 0..255.
  const scale = channels.some((channel) => channel > 1) ? 1 : 255
  return [channels[0] * scale, channels[1] * scale, channels[2] * scale]
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, size: number, radius: number) {
  if (radius <= 0) {
    context.rect(x, y, size, size)
    return
  }
  context.roundRect(x, y, size, Math.min(radius, size / 2))
}

/** A non-interactive Canvas 2D lattice that reacts to window pointer events. */
export default function CursorGrid({
  color = 'var(--accent)',
  cellSize = 64,
  radius = 120,
  falloff = 'smooth',
  holdTime = 300,
  fadeDuration = 600,
  lineWidth = 1,
  maxOpacity = 0.6,
  fillOpacity = 0.04,
  gridOpacity = 0.05,
  cellRadius = 0,
  clickPulse = false,
  pulseSpeed = 600,
  className,
}: CursorGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    let width = 0
    let height = 0
    let dpr = 1
    let frame = 0
    let pointer: Point | null = null
    let pulses: Pulse[] = []
    let rgb = resolveCanvasColor(color)

    const cssColor = (opacity: number) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${opacity})`
    const draw = (now: number, animate = false) => {
      frame = 0
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, height)
      context.lineWidth = lineWidth

      // The lattice is intentionally the sole idle draw. No rAF is retained
      // after this when the pointer and all pulses have expired.
      context.strokeStyle = cssColor(gridOpacity)
      context.beginPath()
      for (let x = 0; x <= width + cellSize; x += cellSize) {
        context.moveTo(x + 0.5, 0)
        context.lineTo(x + 0.5, height)
      }
      for (let y = 0; y <= height + cellSize; y += cellSize) {
        context.moveTo(0, y + 0.5)
        context.lineTo(width, y + 0.5)
      }
      context.stroke()

      const pointerAge = pointer ? now - (pointer.until - holdTime - fadeDuration) : Infinity
      const pointerFade = pointer
        ? pointerAge <= holdTime
          ? 1
          : Math.max(0, 1 - (pointerAge - holdTime) / fadeDuration)
        : 0
      if (pointerFade === 0) pointer = null
      pulses = pulses.filter((pulse) => now - pulse.started < pulseSpeed)

      if (pointer || pulses.length) {
        const minX = Math.max(0, Math.floor(((pointer?.x ?? 0) - radius * 2) / cellSize) * cellSize)
        const maxX = Math.min(width + cellSize, Math.ceil(((pointer?.x ?? width) + radius * 2) / cellSize) * cellSize)
        const minY = Math.max(0, Math.floor(((pointer?.y ?? 0) - radius * 2) / cellSize) * cellSize)
        const maxY = Math.min(height + cellSize, Math.ceil(((pointer?.y ?? height) + radius * 2) / cellSize) * cellSize)

        for (let x = minX; x <= maxX; x += cellSize) {
          for (let y = minY; y <= maxY; y += cellSize) {
            const cx = x + cellSize / 2
            const cy = y + cellSize / 2
            let intensity = 0
            if (pointer) {
              const distance = Math.hypot(cx - pointer.x, cy - pointer.y)
              if (distance < radius) {
                const t = 1 - distance / radius
                intensity = Math.max(intensity, (falloff === 'smooth' ? t * t * (3 - 2 * t) : t) * pointerFade)
              }
            }
            for (const pulse of pulses) {
              const progress = (now - pulse.started) / pulseSpeed
              const ring = radius * 1.35 * progress
              const distance = Math.hypot(cx - pulse.x, cy - pulse.y)
              const widthOfRing = cellSize * 1.25
              const ringIntensity = Math.max(0, 1 - Math.abs(distance - ring) / widthOfRing) * (1 - progress)
              intensity = Math.max(intensity, ringIntensity)
            }
            if (intensity <= 0.001) continue
            context.fillStyle = cssColor(fillOpacity * intensity)
            context.strokeStyle = cssColor(maxOpacity * intensity)
            context.beginPath()
            roundedRect(context, x + lineWidth / 2, y + lineWidth / 2, cellSize - lineWidth, cellRadius)
            context.fill()
            context.stroke()
          }
        }
      }

      if (animate && (pointer || pulses.length)) frame = requestAnimationFrame((time) => draw(time, true))
    }

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame((time) => draw(time, true))
    }
    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      draw(performance.now())
    }
    const onPointerMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY, until: performance.now() + holdTime + fadeDuration }
      schedule()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !clickPulse) return
      pulses.push({ x: event.clientX, y: event.clientY, started: performance.now() })
      schedule()
    }
    const onThemeChange = () => {
      rgb = resolveCanvasColor(color)
      // An already scheduled frame will pick up the new colour. At rest, one
      // immediate lattice repaint is enough.
      if (!frame) draw(performance.now())
    }

    const observer = new ResizeObserver(resize)
    observer.observe(document.documentElement)
    const themeObserver = new MutationObserver(onThemeChange)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    resize()

    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      observer.disconnect()
      themeObserver.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [cellRadius, cellSize, clickPulse, color, fadeDuration, falloff, fillOpacity, gridOpacity, holdTime, lineWidth, maxOpacity, pulseSpeed, radius])

  return <canvas ref={canvasRef} className={`cursor-grid${className ? ` ${className}` : ''}`} aria-hidden="true" />
}
