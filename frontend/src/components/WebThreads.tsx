import { useEffect, useRef } from 'react'
import { Renderer, Program, Mesh, Triangle } from 'ogl'
import { useGenerationActivity } from '../GenerationActivityContext'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { useTheme } from '../ThemeContext'
import { themeMode } from '../theme'
import type { ThreadRgb } from '../theme'

/** The woven-threads background, adapted from reactbits' WebThreads.
 *
 * Four things differ from the published component, each because of something
 * this repository has already been bitten by:
 *
 *  - **It owns no colours.** The original takes hex strings and converts them
 *    in JS. Every colour here arrives as an 0..1 triple resolved from the
 *    palette (see resolveThreadPalette in theme.ts), because a hex literal
 *    anywhere under frontend/src fails scripts/check_design_tokens.py -- and
 *    more to the point, a hardcoded colour is a background that does not
 *    follow the theme, which is the same bug the waveform once had.
 *
 *  - **The cursor is tracked on `window`, not on the canvas.** This element is
 *    pointer-events: none, so it never receives a mouse event of its own;
 *    listening on it would leave the effect silently dead.
 *
 *  - **It stops while a voiceover is generating.** This shader and the TTS
 *    model share one GPU. The vocoder is already capped to
 *    DECODE_CHUNK_FRAMES=100 because a ~4s kernel tripped Windows' 2s TDR
 *    watchdog and killed the CUDA context; a persistent full-screen fragment
 *    shader is exactly the contention that stretches kernel wall-time on a
 *    display-attached card. Holding the last frame costs nothing.
 *
 *  - **prefers-reduced-motion paints one frame and never starts the loop.**
 *    An infinite rAF is precisely what the tokens.css reduced-motion block
 *    cannot reach -- it only zeroes --fast/--base/--slow.
 */

const vertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const fragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uSpeed;
uniform float uThreadCount;
uniform float uFrequency;
uniform float uSpread;
uniform float uTaper;
uniform float uPosition;
uniform float uGlow;
uniform float uFalloff;
uniform float uThickness;
uniform float uBrightness;
uniform float uOpacity;
uniform float uMirror;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform bool uLightMode;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform float uEnableMouse;
uniform float uMouseActive;
out vec4 fragColor;

#define TAU 6.28318530718
#define MAX_THREADS 10

float glowAt(float x, float str, float dist) {
  return dist / pow(max(x, 1e-4), str);
}

void main() {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float n = max(uThreadCount, 1.0);

  float pinchX = 0.5;
  if (uEnableMouse > 0.5) {
    pinchX = mix(pinchX, uMouse.x, clamp(uMouseStrength, 0.0, 1.0) * uMouseActive);
  }

  float spreadDx = uSpread * abs(uv.x - pinchX);
  float baseT = iTime * uSpeed;
  float tauOverN = TAU / n;
  float mirror = uMirror > 0.5 ? sign(pinchX - uv.x) : 1.0;
  float invThickness = 1.0 / max(uThickness, 0.01);
  float xFreq = uv.x * uFrequency;
  float yOff = uv.y - uPosition;
  float ciScale = n > 1.0 ? 1.0 / (n - 1.0) : 0.0;

  vec3 col = vec3(0.0);
  float gsum = 0.0;

  for (int idx = 0; idx < MAX_THREADS; idx++) {
    float i = float(idx);
    if (i >= n) break;

    float amplitude = spreadDx * (1.0 + i * uTaper);
    float phase = (baseT + i * tauOverN) * mirror;
    float sdf = abs(yOff + sin(xFreq + phase) * amplitude) * invThickness;

    float g = glowAt(sdf, uFalloff, uGlow);
    vec3 threadCol = mix(uColor1, uColor2, i * ciScale);

    col += g * threadCol;
    gsum += g;
  }

  float coreAmt = smoothstep(0.5, 2.2, gsum);
  col = mix(col, uColor3 * gsum, coreAmt * 0.5);

  float bright = uBrightness;
  if (uEnableMouse > 0.5) {
    vec2 md = uv - uMouse;
    float d2 = dot(md, md);
    bright += clamp(uMouseStrength, 0.0, 1.0) * uMouseActive * exp(-d2 * 6.0) * 0.6;
  }
  col *= bright;

  float alpha = clamp(gsum, 0.0, 1.0) * uOpacity;
  vec3 outRgb = col * alpha;

  if (uGrain > 0.5) {
    float gv = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453) - 0.5) * uGrainIntensity;
    outRgb = clamp(outRgb + gv, 0.0, 1.0);
    alpha = clamp(alpha + gv, 0.0, 1.0);
  }

  if (uLightMode) {
    // Light themes paint PIGMENT, not glow -- additive light on a near-white
    // page is invisible, which is what the first two attempts here produced.
    //
    // This deliberately reuses the dark branch's own coverage (clamp(gsum) *
    // uOpacity) rather than tone-mapping its own. The published component
    // re-derived coverage through smoothstep(exp tone map)^2, and at this
    // shader's energy range that collapsed to ~0.0005 alpha: Daylight rendered
    // nothing at all, twice, and the failure is invisible on white rather than
    // obviously broken. Same coverage as dark, inverted in value, is
    // predictable and needs no second set of magic numbers.
    //
    // Premultiplied, because the renderer is premultipliedAlpha: true.
    // LIGHT_SCALE, and it is measured. Dark pigment on a near-white page is far
    // more efficient at shifting a pixel than additive glow on near-black: at
    // one shared opacity the dark themes sat at a mean delta of 1.2/255 while
    // Daylight was at 10.6 and looked muddy. One opacity cannot serve both.
    float a = clamp(gsum, 0.0, 1.0) * uOpacity * 0.16;
    vec3 hue = col / max(max(col.r, max(col.g, col.b)), 1e-4);
    vec3 ink = hue * 0.42;
    fragColor = vec4(ink * a, a);
  } else {
    fragColor = vec4(outRgb, alpha);
  }
}
`

/** Deliberately quiet. This sits under the whole app, not in empty space, so
 *  the ceiling is "does body text still read cleanly over it", not "does it
 *  look good on its own". */
const SETTINGS = {
  speed: 0.10,
  threadCount: 4,
  frequency: 3.2,
  spread: 0.20,
  taper: 1.0,
  position: 0.5,
  // Low falloff on purpose: it is what turns a thread from a filament into a
  // wash. The published defaults (falloff 0.62, glow 0.016, brightness 0.5,
  // opacity 0.34) drew bright hairlines straight across the voiceover rows --
  // legible text with a lit wire through it, which is the opposite of a
  // background. Wider and much dimmer reads as texture instead.
  glow: 0.024,
  falloff: 0.42,
  thickness: 1.7,
  brightness: 0.75,
  opacity: 0.82,
  grainIntensity: 0.03,
  mouseStrength: 0.25,
}

/** A background has no business at 2x on a 4K panel: the shader is
 *  fragment-bound, with a pow() per thread per pixel. */
const MAX_DPR = 1.5

export default function WebThreads() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { threads, theme } = useTheme()
  const reduced = usePrefersReducedMotion()
  const { anyRunning } = useGenerationActivity()

  // Read inside the loop rather than captured, so a theme change or a job
  // starting does not tear the GL context down and build a new one.
  const live = useRef({ threads, light: themeMode(theme) === 'light', reduced, anyRunning })
  live.current = { threads, light: themeMode(theme) === 'light', reduced, anyRunning }

  const apiRef = useRef<{ setPaused: (p: boolean) => void; sync: () => void } | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let renderer: Renderer
    try {
      renderer = new Renderer({
        webgl: 2,
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR),
      })
    } catch (e) {
      // No WebGL2, or the context could not be created. The background is
      // decoration; the app must not care that it is missing.
      //
      // Shouted about in dev, because the symptom is indistinguishable from
      // "the background is too faint to see" -- which is a real thing that has
      // already happened once here, and cost a round of shader tuning to work
      // out. A driver Chrome has blocklisted lands in this branch silently.
      if (import.meta.env.DEV) {
        console.warn('[WebThreads] no WebGL2 context; the background will not render.', e)
      }
      return
    }

    const gl = renderer.gl
    gl.clearColor(0, 0, 0, 0)
    const canvas = gl.canvas as HTMLCanvasElement
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.display = 'block'
    container.appendChild(canvas)

    const rgb = (c: ThreadRgb) => new Float32Array(c)
    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uSpeed: { value: SETTINGS.speed },
        uThreadCount: { value: SETTINGS.threadCount },
        uFrequency: { value: SETTINGS.frequency },
        uSpread: { value: SETTINGS.spread },
        uTaper: { value: SETTINGS.taper },
        uPosition: { value: SETTINGS.position },
        uGlow: { value: SETTINGS.glow },
        uFalloff: { value: SETTINGS.falloff },
        uThickness: { value: SETTINGS.thickness },
        uBrightness: { value: SETTINGS.brightness },
        uOpacity: { value: SETTINGS.opacity },
        uMirror: { value: 1.0 },
        uGrain: { value: 1.0 },
        uGrainIntensity: { value: SETTINGS.grainIntensity },
        uColor1: { value: rgb(live.current.threads.one) },
        uColor2: { value: rgb(live.current.threads.two) },
        uColor3: { value: rgb(live.current.threads.three) },
        uLightMode: { value: live.current.light },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uMouseStrength: { value: SETTINGS.mouseStrength },
        uEnableMouse: { value: 1.0 },
        uMouseActive: { value: 0 },
      },
    })

    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program })

    const write = (name: string, c: ThreadRgb) => {
      const v = program.uniforms[name].value as Float32Array
      v[0] = c[0]
      v[1] = c[1]
      v[2] = c[2]
    }
    const sync = () => {
      const { threads: t, light } = live.current
      write('uColor1', t.one)
      write('uColor2', t.two)
      write('uColor3', t.three)
      program.uniforms.uLightMode.value = light
    }

    const setSize = () => {
      const rect = container.getBoundingClientRect()
      renderer.setSize(Math.max(1, Math.floor(rect.width)), Math.max(1, Math.floor(rect.height)))
      const res = program.uniforms.iResolution.value as Float32Array
      res[0] = gl.drawingBufferWidth
      res[1] = gl.drawingBufferHeight
      renderer.render({ scene: mesh })
    }
    const ro = new ResizeObserver(setSize)
    ro.observe(container)
    setSize()

    // The handler does two assignments and nothing else; the loop lerps toward
    // them, so a fast mouse cannot generate work per event.
    const target = [0.5, 0.5]
    const current = [0.5, 0.5]
    let targetActive = 0
    let currentActive = 0
    const onMove = (e: MouseEvent) => {
      target[0] = e.clientX / window.innerWidth
      target[1] = 1 - e.clientY / window.innerHeight
      targetActive = 1
    }
    const onLeave = () => {
      targetActive = 0
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    document.addEventListener('mouseleave', onLeave)

    let raf = 0
    let inView = true
    let pageVisible = !document.hidden
    let paused = live.current.anyRunning
    const t0 = performance.now()

    const frame = (t: number) => {
      program.uniforms.iTime.value = (t - t0) * 0.001
      current[0] += 0.05 * (target[0] - current[0])
      current[1] += 0.05 * (target[1] - current[1])
      currentActive += 0.05 * (targetActive - currentActive)
      const m = program.uniforms.uMouse.value as Float32Array
      m[0] = current[0]
      m[1] = current[1]
      program.uniforms.uMouseActive.value = currentActive
      renderer.render({ scene: mesh })
      raf = requestAnimationFrame(frame)
    }

    const stop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf)
        raf = 0
      }
    }
    // One gate, three reasons: off-screen, hidden tab, or the GPU is busy
    // generating. Reduced motion never starts it at all -- setSize() above has
    // already painted the single frame it gets.
    const start = () => {
      if (live.current.reduced || paused || !inView || !pageVisible) return
      if (raf === 0) raf = requestAnimationFrame(frame)
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting
        if (inView) start()
        else stop()
      },
      { threshold: 0 },
    )
    io.observe(container)

    const onVisibility = () => {
      pageVisible = !document.hidden
      if (pageVisible) start()
      else stop()
    }
    document.addEventListener('visibilitychange', onVisibility)

    apiRef.current = {
      setPaused: (p: boolean) => {
        paused = p
        if (p) stop()
        else start()
      },
      sync: () => {
        sync()
        // A paused or reduced-motion background still has to repaint when the
        // theme changes, or it holds the previous palette until something else
        // happens to start the loop.
        if (raf === 0) renderer.render({ scene: mesh })
      },
    }

    start()

    return () => {
      stop()
      apiRef.current = null
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
      try {
        container.removeChild(canvas)
      } catch {
        /* already gone */
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [])

  // Palette and mode, pushed without rebuilding the context.
  useEffect(() => {
    apiRef.current?.sync()
  }, [threads, theme])

  useEffect(() => {
    apiRef.current?.setPaused(anyRunning || reduced)
  }, [anyRunning, reduced])

  return (
    <div
      ref={containerRef}
      // pointer-events-none is load-bearing, not tidiness: this covers the
      // viewport, so without it the canvas eats every click in the app.
      // -z-10 keeps it under the bulk bar (100), the theme menu (150), the
      // modal (200), BootOverlay (300) and sonner.
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      aria-hidden="true"
    />
  )
}
