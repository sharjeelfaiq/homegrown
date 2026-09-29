// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GenerateButton from './GenerateButton'

afterEach(cleanup)

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) })
})

describe('GenerateButton', () => {
  it('keeps the action in a dedicated center grid column while auxiliary text is separate', () => {
    const { container } = render(
      <GenerateButton disabled blockedReason="Choose a voice first" busy={false} count={0} onClick={() => {}} />,
    )

    const layout = container.querySelector('.generate-action-grid')
    const auxiliary = container.querySelector('.generate-action-auxiliary')
    expect(layout).toHaveClass('grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]')
    expect(layout?.children).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Generate' }).parentElement).toContainElement(auxiliary as HTMLElement | null)
    expect(auxiliary).toHaveTextContent('Choose a voice first')
    expect(auxiliary).toHaveClass('wide:absolute')
  })
})
