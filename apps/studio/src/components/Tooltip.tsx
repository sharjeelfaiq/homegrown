import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import type { ReactElement, ReactNode } from 'react'

export const TooltipProvider = BaseTooltip.Provider
export const Tooltip = BaseTooltip.Root
export const TooltipTrigger = BaseTooltip.Trigger

export function TooltipContent({
  children,
  side = 'top',
  sideOffset = 7,
  className = '',
}: {
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  className?: string
}) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side} sideOffset={sideOffset} className="tooltip-positioner">
        <BaseTooltip.Popup className={`tooltip-content ${className}`}>{children}</BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}

/** Shared tooltip wrapper for an existing focusable element. */
export function AppTooltip({
  children,
  content,
  side = 'top',
  className,
}: {
  children: ReactElement
  content: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}) {
  const disabled = Boolean((children.props as { disabled?: boolean }).disabled)
  return (
    <BaseTooltip.Root>
      {disabled ? (
        <BaseTooltip.Trigger render={<span className="tooltip-disabled-trigger" tabIndex={0} />}>
          {children}
        </BaseTooltip.Trigger>
      ) : (
        <BaseTooltip.Trigger render={children} />
      )}
      <TooltipContent side={side} className={className}>{content}</TooltipContent>
    </BaseTooltip.Root>
  )
}
