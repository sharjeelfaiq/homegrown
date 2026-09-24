import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import './OptionWheel.css'

export interface OptionWheelItem {
  value: string
  label: string
}

export interface OptionWheelProps {
  items: readonly OptionWheelItem[]
  defaultSelected: string
  onChange: (value: string) => void
  optionSpacing?: number
  labelSize?: number
  inset?: number
  smoothing?: number
  curve?: number
  tilt?: number
  blur?: number
  fade?: number
  loop?: boolean
  draggable?: boolean
  reducedMotion?: boolean
  className?: string
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * A compact, deliberately dependency-free picker inspired by the React Bits
 * option wheel. Selection is provisional while the wheel moves; consumers are
 * notified only after it has settled, so an expensive choice cannot briefly be
 * applied for every notch of a trackpad gesture.
 */
export default function OptionWheel({
  items,
  defaultSelected,
  onChange,
  optionSpacing = 36,
  labelSize = 14,
  inset = 18,
  smoothing = 160,
  curve = 10,
  tilt = 4,
  blur = 1,
  fade = 0.22,
  loop = false,
  draggable = true,
  reducedMotion = false,
  className = '',
}: OptionWheelProps) {
  const initialIndex = Math.max(0, items.findIndex((item) => item.value === defaultSelected))
  const [selected, setSelected] = useState(initialIndex)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedRef = useRef(initialIndex)
  const notifiedRef = useRef(initialIndex)
  const settleTimerRef = useRef<number | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const pendingIndexRef = useRef<number | null>(null)
  const dragRef = useRef<{ pointerId: number; startY: number; startIndex: number } | null>(null)
  const changeRef = useRef(onChange)
  const optionId = useId()

  changeRef.current = onChange

  const clearSettle = useCallback(() => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = null
  }, [])

  const normalise = useCallback((index: number) => {
    if (items.length === 0) return 0
    if (!loop) return clamp(index, 0, items.length - 1)
    return ((index % items.length) + items.length) % items.length
  }, [items.length, loop])

  const settle = useCallback((index: number) => {
    clearSettle()
    const notify = () => {
      settleTimerRef.current = null
      if (notifiedRef.current === index || !items[index]) return
      notifiedRef.current = index
      changeRef.current(items[index].value)
    }
    if (reducedMotion || smoothing === 0) notify()
    else settleTimerRef.current = window.setTimeout(notify, smoothing)
  }, [clearSettle, items, reducedMotion, smoothing])

  const choose = useCallback((rawIndex: number, shouldSettle = true) => {
    const index = normalise(rawIndex)
    if (!items[index]) return
    selectedRef.current = index
    setSelected(index)
    if (shouldSettle) settle(index)
  }, [items, normalise, settle])

  const flushDragFrame = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    const pending = pendingIndexRef.current
    pendingIndexRef.current = null
    if (pending !== null) choose(pending, false)
  }, [choose])

  // The parent may resolve System to a new effective theme while the menu is
  // closed. Treat that as a fresh seed, not as a user-originated selection.
  useEffect(() => {
    const index = Math.max(0, items.findIndex((item) => item.value === defaultSelected))
    clearSettle()
    selectedRef.current = index
    notifiedRef.current = index
    setSelected(index)
  }, [clearSettle, defaultSelected, items])

  useEffect(() => () => {
    clearSettle()
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current)
  }, [clearSettle, flushDragFrame])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let remainder = 0
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY
      remainder += delta
      if (Math.abs(remainder) < optionSpacing / 2) return
      const steps = Math.trunc(remainder / optionSpacing)
      remainder -= steps * optionSpacing
      choose(selectedRef.current + steps)
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [choose, optionSpacing])

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    choose(selectedRef.current + (event.key === 'ArrowDown' ? 1 : -1))
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggable || event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startIndex: selectedRef.current }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const distance = drag.startY - event.clientY
    pendingIndexRef.current = drag.startIndex + Math.round(distance / optionSpacing)
    if (animationFrameRef.current === null) {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null
        const pending = pendingIndexRef.current
        pendingIndexRef.current = null
        if (pending !== null) choose(pending, false)
      })
    }
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    flushDragFrame()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    settle(selectedRef.current)
  }

  const style = {
    '--option-wheel-spacing': `${optionSpacing}px`,
    '--option-wheel-label-size': `${labelSize}px`,
    '--option-wheel-inset': `${inset}px`,
    '--option-wheel-curve': `${curve}px`,
    '--option-wheel-tilt': `${tilt}deg`,
    '--option-wheel-blur': `${blur}px`,
    '--option-wheel-fade': String(fade),
    '--option-wheel-smoothing': `${reducedMotion ? 0 : smoothing}ms`,
  } as CSSProperties

  return (
    <div
      ref={rootRef}
      className={`option-wheel ${className}`}
      style={style}
      role="listbox"
      tabIndex={0}
      aria-label="Theme choices"
      aria-activedescendant={`${optionId}-${selected}`}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      <div className="option-wheel__viewport" aria-hidden="true" />
      {items.map((item, index) => {
        const distance = index - selected
        const absDistance = Math.abs(distance)
        const itemStyle = {
          '--option-wheel-y': `${distance * optionSpacing}px`,
          '--option-wheel-x': `${Math.min(absDistance, 4) * curve}px`,
          '--option-wheel-rotation': `${distance * tilt}deg`,
          '--option-wheel-opacity': String(Math.max(0, 1 - absDistance * fade)),
          '--option-wheel-filter': `blur(${Math.min(absDistance, 2) * blur}px)`,
        } as CSSProperties
        return (
          <div
            id={`${optionId}-${index}`}
            key={item.value}
            className="option-wheel__option"
            style={itemStyle}
            role="option"
            aria-selected={index === selected}
            onClick={() => choose(index)}
          >
            {item.label}
          </div>
        )
      })}
    </div>
  )
}
