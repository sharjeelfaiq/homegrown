// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ClonedVoiceRowsFixture, ScriptLanguageFixture, StudioStartupFixture, VoiceoverHistoryFixture } from './BoneyardFixtures'

vi.mock('boneyard-js/react', () => ({ Skeleton: ({ children }: { children: ReactNode }) => children }))

describe('Boneyard fixtures', () => {
  it('models the stable Studio shell without live or decorative controls', () => {
    const { container } = render(<StudioStartupFixture />)
    expect(screen.queryByRole('heading', { name: /^Script/ })).not.toBeInTheDocument()
    expect(container.querySelector('.script-editor')).toBeInTheDocument()
    expect(container.querySelector('.script-editor-input')).toBeInTheDocument()
    expect(container.querySelector('.script-editor-generate')).toBeInTheDocument()
    expect(container.querySelector('.cloned-voices-section')).toBeInTheDocument()
    expect(container.querySelector('.voiceovers-card-header')).toBeInTheDocument()
    expect(container.querySelector('.history-context-toolbar')).toBeInTheDocument()
    expect(container.querySelector('.clone-voice-button')).toBeNull()
    expect(container.querySelector('.voiceover-pager')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Voiceovers' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('keeps a representative non-interactive history geometry', () => {
    const { container } = render(<VoiceoverHistoryFixture />)
    expect(container.querySelectorAll('.result-list > li')).toHaveLength(3)
    expect(container.querySelectorAll('.result-list .bg-audio-soft')).toHaveLength(138)
  })

  it('keeps cloned voice loading rows separate from the live card controls', () => {
    const { container } = render(<ClonedVoiceRowsFixture />)
    expect(container.querySelectorAll('.cloned-voices-list > li')).toHaveLength(5)
    expect(container.querySelector('.voiceovers-card-header')).toBeNull()
    expect(container.querySelector('.history-context-toolbar')).toBeNull()
  })

  it('keeps the script language skeleton sized to its live control slot', () => {
    const { container } = render(<ScriptLanguageFixture />)
    expect(container.querySelector('.script-language-control > .h-8')).toBeInTheDocument()
  })
})
