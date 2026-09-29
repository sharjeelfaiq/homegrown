import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
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

const initialMascotId = MASCOTS.some((mascot) => mascot.id === DEFAULT_MASCOT_ID)
  ? DEFAULT_MASCOT_ID
  : MASCOTS[0].id

/** A session-local, compact companion anchored to Voiceovers until moved.
 * Arrow controls make the available mascot choices discoverable without a
 * popover competing with the voice picker beside it. */
export default function MascotPicker({ anchorRef }: Props) {
  const [selectedId, setSelectedId] = useState<number>(initialMascotId)
  const [position, setPosition] = useState<Position | null>(null)
  const [hasDragged, setHasDragged] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    origin: Position
    moved: boolean
  } | null>(null)
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
  }, [anchorRef, hasDragged])

  function move(direction: -1 | 1) {
    const index = MASCOTS.findIndex((mascot) => mascot.id === selected.id)
    setSelectedId(MASCOTS[(index + direction + MASCOTS.length) % MASCOTS.length].id)
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    // The mascot itself is a button so it can still be booped. Only the two
    // navigation controls are excluded from dragging; the artwork is the
    // direct drag surface, not a separate drag handle.
    if (event.button !== 0 || (event.target as Element).closest('[data-mascot-navigation]')) return
    const origin = position ?? clamp({ x: EDGE_INSET, y: EDGE_INSET })
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    drag.moved = true
    setPosition(clamp({ x: drag.origin.x + dx, y: drag.origin.y + dy }))
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (drag.moved) setHasDragged(true)
    dragRef.current = null
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
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span id="mascot-drag-instructions" className="sr-only">Drag the mascot to move it. Its position is kept until you close this tab.</span>
      <button type="button" data-mascot-navigation className="mascot-nav" aria-label={`Show previous mascot; current mascot is ${selected.label}`} title="Previous mascot" onClick={() => move(-1)}>
        <ArrowLeftIcon size={12} />
      </button>
      <Mascot directions={selected.directions} reactions={selected.reactions} size={80} label={`${selected.label} Studio mascot`} className="!h-20 !w-20 sm:!h-28 sm:!w-28" />
      <button type="button" data-mascot-navigation className="mascot-nav" aria-label={`Show next mascot; current mascot is ${selected.label}`} title="Next mascot" onClick={() => move(1)}>
        <ArrowRightIcon size={12} />
      </button>
    </div>
  )
}
