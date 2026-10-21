// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ClonedVoicesSection from './ClonedVoicesSection'
import type { Preset } from '../api'

vi.mock('framer-motion', () => ({ AnimatePresence: ({ children }: { children: ReactNode }) => children, motion: { div: 'div', ul: 'ul' } }))
vi.mock('../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => false }))
vi.mock('../AudioActivityContext', () => ({ useAudioActivity: () => ({ setActiveAudio: vi.fn(), releaseAudio: vi.fn() }) }))
vi.mock('../GenerationActivityContext', () => ({ useGenerationActivity: () => ({ runningPresetIds: new Set<string>() }) }))
vi.mock('./InlineName', () => ({ default: ({ value }: { value: string }) => <span>{value}</span> }))
vi.mock('./Tooltip', () => ({
  AppTooltip: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
    <span data-tooltip={String(content)}>{children}</span>
  ),
}))

const presets: Preset[] = [
  { id: 'qwen-vivian', name: 'Vivian', language: 'English', ref_text: '', audio_path: '', tag: '', is_builtin: true, preview_url: '/voices/vivian.wav', created_at: 0 },
  { id: 'qwen-serena', name: 'Serena', language: 'English', ref_text: '', audio_path: '', tag: '', is_builtin: true, preview_url: '/voices/serena.wav', created_at: 0 },
  { id: 'ada', name: 'Ada', language: 'English', ref_text: '', audio_path: '', tag: '', is_builtin: false, preview_url: '', created_at: 1 },
  { id: 'bruno', name: 'Bruno', language: 'English', ref_text: '', audio_path: '', tag: '', is_builtin: false, preview_url: '', created_at: 2 },
]

function renderSection(overrides: Partial<React.ComponentProps<typeof ClonedVoicesSection>> = {}) {
  const props: React.ComponentProps<typeof ClonedVoicesSection> = {
    presets,
    selectedPresetId: null,
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(async () => {}),
    modelReady: true,
    modelLoading: false,
    creatingVoice: false,
    onAddVoice: vi.fn().mockResolvedValue('done'),
    ...overrides,
  }
  return render(<ClonedVoicesSection {...props} />)
}

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('ClonedVoicesSection', () => {
  it('keeps the search input and all cloned voices visible', () => {
    const { container } = renderSection()
    expect(screen.getByRole('searchbox', { name: 'Search cloned voices' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search cloned voices' })).toHaveAttribute('placeholder', 'Search voices…')
    expect(screen.getByRole('option', { name: /Ada/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Bruno/ })).toBeInTheDocument()
    expect(container.querySelector('.cloned-voices-section.results > .voiceovers-card-header.voiceover-history-header > .mt-1 > .relative > .voiceover-search')).toBeTruthy()
    expect(container.querySelector('.cloned-voices-section > .history-context-toolbar')).toHaveTextContent('Cloned voices · 2')
    expect(container.querySelector('.cloned-voices-section > .cloned-voices-list')).toBeTruthy()
    expect(screen.getByRole('option', { name: /Ada/ })).toHaveClass('-mx-2')
  })

  it('filters cloned voices case-insensitively and selects a matching row', () => {
    const onSelect = vi.fn()
    renderSection({ onSelect })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search cloned voices' }), { target: { value: 'BRU' } })
    expect(screen.getByRole('option', { name: /Bruno/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Ada/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Bruno'))
    expect(onSelect).toHaveBeenCalledWith('bruno')
  })

  it('renders built-ins with preview controls and selects their rows', () => {
    const onSelect = vi.fn()
    renderSection({ onSelect })

    const vivian = screen.getByRole('option', { name: /Vivian/ })
    const serena = screen.getByRole('option', { name: /Serena/ })
    expect(screen.getByText('Built-in voices')).toBeInTheDocument()
    expect(vivian).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('button', { name: 'Preview Vivian' })).toBeInTheDocument()
    expect(serena).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('button', { name: 'Preview Serena' })).toBeInTheDocument()

    fireEvent.click(vivian)
    fireEvent.click(serena)
    expect(onSelect).toHaveBeenCalledTimes(2)
    expect(onSelect).toHaveBeenNthCalledWith(1, 'qwen-vivian')
    expect(onSelect).toHaveBeenNthCalledWith(2, 'qwen-serena')
  })

  it('searches across built-in and cloned voice groups', () => {
    renderSection()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search cloned voices' }), { target: { value: 'viv' } })
    expect(screen.getByRole('option', { name: /Vivian/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Ada/ })).not.toBeInTheDocument()
    expect(screen.getByText('Built-in voices')).toBeInTheDocument()
    expect(screen.queryByText('Cloned voices', { selector: 'li' })).not.toBeInTheDocument()
  })

  it('shows a no-results message for an unmatched query', () => {
    renderSection()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search cloned voices' }), { target: { value: 'missing' } })
    expect(screen.getByText('No matching voices.')).toBeInTheDocument()
  })

  it('confirms voice deletion with Cancel and Delete actions', () => {
    const onDelete = vi.fn(async () => {})
    renderSection({ onDelete })
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Ada' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete “Ada” and its reference audio?')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'More actions for Ada' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith('ada')
  })

  it('disables Clone voice while the model loads and exposes the loading tooltip', () => {
    const { container } = renderSection({ modelReady: false, modelLoading: true })
    expect(screen.getByRole('button', { name: 'Clone voice' })).toBeDisabled()
    expect(container.querySelector('[data-tooltip="Voice model is loading — this can take up to 3 minutes."]')).toBeTruthy()
  })

  it('keeps the cloning status in the right-aligned Clone voice action slot', () => {
    const { container } = renderSection({ creatingVoice: true })
    const action = container.querySelector('.clone-voice-button')
    expect(action).toBeDisabled()
    expect(action).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Cloning…')).toBeInTheDocument()
    expect(action?.parentElement?.parentElement).toHaveClass('ml-auto')
    expect(screen.getByRole('status')).toHaveTextContent('Cloned voices · 2')
  })

  it('does not let a dropped file bypass the loading disablement', async () => {
    const onAddVoice = vi.fn().mockResolvedValue('done')
    const { container } = renderSection({ modelReady: false, modelLoading: true, onAddVoice })
    const card = container.querySelector<HTMLElement>('.cloned-voices-section')!
    const file = new File(['audio'], 'voice.wav', { type: 'audio/wav' })
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: '' }

    fireEvent.drop(card, { dataTransfer })
    await act(async () => { await Promise.resolve() })
    expect(onAddVoice).not.toHaveBeenCalled()
  })

  it('enables Clone voice after the model is ready when no upload is running', () => {
    renderSection({ modelReady: true, modelLoading: false })
    expect(screen.getByRole('button', { name: 'Clone voice' })).toBeEnabled()
  })

  it('only clones a dropped audio file when it is released over the Voices card', async () => {
    const onAddVoice = vi.fn().mockResolvedValue('done')
    const { container } = renderSection({ onAddVoice })
    const card = container.querySelector<HTMLElement>('.cloned-voices-section')!
    const file = new File(['audio'], 'voice.wav', { type: 'audio/wav' })
    const dataTransfer = { types: ['Files'], files: [file], dropEffect: '' }

    fireEvent.dragEnter(card, { dataTransfer })
    expect(card).toHaveClass('is-file-drop-target')
    fireEvent.drop(document, { dataTransfer })
    expect(onAddVoice).not.toHaveBeenCalled()

    fireEvent.drop(card, { dataTransfer })
    await act(async () => { await Promise.resolve() })
    expect(onAddVoice).toHaveBeenCalledWith(file)
  })

  it.each(['done', 'failed'] as const)('shows %s briefly after cloning a voice', async (result) => {
    vi.useFakeTimers()
    const onAddVoice = vi.fn().mockResolvedValue(result)
    const { container } = renderSection({ onAddVoice })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['audio'], 'voice.wav', { type: 'audio/wav' })] } })
    expect(container.querySelector('[data-status="running"]')).toBeTruthy()
    await act(async () => { await Promise.resolve() })
    expect(onAddVoice).toHaveBeenCalledTimes(1)
    expect(container.querySelector(`[data-status="${result}"]`)).toBeTruthy()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(container.querySelector('[data-status]')).toBeNull()
  })
})
