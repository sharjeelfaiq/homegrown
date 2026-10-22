// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ExternalToast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ClonedVoicesSection from './ClonedVoicesSection'
import type { Preset } from '../../lib/api'

const toastMock = vi.hoisted(() => Object.assign(
  vi.fn((_message: string, options: ExternalToast): string => String(options.id ?? `cloning-toast-${toastMock.mock.calls.length}`)),
  { dismiss: vi.fn(), error: vi.fn() },
))
vi.mock('sonner', () => ({ toast: toastMock }))

vi.mock('framer-motion', () => ({ AnimatePresence: ({ children }: { children: ReactNode }) => children, motion: { div: 'div', ul: 'ul' } }))
vi.mock('../../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => false }))
vi.mock('../../lib/audio/AudioActivityContext', () => ({ useAudioActivity: () => ({ setActiveAudio: vi.fn(), releaseAudio: vi.fn() }) }))
vi.mock('../generation/GenerationActivityContext', () => ({ useGenerationActivity: () => ({ runningPresetIds: new Set<string>() }) }))
vi.mock('../../components/ui/InlineName', () => ({ default: ({ value }: { value: string }) => <span>{value}</span> }))
vi.mock('../../components/ui/Tooltip', () => ({
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
    onAddVoice: vi.fn().mockResolvedValue('done'),
    ...overrides,
  }
  return { ...render(<ClonedVoicesSection {...props} />), props }
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })

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

  it('keeps the original Clone voice label and upload icon while cloning', () => {
    const { container } = renderSection({ onAddVoice: () => new Promise(() => {}) })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['audio'], 'voice.wav', { type: 'audio/wav' })] } })
    const action = container.querySelector('.clone-voice-button')
    expect(action).toBeEnabled()
    expect(action).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('button', { name: 'Clone voice' })).toHaveTextContent('Clone voice')
    expect(action?.querySelector('.lucide-upload')).toBeTruthy()
    expect(action?.querySelector('[data-status]')).toBeNull()
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

  it.each(['done', 'failed'] as const)('keeps the button unchanged and completes the cloning toast after %s', async (result) => {
    let finish!: (value: 'done' | 'failed') => void
    const onAddVoice = vi.fn(() => new Promise<'done' | 'failed'>((resolve) => { finish = resolve }))
    const { container } = renderSection({ onAddVoice })
    const button = screen.getByRole('button', { name: 'Clone voice' })
    const originalContents = button.innerHTML
    const input = container.querySelector('input[type="file"]')!
    const file = new File(['audio'], 'voice.wav', { type: 'audio/wav' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(toastMock).toHaveBeenCalledWith('Your uploaded voice is getting cloned.', expect.objectContaining({ duration: Infinity }))
    expect(toastMock.mock.calls.find(([message]) => message === 'Your uploaded voice is getting cloned.')![1].icon).toMatchObject({ props: { status: 'running', size: 18, color: 'var(--progress)' } })
    expect(button.innerHTML).toBe(originalContents)
    expect(toastMock.dismiss).not.toHaveBeenCalled()
    expect(onAddVoice).toHaveBeenCalledTimes(1)
    await act(async () => { finish(result) })
    if (result === 'done') {
      expect(toastMock.dismiss).not.toHaveBeenCalled()
      expect(toastMock).toHaveBeenLastCalledWith('Your voice has been cloned.', expect.objectContaining({
        id: 'cloning-toast-1', duration: 1000,
        icon: expect.objectContaining({ props: expect.objectContaining({ status: 'done', doneColor: 'var(--green)' }) }),
      }))
    } else {
      expect(toastMock.dismiss).toHaveBeenCalledWith('cloning-toast-1')
      expect(toastMock).toHaveBeenCalledTimes(2)
    }
    expect(button.innerHTML).toBe(originalContents)
  })

  it('shows the same cloning toast for a dropped file and clears it on unmount', async () => {
    let finish!: (value: 'done') => void
    const onAddVoice = vi.fn(() => new Promise<'done'>((resolve) => { finish = resolve }))
    const { container, unmount } = renderSection({ onAddVoice })
    const file = new File(['audio'], 'voice.wav', { type: 'audio/wav' })
    fireEvent.drop(container.querySelector('.cloned-voices-section')!, { dataTransfer: { types: ['Files'], files: [file] } })
    expect(onAddVoice).toHaveBeenCalledWith(file)
    expect(toastMock).toHaveBeenCalledWith('Your uploaded voice is getting cloned.', expect.anything())
    unmount()
    expect(toastMock.dismiss).toHaveBeenCalledWith('cloning-toast-1')
    await act(async () => { finish('done') })
    expect(toastMock).toHaveBeenCalledTimes(2) // Never recreate a toast after unmount.
  })
  it.each(['picker', 'drop'] as const)('accepts multiple audio files from the %s and clones them in order', async (source) => {
    const finish: Array<(result: 'done') => void> = []
    const onAddVoice = vi.fn(() => new Promise<'done'>((resolve) => { finish.push(resolve) }))
    const { container } = renderSection({ onAddVoice })
    const input = container.querySelector('input[type="file"]')!
    expect(input).toHaveAttribute('multiple')
    const first = new File(['audio'], 'first.wav', { type: 'audio/wav' })
    const second = new File(['audio'], 'second.mp3', { type: 'audio/mpeg' })
    const files = [first, new File(['text'], 'notes.txt', { type: 'text/plain' }), second]
    if (source === 'picker') fireEvent.change(input, { target: { files } })
    else fireEvent.drop(container.querySelector('.cloned-voices-section')!, { dataTransfer: { types: ['Files'], files } })
    expect(onAddVoice).toHaveBeenCalledExactlyOnceWith(first)
    expect(screen.getByRole('button', { name: 'Clone voice' })).toBeEnabled()
    expect(toastMock).toHaveBeenCalledWith('Your uploaded voice is waiting to be cloned.', expect.objectContaining({ description: second.name }))
    await act(async () => { finish[0]('done') })
    expect(onAddVoice).toHaveBeenNthCalledWith(2, second)
    await act(async () => { finish[1]('done') })
  })

})
