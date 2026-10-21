// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { StudioStartupFixture, VoiceoverHistoryFixture } from './BoneyardFixtures'

vi.mock('boneyard-js/react', () => ({ Skeleton: ({ children }: { children: ReactNode }) => children }))

describe('Boneyard fixtures', () => {
  it('models the stable Studio shell without live or decorative controls', () => {
    const { container } = render(<StudioStartupFixture />)
    expect(screen.queryByRole('heading', { name: /^Script/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Voiceovers/ })).toBeInTheDocument()
    expect(container.querySelector('.script-editor')).toBeInTheDocument()
    expect(container.querySelector('.script-editor-generate')).toBeInTheDocument()
    expect(container.querySelector('.cloned-voices-section')).toBeInTheDocument()
    expect(container.querySelector('.voiceovers-card-header')).toBeInTheDocument()
    expect(container.querySelector('.history-context-toolbar')).toBeInTheDocument()
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('keeps a representative non-interactive history geometry', () => {
    const { container } = render(<VoiceoverHistoryFixture />)
    expect(container.querySelectorAll('.result-list > div')).toHaveLength(3)
  })
})
