import { useTheme } from '../../lib/theme/ThemeContext'
import { THEMES, type ThemeChoice } from '../../lib/theme/theme'
import { ChevronDown } from 'lucide-react'
import { Dropdown } from '../../components/ui/Dropdown'

/** Theme picker used in Settings. It stays a menu instead of becoming a
 * native select because each option includes the theme's visual description. */
export default function ThemeSwitch() {
  const { choice, theme, setChoice } = useTheme()
  const active = THEMES.find((item) => item.id === theme)
  const activeLabel = choice === 'system' ? 'System' : active?.label ?? 'Studio'

  function changeChoice(value: string) {
    if (value === 'system' || THEMES.some((item) => item.id === value)) {
      setChoice(value as ThemeChoice)
    }
  }

  return (
    <div className="settings-preference-row">
      <div className="min-w-0">
        <p className="m-0 text-[13px] font-medium text-ink">Theme</p>
        <p className="m-0 mt-0.5 text-[12px] text-muted">Choose how Studio looks.</p>
      </div>
      <Dropdown.Root>
        <Dropdown.Trigger className="flex h-9 min-w-[148px] items-center justify-between gap-2 rounded-sm border border-control bg-surface-raised px-3 text-left text-[13px] text-ink transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--line-focus)" aria-label={`Theme: ${activeLabel}`}>
          <span>{activeLabel}</span>
          <ChevronDown size={15} aria-hidden="true" />
        </Dropdown.Trigger>
        <Dropdown.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="theme-dropdown-menu"
          positionerClassName="modal-dropdown-positioner"
        >
          <Dropdown.RadioGroup value={choice} onValueChange={changeChoice}>
            <Dropdown.RadioItem value="system" className="dropdown-menu-radio-item"><span>System</span></Dropdown.RadioItem>
            <Dropdown.Separator className="dropdown-menu-separator" />
            {(['dark', 'light'] as const).map((mode) => (
              <Dropdown.Group key={mode}>
                <Dropdown.GroupLabel className="dropdown-menu-label">{mode}</Dropdown.GroupLabel>
                {THEMES.filter((item) => item.mode === mode).map((item) => (
                  <Dropdown.RadioItem key={item.id} value={item.id} className="dropdown-menu-radio-item">
                    <span className="flex flex-col gap-px">{item.label}<span className="text-[11px] text-faint">{item.hint}</span></span>
                  </Dropdown.RadioItem>
                ))}
              </Dropdown.Group>
            ))}
          </Dropdown.RadioGroup>
        </Dropdown.Content>
      </Dropdown.Root>
    </div>
  )
}
