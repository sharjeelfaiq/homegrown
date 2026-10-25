import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Dropdown } from './Dropdown'
import { AppTooltip } from './Tooltip'

interface DropdownSelectOption {
  value: string
  label: string
}

interface Props {
  value: string
  options: DropdownSelectOption[]
  onValueChange: (value: string) => void
  ariaLabel: string
  placeholder: string
  className?: string
  contentClassName?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  disabled?: boolean
  tooltip?: string
}

/** Consistent single-choice dropdown, built from the shared Base UI menu. */
export default function DropdownSelect({
  value, options, onValueChange, ariaLabel, placeholder,
  className = '', contentClassName = '',
  side = 'bottom', align = 'start', sideOffset = 4, disabled = false, tooltip,
}: Props) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value)
  const trigger = (
    <Dropdown.Trigger className={`dropdown-select-trigger ${className}`} aria-label={ariaLabel} disabled={disabled}>
      <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
      <ChevronDown aria-hidden="true" className="size-3.5 shrink-0" />
    </Dropdown.Trigger>
  )
  return (
    <Dropdown.Root open={open} onOpenChange={setOpen}>
      {tooltip ? <AppTooltip content={tooltip}>{trigger}</AppTooltip> : trigger}
      <Dropdown.Content side={side} align={align} sideOffset={sideOffset} className={`dropdown-select-popup ${contentClassName}`}>
            <Dropdown.RadioGroup value={value} onValueChange={(next) => {
              onValueChange(next)
              setOpen(false)
            }}>
              {options.map((option) => (
                <Dropdown.RadioItem
                  key={option.value}
                  value={option.value}
                  className={`dropdown-menu-radio-item dropdown-select-item ${option.value !== '' && option.value === value ? 'is-selected' : ''}`}
                >
                  {option.label}
                </Dropdown.RadioItem>
              ))}
            </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown.Root>
  )
}
