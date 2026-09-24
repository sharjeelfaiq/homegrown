import { useEffect, useRef } from 'react'
import './ParticleText.css'

export type ParticleTextTrigger = 'hover' | 'click' | 'none'

export interface ParticleTextProps {
  text: string
  fontSize?: string | number
  fontWeight?: string | number
  fontFamily?: string
  particleColor?: string
  highlightColor?: string
  particleSize?: number
  density?: number
  scatter?: number
  gatherDuration?: number
  trigger?: ParticleTextTrigger
  className?: string
}

interface Particle {
  x: number
  y: number
  targetX: number
  targetY: number
  offsetX: number
  offsetY: number
  highlight: boolean
}

const randomBetween = (minimum: number, maximum: number) => minimum + Math.random() * (maximum - minimum)

function resolveColor(value: string, rootStyles: CSSStyleDeclaration) {
  const token = value.match(/^var\((--[^,)]+)(?:,[^)]+)?\)$/)?.[1]
  return token ? rootStyles.getPropertyValue(token).trim() || value : value
}

/** A compact canvas wordmark that samples its own text into interactive particles. */
export default function ParticleText({
  text,
  fontSize = '2rem',
  fontWeight = 600,
  fontFamily = 'sans-serif',
  particleColor = 'currentColor',
  highlightColor = particleColor,
  particleSize = 1.35,
  density = 3,
  scatter = 18,
  gatherDuration = 380,
  trigger = 'hover',
  className = '',
}: ParticleTextProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let reducedMotion = media.matches
    let particles: Particle[] = []
    let hovered = false
    let pointer: { x: number; y: number } | null = null
    let lastFrame = performance.now()
    let mounted = true
    let primary = particleColor
    let highlight = highlightColor

    const updateColors = () => {
      const styles = getComputedStyle(document.documentElement)
      primary = resolveColor(particleColor, styles)
      highlight = resolveColor(highlightColor, styles)
    }

    const measure = () => {
      const bounds = canvas.getBoundingClientRect()
      const scale = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(bounds.width * scale))
      const height = Math.max(1, Math.round(bounds.height * scale))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      context.setTransform(scale, 0, 0, scale, 0, 0)
      const fontSizePixels = typeof fontSize === 'number'
        ? fontSize
        : Number.parseFloat(getComputedStyle(canvas).fontSize)
      const resolvedFamily = resolveColor(fontFamily, getComputedStyle(document.documentElement))
      context.font = `${fontWeight} ${fontSizePixels}px ${resolvedFamily}`
      context.textAlign = 'center'
      context.textBaseline = 'middle'

      const sample = document.createElement('canvas')
      sample.width = canvas.width
      sample.height = canvas.height
      const sampleContext = sample.getContext('2d', { willReadFrequently: true })
      if (!sampleContext) return
      sampleContext.setTransform(scale, 0, 0, scale, 0, 0)
      sampleContext.font = context.font
      sampleContext.textAlign = 'center'
      sampleContext.textBaseline = 'middle'
      sampleContext.fillStyle = '#fff'
      sampleContext.fillText(text, bounds.width / 2, bounds.height / 2)

      const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data
      const next: Particle[] = []
      const step = Math.max(2, Math.round(density * scale))
      for (let y = 0; y < sample.height; y += step) {
        for (let x = 0; x < sample.width; x += step) {
          if (pixels[(y * sample.width + x) * 4 + 3] < 100) continue
          const targetX = x / scale
          const targetY = y / scale
          next.push({
            x: targetX,
            y: targetY,
            targetX,
            targetY,
            offsetX: randomBetween(-scatter, scatter),
            offsetY: randomBetween(-scatter, scatter),
            highlight: Math.random() < 0.14,
          })
        }
      }
      particles = next
    }

    const draw = (now: number) => {
      const bounds = canvas.getBoundingClientRect()
      const elapsed = Math.min(32, now - lastFrame)
      lastFrame = now
      context.clearRect(0, 0, bounds.width, bounds.height)
      const active = !reducedMotion && hovered
      const ease = reducedMotion ? 1 : Math.min(1, elapsed / Math.max(1, gatherDuration))
      for (const particle of particles) {
        const destinationX = particle.targetX + (active ? particle.offsetX : 0)
        const destinationY = particle.targetY + (active ? particle.offsetY : 0)
        particle.x += (destinationX - particle.x) * ease
        particle.y += (destinationY - particle.y) * ease
        if (!reducedMotion && pointer) {
          const dx = particle.x - pointer.x
          const dy = particle.y - pointer.y
          const distance = Math.hypot(dx, dy)
          if (distance > 0 && distance < 34) {
            particle.x += (dx / distance) * (34 - distance) * 0.08
            particle.y += (dy / distance) * (34 - distance) * 0.08
          }
        }
        context.fillStyle = particle.highlight ? highlight : primary
        context.beginPath()
        context.arc(particle.x, particle.y, particleSize, 0, Math.PI * 2)
        context.fill()
      }
      frameRef.current = requestAnimationFrame(draw)
    }

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(canvas)
    const rootObserver = new MutationObserver(updateColors)
    rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    const fontReady = document.fonts?.ready.then(() => { if (mounted) measure() })
    const onMotionChange = (event: MediaQueryListEvent) => { reducedMotion = event.matches }
    const onEnter = () => { if (trigger === 'hover') hovered = true }
    const onLeave = () => { hovered = false; pointer = null }
    const onClick = () => { if (trigger === 'click') hovered = !hovered }
    const onMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect()
      pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    }
    updateColors()
    measure()
    frameRef.current = requestAnimationFrame(draw)
    canvas.addEventListener('pointerenter', onEnter)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('click', onClick)
    media.addEventListener('change', onMotionChange)

    return () => {
      mounted = false
      void fontReady
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      resizeObserver.disconnect()
      rootObserver.disconnect()
      canvas.removeEventListener('pointerenter', onEnter)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('click', onClick)
      media.removeEventListener('change', onMotionChange)
    }
  }, [density, fontFamily, fontSize, fontWeight, gatherDuration, highlightColor, particleColor, particleSize, scatter, text, trigger])

  return (
    <span className={`particle-text ${className}`} style={{ fontSize: typeof fontSize === 'number' ? `${fontSize}px` : fontSize, fontFamily }}>
      <canvas ref={canvasRef} className="particle-text__canvas" aria-hidden="true">
        {text}
      </canvas>
      <span className="particle-text__label">{text}</span>
    </span>
  )
}
