import { useRef, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring, useTransform, type SpringOptions } from 'framer-motion'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { AppTooltip } from './Tooltip'
import './Dock.css'

export interface DockItemData {
  icon: ReactNode
  label: string
  onClick: () => void
  className?: string
  disabled?: boolean
}

export interface DockProps {
  items: DockItemData[]
  /** Text placed before the actions, such as the current selection count. */
  children?: ReactNode
  className?: string
  'aria-label'?: string
  /** Controls the responsive feel of icon magnification. */
  spring?: SpringOptions
}

export type DockSpringOptions = SpringOptions

const DEFAULT_SPRING: DockSpringOptions = { mass: 0.18, stiffness: 220, damping: 18 }
const ITEM_SIZE = 36
const ITEM_MAGNIFIED_SIZE = 48
const MAGNIFY_DISTANCE = 100
const ITEM_GAP = 4

function DockItem({ item, index, mouseX, spring }: {
  item: DockItemData
  index: number
  mouseX: ReturnType<typeof useMotionValue<number>>
  spring: SpringOptions
}) {
  const center = index * (ITEM_SIZE + ITEM_GAP) + ITEM_SIZE / 2
  const rawSize = useTransform(
    mouseX,
    [center - MAGNIFY_DISTANCE, center, center + MAGNIFY_DISTANCE],
    [ITEM_SIZE, ITEM_MAGNIFIED_SIZE, ITEM_SIZE],
    { clamp: true },
  )
  const size = useSpring(rawSize, spring)
  const reducedMotion = usePrefersReducedMotion()

  return (
    <AppTooltip content={item.label} side="top">
      <motion.button
        type="button"
        className={['dock-item', item.className].filter(Boolean).join(' ')}
        style={reducedMotion ? { width: ITEM_SIZE, height: ITEM_SIZE } : { width: size, height: size }}
        aria-label={item.label}
        disabled={item.disabled}
        onClick={item.onClick}
      >
        {item.icon}
      </motion.button>
    </AppTooltip>
  )
}

/** A compact, token-driven magnifying action dock inspired by macOS docks. */
export default function Dock({ items, children, className = '', spring = DEFAULT_SPRING, 'aria-label': ariaLabel = 'Actions' }: DockProps) {
  const itemListRef = useRef<HTMLDivElement>(null)
  const mouseX = useMotionValue(Infinity)

  const trackPointer = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = itemListRef.current?.getBoundingClientRect()
    if (bounds) mouseX.set(event.clientX - bounds.left)
  }

  return (
    <div className={['dock', className].filter(Boolean).join(' ')} role="toolbar" aria-label={ariaLabel}>
      {children && <span className="dock-summary">{children}</span>}
      <div
        ref={itemListRef}
        className="dock-items"
        onMouseMove={trackPointer}
        onMouseLeave={() => mouseX.set(Infinity)}
      >
        {items.map((item, index) => (
          <DockItem key={item.label} item={item} index={index} mouseX={mouseX} spring={spring} />
        ))}
      </div>
    </div>
  )
}
