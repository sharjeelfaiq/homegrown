import { motion, useMotionValue, useSpring } from 'framer-motion'
import { type PointerEvent, type ReactNode } from 'react'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

const MAX_DEG = 8

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** Subtle 3D tilt-on-hover wrapper. Renders a plain div for reduced-motion
 * users and coarse/touch pointers. */
export default function TiltCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const reducedMotion = usePrefersReducedMotion()
  const rotateX = useMotionValue(0)
  const rotateY = useMotionValue(0)
  const springX = useSpring(rotateX, { stiffness: 180, damping: 18 })
  const springY = useSpring(rotateY, { stiffness: 180, damping: 18 })

  const enabled =
    !reducedMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches

  if (!enabled) {
    return <div className={className}>{children}</div>
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    rotateY.set(clamp((px - 0.5) * 2 * MAX_DEG, -MAX_DEG, MAX_DEG))
    rotateX.set(clamp(-(py - 0.5) * 2 * MAX_DEG, -MAX_DEG, MAX_DEG))
  }

  function onPointerLeave() {
    rotateX.set(0)
    rotateY.set(0)
  }

  return (
    <motion.div
      className={className}
      style={{ rotateX: springX, rotateY: springY, transformPerspective: 700 }}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </motion.div>
  )
}
