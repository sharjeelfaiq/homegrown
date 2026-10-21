// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import InlineName from './InlineName'

vi.mock('../hooks/useFlushOnHide', () => ({ useFlushOnHide: () => {} }))
vi.mock('./Tooltip', () => ({ AppTooltip: ({ children }: { children: ReactNode }) => children }))

describe('InlineName', () => {
  it('keeps the current name in its editable input', () => {
    render(<InlineName value="A deliberately long voice name" placeholder="Name this voice" ariaLabel="Name of voice" onCommit={vi.fn()} />)

    const input = screen.getByRole('textbox', { name: 'Name of voice' })
    expect(input).toHaveValue('A deliberately long voice name')
    expect(input).not.toHaveAttribute('readonly')

    fireEvent.focus(input)

    expect(input).toHaveValue('A deliberately long voice name')
  })
})
