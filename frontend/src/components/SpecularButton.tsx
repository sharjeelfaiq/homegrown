import { Mesh, Program, Renderer, Triangle } from 'ogl'
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
} from 'react'
import './SpecularButton.css'

interface SpecularButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  /** Prevents the WebGL layer from animating for motion-sensitive users. */
  reducedMotion?: boolean
}

type Rgb = [number, number, number]

const vertex = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`

const fragment = `
precision highp float;
varying vec2 vUv;
uniform vec2 uPointer;
uniform vec2 uResolution;
uniform vec3 uRim;
uniform float uStrength;

void main() {
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  float distanceToPointer = length((vUv - uPointer) * aspect);
  float highlight = smoothstep(0.68, 0.0, distanceToPointer) * uStrength;
  float edge = 1.0 - min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y)) * 16.0;
  edge = clamp(edge, 0.0, 1.0);
  /* A visible soft pool plus a sharper edge: this is intentionally rendered
     as ordinary alpha, rather than relying on CSS blend modes, which can make
     transparent WebGL canvases disappear on some compositor paths. */
  float alpha = highlight * (0.38 + edge * 0.62);
  gl_FragColor = vec4(uRim, alpha);
}`

function colour(value: string, fallback: Rgb): Rgb {
  const numbers = value.match(/[\d.]+/g)?.map(Number)
  if (!numbers || numbers.length < 3) return fallback
  return [numbers[0] / 255, numbers[1] / 255, numbers[2] / 255]
}

/** CSS custom properties preserve authored `var()` text in computed styles.
 * Resolve them through a real CSS colour property before supplying OGL. */
function tokenColour(host: HTMLElement, token: string, fallback: Rgb): Rgb {
  const probe = document.createElement('span')
  probe.style.color = `var(${token})`
  probe.style.display = 'none'
  host.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return colour(resolved, fallback)
}

/**
 * A normal semantic button with a transparent OGL canvas used solely for its
 * pointer-local rim highlight. CSS owns the button's fill, size, focus and
 * disabled state so it remains useful if WebGL is unavailable.
 */
export default function SpecularButton({
  children,
  className = '',
  disabled = false,
  reducedMotion = false,
  ...buttonProps
}: SpecularButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const button = buttonRef.current
    const canvasHost = canvasRef.current
    if (!button || !canvasHost || disabled || reducedMotion) return

    let renderer: Renderer
    try {
      renderer = new Renderer({ alpha: true, antialias: true, dpr: Math.min(window.devicePixelRatio, 2) })
    } catch {
      return
    }

    const gl = renderer.gl
    const canvas = gl.canvas as HTMLCanvasElement
    canvas.setAttribute('aria-hidden', 'true')
    canvasHost.appendChild(canvas)
    gl.clearColor(0, 0, 0, 0)

    const uniforms = {
      uPointer: { value: [0.5, 0.5] },
      uResolution: { value: [1, 1] },
      uRim: { value: tokenColour(button, '--btn-invert-fg', [1, 1, 1]) },
      uStrength: { value: 0 },
    }
    const program = new Program(gl, { vertex, fragment, uniforms, transparent: true })
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program })
    let frame = 0
    let visible = true
    let inViewport = true
    let target = 0
    let strength = 0

    const resize = () => {
      const rect = button.getBoundingClientRect()
      renderer.setSize(rect.width, rect.height)
      uniforms.uResolution.value = [Math.max(rect.width, 1), Math.max(rect.height, 1)]
    }
    const draw = () => {
      frame = 0
      if (!visible || !inViewport) return
      strength += (target - strength) * 0.18
      if (Math.abs(target - strength) < 0.002) strength = target
      uniforms.uStrength.value = strength
      renderer.render({ scene: mesh })
      if (strength !== target) frame = requestAnimationFrame(draw)
    }
    const requestDraw = () => {
      if (!frame && visible && inViewport) frame = requestAnimationFrame(draw)
    }
    const move = (event: PointerEvent) => {
      const rect = button.getBoundingClientRect()
      const near = event.clientX >= rect.left - 48 && event.clientX <= rect.right + 48
        && event.clientY >= rect.top - 48 && event.clientY <= rect.bottom + 48
      if (!near) {
        target = 0
        button.classList.remove('specular-button--active')
        requestDraw()
        return
      }
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
      const y = 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
      uniforms.uPointer.value = [x, y]
      button.style.setProperty('--specular-x', `${x * 100}%`)
      button.style.setProperty('--specular-y', `${(1 - y) * 100}%`)
      button.classList.add('specular-button--active')
      target = 1
      // A pointer event inside this rectangle is definitive evidence that the
      // control is on-screen. It also avoids an IntersectionObserver delivery
      // delay suppressing the first visible frame.
      inViewport = true
      // Paint the first frame synchronously. Some browser compositor paths
      // defer a newly-created transparent WebGL canvas until a later frame;
      // queuing only rAF left this canvas clear indefinitely.
      draw()
    }
    const visibility = () => {
      visible = !document.hidden
      if (visible) requestDraw()
    }
    const updateTheme = () => {
      uniforms.uRim.value = tokenColour(button, '--btn-invert-fg', [1, 1, 1])
      requestDraw()
    }

    const resizeObserver = new ResizeObserver(resize)
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inViewport = entry.isIntersecting
      if (inViewport) requestDraw()
    })
    const themeObserver = new MutationObserver(updateTheme)
    resizeObserver.observe(button)
    intersectionObserver.observe(button)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    // Track at the document level: a button's own pointermove only fires once
    // the pointer has crossed its edge, which made the approach effect feel
    // unreliable when a child span was the event target.
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('visibilitychange', visibility)
    resize()

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      themeObserver.disconnect()
      document.removeEventListener('pointermove', move)
      document.removeEventListener('visibilitychange', visibility)
      button.classList.remove('specular-button--active')
      button.style.removeProperty('--specular-x')
      button.style.removeProperty('--specular-y')
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
    }
  }, [disabled, reducedMotion])

  return (
    <button
      {...buttonProps}
      ref={buttonRef}
      disabled={disabled}
      className={`specular-button ${className}`}
    >
      <span className="specular-button__canvas" ref={canvasRef} />
      <span className="specular-button__content">{children}</span>
    </button>
  )
}
