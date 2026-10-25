// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GenerateButton from './GenerateButton'

// These tests exercise button state and accessibility, not WebGL rendering.
vi.mock('../../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => true }))

vi.mock('../../components/ui/Tooltip', () => ({
  AppTooltip: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
    <span data-tooltip={String(content)}>{children}</span>
  ),
}))

afterEach(cleanup)

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) })
})

describe('GenerateButton', () => {
  it('keeps the compact action and auxiliary feedback together for the editor footer', () => {
    const { container } = render(
      <GenerateButton disabled blockedReason="Choose a voice first" busy={false} onClick={() => {}} />,
    )

    const layout = container.querySelector('.generate-action')
    const auxiliary = container.querySelector('.generate-action-auxiliary')
    expect(layout).toContainElement(screen.getByRole('button', { name: 'Generate' }))
    expect(layout).toContainElement(auxiliary as HTMLElement | null)
    expect(auxiliary).toHaveTextContent('Choose a voice first')
    expect(auxiliary).not.toHaveTextContent('to generate')
    expect(screen.getByRole('button', { name: 'Generate' })).toHaveClass('generate-btn')
    expect(screen.getByRole('button', { name: 'Generate' })).toHaveAttribute('aria-keyshortcuts', 'Control+Enter')
  })

  it('uses a subtler tone for the language prompt beside Generate', () => {
    render(<GenerateButton disabled blockedReason="Select a language" busy={false} onClick={() => {}} />)

    expect(screen.getByText('Select a language')).toHaveClass('text-faint/70')
  })

  it('keeps Generate disabled and exposes the model-loading explanation', () => {
    const { container } = render(
      <GenerateButton
        disabled
        busy={false}
        tooltip="Waiting for the voice model to load."
        onClick={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
    expect(container.querySelector('[data-tooltip]')).toHaveAttribute(
      'data-tooltip',
      'Waiting for the voice model to load.',
    )
  })

  it('enables Generate when its normal prerequisites have already been met', () => {
    render(<GenerateButton disabled={false} busy={false} onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled()
  })
})
