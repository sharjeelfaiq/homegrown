import type { ComponentProps, ReactNode } from 'react'
import { Menu } from '@base-ui/react/menu'

type RootProps = ComponentProps<typeof Menu.Root>
type TriggerProps = ComponentProps<typeof Menu.Trigger>
type PopupProps = ComponentProps<typeof Menu.Popup>

interface ContentProps extends Omit<PopupProps, 'className'> {
  children: ReactNode
  className?: string
  positionerClassName?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
}

/** Shared dropdown shell for choice fields and action menus. */
function Content({
  children,
  className = '',
  positionerClassName = '',
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  ...popupProps
}: ContentProps) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={`dropdown-menu-positioner ${positionerClassName}`}
      >
        <Menu.Popup
          {...popupProps}
          className={`dropdown-menu-content ${className}`}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

export const Dropdown = {
  Root: (props: RootProps) => <Menu.Root {...props} />,
  Trigger: (props: TriggerProps) => <Menu.Trigger {...props} />,
  Content,
  Item: Menu.Item,
  RadioGroup: Menu.RadioGroup,
  RadioItem: Menu.RadioItem,
  Group: Menu.Group,
  GroupLabel: Menu.GroupLabel,
  Separator: Menu.Separator,
}
