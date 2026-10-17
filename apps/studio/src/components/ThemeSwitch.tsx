import { useTheme } from '../ThemeContext'
import { THEMES, type ThemeChoice } from '../theme'
import { Contrast as ThemeIcon } from 'lucide-react'
import { Dropdown } from './Dropdown'
import { AppTooltip } from './Tooltip'

/** Theme choices are a radio menu: one selected theme, opened from the header. */
export default function ThemeSwitch() {
  const { choice, theme, setChoice } = useTheme()
  const active = THEMES.find((item) => item.id === theme)
  const activeLabel = choice === 'system' ? 'System' : active?.label

  function changeChoice(value: string) {
    if (value === 'system' || THEMES.some((item) => item.id === value)) {
      setChoice(value as ThemeChoice)
    }
  }

  return (
    <Dropdown.Root>
      <AppTooltip content={`Theme: ${activeLabel}`}>
        <Dropdown.Trigger
          className="icon-btn size-8"
          aria-label={`Theme: ${activeLabel}`}
        >
          <ThemeIcon size={16} />
        </Dropdown.Trigger>
      </AppTooltip>
      <Dropdown.Content side="bottom" align="end" sideOffset={6} className="theme-dropdown-menu">
            <Dropdown.RadioGroup value={choice} onValueChange={changeChoice}>
              <Dropdown.RadioItem value="system" className="dropdown-menu-radio-item">
                <span>System</span>
              </Dropdown.RadioItem>
              <Dropdown.Separator className="dropdown-menu-separator" />
              {(['dark', 'light'] as const).map((mode) => (
                <Dropdown.Group key={mode}>
                  <Dropdown.GroupLabel className="dropdown-menu-label">{mode}</Dropdown.GroupLabel>
                  {THEMES.filter((item) => item.mode === mode && !(choice === 'system' && item.id === theme)).map((item) => (
                    <Dropdown.RadioItem key={item.id} value={item.id} className="dropdown-menu-radio-item">
                      <span className="flex flex-col gap-px">{item.label}<span className="text-[11px] text-faint">{item.hint}</span></span>
                    </Dropdown.RadioItem>
                  ))}
                </Dropdown.Group>
              ))}
            </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown.Root>
  )
}
