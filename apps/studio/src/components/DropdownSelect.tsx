import { Check as CheckIcon, ChevronDown } from 'lucide-react'
import { DropdownMenu } from './DropdownMenu'

export interface DropdownSelectOption {
  value: string
  label: string
}

interface Props {
  value: string
  options: DropdownSelectOption[]
  onValueChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  className?: string
  contentClassName?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}

/** Consistent single-choice dropdown, built from the shared Base UI menu. */
export default function DropdownSelect({
  value, options, onValueChange, ariaLabel, placeholder = 'Select…',
  className = '', contentClassName = '', side = 'bottom', align = 'start', sideOffset = 4,
}: Props) {
  const selected = options.find((option) => option.value === value)
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className={`dropdown-select-trigger ${className}`} aria-label={ariaLabel}>
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Positioner side={side} align={align} sideOffset={sideOffset} className="dropdown-menu-positioner">
          <DropdownMenu.Popup className={`dropdown-menu-content dropdown-select-popup ${contentClassName}`}>
            <DropdownMenu.RadioGroup value={value} onValueChange={onValueChange}>
              {options.map((option) => (
                <DropdownMenu.RadioItem key={option.value} value={option.value} className="dropdown-menu-radio-item dropdown-select-item">
                  <DropdownMenu.RadioItemIndicator className="dropdown-menu-indicator"><CheckIcon size={12} /></DropdownMenu.RadioItemIndicator>
                  {option.label}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Popup>
        </DropdownMenu.Positioner>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
