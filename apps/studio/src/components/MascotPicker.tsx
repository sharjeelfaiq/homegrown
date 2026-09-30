import { useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import { Mascot } from 'page-mascot'
import { ArrowLeftIcon, ArrowRightIcon } from './Icons'
import { DEFAULT_MASCOT_ID, MASCOTS } from '../generated/mascotCatalog'

type Position = { x: number, y: number }

type Props = {
  /** The Voiceovers surface is the resting landmark on desktop. */
  anchorRef: RefObject<HTMLElement | null>
}

const EDGE_INSET = 16
const DRAG_THRESHOLD = 6
const WIDE_QUERY = '(min-width: 1025px)'
const MASCOT_QUERY = '(min-width: 640px)'
const MIN_SIZE = 56
const MAX_SIZE = 176
const SIZE_STEP = 8
const NARROW_SIZE = 80
const WIDE_SIZE = 112

const initialMascotId = MASCOTS.some((mascot) => mascot.id === DEFAULT_MASCOT_ID)
  ? DEFAULT_MASCOT_ID
  : MASCOTS[0].id

function defaultSize() {
  return window.matchMedia?.(MASCOT_QUERY).matches ? WIDE_SIZE : NARROW_SIZE
}

function clampSize(next: number) {
  return Math.min(Math.max(MIN_SIZE, Math.round(next)), MAX_SIZE)
}

/** A session-local, compact companion anchored to Voiceovers until moved.
 * Arrow controls make the available mascot choices discoverable without a
 * popover competing with the voice picker beside it. */
export default function MascotPicker({ anchorRef }: Props) {
  const [selectedId, setSelectedId] = useState<number>(initialMascotId)
  const [position, setPosition] = useState<Position | null>(null)
  const [hasDragged, setHasDragged] = useState(false)
  // Size is session-local in-memory state, exactly like position: nothing is
  // written to localStorage or the server.
  const [size, setSize] = useState<number>(defaultSize)
  const [hasResized, setHasResized] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    origin: Position
    moved: boolean
    captured: boolean
  } | null>(null)
  const resizeRef = useRef<{ pointerId: number, startX: number, startY: number, origin: number } | null>(null)
  const suppressClickRef = useRef(false)
  const selected = MASCOTS.find((mascot) => mascot.id === selectedId) ?? MASCOTS[0]

  function clamp(next: Position): Position {
    const rect = pickerRef.current?.getBoundingClientRect()
    const width = rect?.width ?? 0
    const height = rect?.height ?? 0
    return {
      x: Math.min(Math.max(EDGE_INSET, next.x), Math.max(EDGE_INSET, window.innerWidth - width - EDGE_INSET)),
      y: Math.min(Math.max(EDGE_INSET, next.y), Math.max(EDGE_INSET, window.innerHeight - height - EDGE_INSET)),
    }
  }

  useLayoutEffect(() => {
    function place() {
      // Until the reader resizes it themselves, the mascot keeps following the
      // responsive default for the current viewport.
      if (!hasResized) setSize(defaultSize())

      if (hasDragged) {
        setPosition((current) => current ? clamp(current) : current)
        return
      }

      const anchor = anchorRef.current
      if (window.matchMedia?.(WIDE_QUERY).matches && anchor) {
        const rect = anchor.getBoundingClientRect()
        const pickerHeight = pickerRef.current?.getBoundingClientRect().height ?? 0
        setPosition(clamp({ x: rect.left, y: rect.bottom - pickerHeight }))
      } else {
        const pickerHeight = pickerRef.current?.getBoundingClientRect().height ?? 0
        setPosition(clamp({ x: EDGE_INSET, y: window.innerHeight - pickerHeight - EDGE_INSET }))
      }
    }

    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const anchorElement = anchorRef.current
    const observer = typeof ResizeObserver === 'undefined' || !anchorElement
      ? null
      : new ResizeObserver(place)
    if (observer && anchorElement) observer.observe(anchorElement)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      observer?.disconnect()
    }
  }, [anchorRef, hasDragged, hasResized, size])

  function move(direction: -1 | 1) {
    const index = MASCOTS.findIndex((mascot) => mascot.id === selected.id)
    setSelectedId(MASCOTS[(index + direction + MASCOTS.length) % MASCOTS.length].id)
  }

  function resize(next: number) {
    setHasResized(true)
    setSize(clampSize(next))
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    // The mascot itself is a button so it can still be booped. Only the
    // navigation controls and the resize handle are excluded from dragging; the
    // artwork is the direct drag surface, not a separate drag handle.
    // A fresh gesture retires any click still owed to the previous drag.
    suppressClickRef.current = false
    if (event.button !== 0 || (event.target as Element).closest('[data-mascot-navigation], [data-mascot-resize]')) return
    const origin = position ?? clamp({ x: EDGE_INSET, y: EDGE_INSET })
    // Deliberately no pointer capture yet: capturing here retargets the
    // pointerup away from the mascot's own button, so the browser never
    // synthesizes its click and the boop reaction never plays.
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, moved: false, captured: false }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    drag.moved = true
    if (!drag.captured) {
      drag.captured = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    setPosition(clamp({ x: drag.origin.x + dx, y: drag.origin.y + dy }))
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.captured && event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag.moved) {
      setHasDragged(true)
      // Capture taken mid-gesture leaves the trailing click browser-defined, so
      // a finished drag swallows it rather than ending in an accidental boop.
      suppressClickRef.current = true
    }
    dragRef.current = null
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    // Only the drag surface owes a swallowed click; the cycling arrows and the
    // resize grip stay live even right after a drag.
    if (!suppressClickRef.current || (event.target as Element).closest('[data-mascot-navigation], [data-mascot-resize]')) return
    suppressClickRef.current = false
    event.stopPropagation()
    event.preventDefault()
  }

  function onResizePointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.stopPropagation()
    resizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: size }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onResizePointerMove(event: PointerEvent<HTMLButtonElement>) {
    const gesture = resizeRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.stopPropagation()
    const dx = event.clientX - gesture.startX
    const dy = event.clientY - gesture.startY
    resize(gesture.origin + (dx + dy) / 2)
  }

  function onResizePointerUp(event: PointerEvent<HTMLButtonElement>) {
    const gesture = resizeRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    event.stopPropagation()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    resizeRef.current = null
  }

  function onResizeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const grow = event.key === 'ArrowUp' || event.key === 'ArrowRight' || event.key === '+' || event.key === '='
    const shrink = event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === '-' || event.key === '_'
    if (!grow && !shrink) return
    event.preventDefault()
    resize(size + (grow ? SIZE_STEP : -SIZE_STEP))
  }

  return (
    <div
      ref={pickerRef}
      className="fixed z-[200] flex shrink-0 touch-none select-none items-center gap-1 cursor-grab active:cursor-grabbing"
      style={position ? { left: position.x, top: position.y } : { visibility: 'hidden' }}
      role="group"
      aria-label="Studio mascot"
      aria-describedby="mascot-drag-instructions"
      data-testid="mascot-picker"
      data-dragged={hasDragged}
      data-size={size}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickCapture}
    >
      <span id="mascot-drag-instructions" className="sr-only">Drag the mascot to move it. Drag or arrow-key its corner handle to resize it. Its position and size are kept until you close this tab.</span>
      <button type="button" data-mascot-navigation className="mascot-nav" aria-label={`Show previous mascot; current mascot is ${selected.label}`} title="Previous mascot" onClick={() => move(-1)}>
        <ArrowLeftIcon size={12} />
      </button>
      <span className="relative block shrink-0" style={{ width: size, height: size }}>
        <Mascot directions={selected.directions} reactions={selected.reactions} size={size} label={`${selected.label} Studio mascot`} />
        <button
          type="button"
          data-mascot-resize
          data-testid="mascot-resize"
          className="mascot-resize absolute right-0 bottom-0"
          role="slider"
          aria-label={`Resize the ${selected.label} Studio mascot`}
          aria-valuemin={MIN_SIZE}
          aria-valuemax={MAX_SIZE}
          aria-valuenow={size}
          aria-valuetext={`${size} pixels`}
          title="Drag or use arrow keys to resize the mascot"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          onKeyDown={onResizeKeyDown}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true" focusable="false">
            <path d="M9 1v8H1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </span>
      <button type="button" data-mascot-navigation className="mascot-nav" aria-label={`Show next mascot; current mascot is ${selected.label}`} title="Next mascot" onClick={() => move(1)}>
        <ArrowRightIcon size={12} />
      </button>
    </div>
  )
}
