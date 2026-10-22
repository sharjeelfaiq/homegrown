// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ThemeSwitch from './ThemeSwitch'
import { THEMES } from '../../lib/theme/theme'

const themeState = vi.hoisted(() => ({
  choice: 'system' as string,
  theme: 'studio' as string,
  setChoice: vi.fn(),
}))

vi.mock('../../lib/theme/ThemeContext', () => ({ useTheme: () => themeState }))

afterEach(() => {
  cleanup()
  themeState.choice = 'system'
  themeState.theme = 'studio'
  vi.clearAllMocks()
})

describe('ThemeSwitch', () => {
  it('keeps every theme in the same order after choosing the system-resolved theme', async () => {
    render(<ThemeSwitch />)
    const openOptions = async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Theme:/ }))
      const options = await screen.findAllByRole('menuitemradio')
      return options.map((option) => option.textContent?.replace(/\s+/g, ' ').trim())
    }
    const expected = [
      'System',
      ...(['dark', 'light'] as const).flatMap((mode) => THEMES
        .filter((item) => item.mode === mode)
        .map((item) => `${item.label}${item.hint}`)),
    ]

    expect(await openOptions()).toEqual(expected)
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Studio/ }))
    expect(themeState.setChoice).toHaveBeenCalledWith('studio')

    cleanup()
    themeState.choice = 'studio'
    themeState.theme = 'studio'
    render(<ThemeSwitch />)
    expect(await openOptions()).toEqual(expected)
  })
})
