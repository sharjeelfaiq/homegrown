import { useTheme } from '../ThemeContext'
import { THEMES, type ThemeChoice } from '../theme'
import { Check as CheckIcon, Contrast as ThemeIcon } from 'lucide-react'
import { DropdownMenu } from './DropdownMenu'
import { AppTooltip } from './Tooltip'

/** Theme choices are a radio menu: one selected theme, opened from the header. */
export default function ThemeSwitch() {
  const { choice, theme, setChoice } = useTheme()
  const active = THEMES.find((item) => item.id === theme)
  const activeLabel = choice === 'system' ? `System (${active?.label ?? theme})` : active?.label

  function changeChoice(value: string) {
    if (value === 'system' || THEMES.some((item) => item.id === value)) {
      setChoice(value as ThemeChoice)
    }
  }

  return (
    <DropdownMenu.Root>
      <AppTooltip content={`Theme: ${activeLabel}`}>
        <DropdownMenu.Trigger
          className="icon-btn size-8"
          aria-label={`Theme: ${activeLabel}`}
        >
          <ThemeIcon size={16} />
        </DropdownMenu.Trigger>
      </AppTooltip>
      <DropdownMenu.Portal>
        <DropdownMenu.Positioner side="bottom" align="end" sideOffset={6} className="dropdown-menu-positioner">
          <DropdownMenu.Popup className="dropdown-menu-content theme-dropdown-menu">
            <DropdownMenu.RadioGroup value={choice} onValueChange={changeChoice}>
              <DropdownMenu.RadioItem value="system" className="dropdown-menu-radio-item">
                <DropdownMenu.RadioItemIndicator className="dropdown-menu-indicator"><CheckIcon size={12} /></DropdownMenu.RadioItemIndicator>
                <span className="flex flex-col gap-px">System<span className="text-[11px] text-faint">{active?.label ?? theme}</span></span>
              </DropdownMenu.RadioItem>
              <DropdownMenu.Separator className="dropdown-menu-separator" />
              {(['dark', 'light'] as const).map((mode) => (
                <DropdownMenu.Group key={mode}>
                  <DropdownMenu.GroupLabel className="dropdown-menu-label">{mode}</DropdownMenu.GroupLabel>
                  {THEMES.filter((item) => item.mode === mode).map((item) => (
                    <DropdownMenu.RadioItem key={item.id} value={item.id} className="dropdown-menu-radio-item">
                      <DropdownMenu.RadioItemIndicator className="dropdown-menu-indicator"><CheckIcon size={12} /></DropdownMenu.RadioItemIndicator>
                      <span className="flex flex-col gap-px">{item.label}<span className="text-[11px] text-faint">{item.hint}</span></span>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.Group>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Popup>
        </DropdownMenu.Positioner>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
