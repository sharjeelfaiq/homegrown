// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ExternalToast } from 'sonner'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ClonedVoicesSection from './ClonedVoicesSection'
import * as api from '../../lib/api'
import type { Preset } from '../../lib/api'
import { apiQueryKeys } from '../history/historyQuery'

const toastMock = vi.hoisted(() => Object.assign(
  vi.fn((_message: string, options: ExternalToast): string => String(options.id ?? `cloning-toast-${toastMock.mock.calls.length}`)),
  { dismiss: vi.fn(), error: vi.fn() },
))
const runningPresetIds = vi.hoisted(() => new Set<string>())
vi.mock('sonner', () => ({ toast: toastMock }))

vi.mock('framer-motion', () => ({ AnimatePresence: ({ children }: { children: ReactNode }) => children, motion: { div: 'div', ul: 'ul' } }))
vi.mock('boneyard-js/react', () => ({ Skeleton: ({ children }: { children: ReactNode }) => children }))
vi.mock('../../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => false }))
vi.mock('../../lib/audio/AudioActivityContext', () => ({ useAudioActivity: () => ({ setActiveAudio: vi.fn(), releaseAudio: vi.fn() }) }))
vi.mock('../generation/GenerationActivityContext', () => ({ useGenerationActivity: () => ({ runningPresetIds }) }))
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { ...render(<QueryClientProvider client={queryClient}><ClonedVoicesSection {...props} /></QueryClientProvider>), props, queryClient }
}

afterEach(() => { cleanup(); localStorage.clear(); runningPresetIds.clear(); vi.useRealTimers(); vi.clearAllMocks() })

describe('ClonedVoicesSection', () => {
  it('uses the voice skeleton while the list is loading', () => {
    const { container } = renderSection({ loading: true, presets: [] })
    expect(container.querySelector('.cloned-voices-section')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search cloned voices' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clone voice' })).toBeInTheDocument()
    expect(container.querySelector('.cloned-voices-list .voice-menu-pick')).toBeInTheDocument()
    expect(screen.queryByText(/Loading your voices/)).not.toBeInTheDocument()
  })

  it('keeps the search input and all cloned voices visible', () => {
    const { container } = renderSection()
    expect(screen.getByRole('searchbox', { name: 'Search cloned voices' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search cloned voices' })).toHaveAttribute('placeholder', 'Search voices…')
    expect(screen.getByRole('option', { name: /Ada/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Bruno/ })).toBeInTheDocument()
    expect(container.querySelector('.cloned-voices-section.results > .voiceovers-card-header.voiceover-history-header > .mt-1 > .relative > .voiceover-search')).toBeTruthy()
    expect(container.querySelector('.cloned-voices-section > .history-context-toolbar')).not.toHaveTextContent('Cloned voices')
    expect(container.querySelector('.cloned-voices-section > .cloned-voices-list')).toBeTruthy()
    expect(screen.getByRole('option', { name: /Ada/ })).toHaveClass('-mx-2')
  })

  it('shows each voice’s completed voiceover count, including zero', () => {
    renderSection({ presets: presets.map((preset) => preset.id === 'ada'
      ? { ...preset, completed_voiceovers: 4 }
      : preset.id === 'bruno' ? { ...preset, completed_voiceovers: 0 } : preset) })
    expect(screen.getByLabelText('4 completed voiceovers')).toBeInTheDocument()
    expect(screen.getByLabelText('0 completed voiceovers')).toBeInTheDocument()
  })

  it('places the pulsing generation indicator before the completed voiceover count', () => {
    runningPresetIds.add('ada')
    renderSection({ presets: [{ ...presets[2], completed_voiceovers: 3 }] })
    const row = screen.getByRole('option', { name: /Ada/ })
    const indicator = row.querySelector('.voice-generation-indicator')!
    const count = screen.getByLabelText('3 completed voiceovers')

    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass('bg-progress', 'animate-pulse-soft')
    expect(indicator.compareDocumentPosition(count) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows the fresh paginated count over stale voice props and refreshes it after invalidation', async () => {
    let completedVoiceovers = 1
    const listSpy = vi.spyOn(api, 'listPresets').mockImplementation(async () => ({
      presets: [{ ...presets[2], completed_voiceovers: completedVoiceovers }],
      total: 1,
    }))
    const { queryClient } = renderSection({ presets: [{ ...presets[2], completed_voiceovers: 0 }] })

    await waitFor(() => expect(screen.getByLabelText('1 completed voiceovers')).toBeInTheDocument())
    expect(listSpy).toHaveBeenCalledTimes(1)

    completedVoiceovers = 2
    await queryClient.invalidateQueries({ queryKey: apiQueryKeys.voices })
    await waitFor(() => expect(screen.getByLabelText('2 completed voiceovers')).toBeInTheDocument())
    expect(screen.queryByLabelText('0 completed voiceovers')).not.toBeInTheDocument()
  })

  it('paginates voices, disables page boundaries, and resets to the first page on search', async () => {
    const manyVoices = Array.from({ length: 55 }, (_, index): Preset => ({
      ...presets[2], id: `voice-${index + 1}`, name: `Voice ${index + 1}`, created_at: index + 1,
    }))
    const listSpy = vi.spyOn(api, 'listPresets').mockImplementation(async (options = {}) => ({
      presets: manyVoices.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? manyVoices.length)),
      total: manyVoices.length,
    }))
    renderSection({ presets: manyVoices })
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith({ limit: 50, offset: 0, q: undefined }))
    expect(screen.getAllByRole('option').some((option) => option.textContent?.includes('Voice 1'))).toBe(true)
    expect(screen.getAllByRole('option')).toHaveLength(50)
    expect(screen.getAllByRole('option').some((option) => option.textContent?.includes('Voice 51'))).toBe(false)
    expect(screen.getByText('55 voices')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith({ limit: 50, offset: 50, q: undefined }))
    expect(screen.getAllByRole('option')).toHaveLength(5)
    expect(screen.getAllByRole('option').some((option) => option.textContent?.includes('Voice 51'))).toBe(true)
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('button', { name: 'Voices per page' }))
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(['50', '80', '100'])
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '80' }))
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith({ limit: 80, offset: 0, q: undefined }))
    expect(screen.getAllByRole('option').some((option) => option.textContent?.includes('Voice 1'))).toBe(true)
    expect(screen.getAllByRole('option')).toHaveLength(55)
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Voices per page' })).toHaveTextContent('80')
    expect(localStorage.getItem('homegrown.voicePageSize')).toBe('80')
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search cloned voices' }), { target: { value: 'voice 1' } })
    expect(screen.getAllByRole('option').some((option) => option.textContent?.includes('Voice 1'))).toBe(true)
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  })

  it('defaults to 50 voices per page and restores valid saved sizes', () => {
    const { unmount } = renderSection()
    expect(screen.getByRole('button', { name: 'Voices per page' })).toHaveTextContent('50')
    unmount()
    localStorage.setItem('homegrown.voicePageSize', '100')
    renderSection()
    expect(screen.getByRole('button', { name: 'Voices per page' })).toHaveTextContent('100')
  })

  it('falls back to 50 when the saved page size is no longer supported', () => {
    localStorage.setItem('homegrown.voicePageSize', '25')
    renderSection()
    expect(screen.getByRole('button', { name: 'Voices per page' })).toHaveTextContent('50')
  })

  it('ignores an older page response after the search changes', async () => {
    const manyVoices = Array.from({ length: 12 }, (_, index): Preset => ({
      ...presets[2], id: `voice-${index + 1}`, name: `Voice ${index + 1}`, created_at: index + 1,
    }))
    let resolveInitial!: (result: { presets: Preset[]; total: number }) => void
    let resolveSearch!: (result: { presets: Preset[]; total: number }) => void
    vi.spyOn(api, 'listPresets')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSearch = resolve }))

    renderSection({ presets: manyVoices })
    await waitFor(() => expect(api.listPresets).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search cloned voices' }), { target: { value: 'Voice 12' } })
    await waitFor(() => expect(api.listPresets).toHaveBeenCalledTimes(2))

    await act(async () => { resolveSearch({ presets: [manyVoices[11]], total: 1 }) })
    expect(screen.getAllByRole('option').some((option) => option.textContent?.includes('Voice 12'))).toBe(true)
    await act(async () => { resolveInitial({ presets: manyVoices.slice(0, 10), total: 12 }) })
    expect(screen.getAllByRole('option').some((option) => option.textContent?.includes('Voice 12'))).toBe(true)
    expect(screen.getByText('1 voices')).toBeInTheDocument()
  })

  it('reconciles server page rows with current Studio voices after rename and pending delete', async () => {
    let livePresets = [...presets]
    vi.spyOn(api, 'listPresets').mockImplementation(async (options = {}) => {
      const needle = options.q?.trim().toLowerCase() ?? ''
      const matching = livePresets.filter((preset) => !needle || preset.name.toLowerCase().includes(needle))
      const limit = options.limit ?? matching.length
      return { presets: matching.slice(options.offset ?? 0, (options.offset ?? 0) + limit), total: matching.length }
    })
    const { props, rerender } = renderSection()
    await waitFor(() => expect(screen.getByRole('option', { name: /Ada/ })).toBeInTheDocument())

    livePresets = livePresets.map((preset) => preset.id === 'ada' ? { ...preset, name: 'Ada Renamed' } : preset)
    rerender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ClonedVoicesSection {...props} presets={livePresets} /></QueryClientProvider>)
    await waitFor(() => expect(screen.getByRole('option', { name: /Ada Renamed/ })).toBeInTheDocument())
    expect(screen.queryByRole('option', { name: /^Ada$/ })).not.toBeInTheDocument()

    livePresets = livePresets.filter((preset) => preset.id !== 'ada')
    rerender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ClonedVoicesSection {...props} presets={livePresets} /></QueryClientProvider>)
    await waitFor(() => expect(screen.queryByRole('option', { name: /Ada Renamed/ })).not.toBeInTheDocument())
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

  it('omits legacy built-ins from voice rows and search results', () => {
    renderSection()
    expect(screen.getByRole('option', { name: /Ada/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Vivian|Serena/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Built-in voices')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search cloned voices' }), { target: { value: 'viv' } })
    expect(screen.queryByRole('option', { name: /Vivian/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Ada/ })).not.toBeInTheDocument()
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
    expect(container.querySelector('[data-tooltip="Available when the voice model is ready."]')).toBeTruthy()
  })

  it('keeps Clone voice left-aligned with its original label and upload icon while cloning', () => {
    const { container } = renderSection({ onAddVoice: () => new Promise(() => {}) })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['audio'], 'voice.wav', { type: 'audio/wav' })] } })
    const action = container.querySelector('.clone-voice-button')
    expect(action).toBeEnabled()
    expect(action).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('button', { name: 'Clone voice' })).toHaveTextContent('Clone voice')
    expect(action?.querySelector('.lucide-upload')).toBeTruthy()
    expect(action?.querySelector('[data-status]')).toBeNull()
    expect(action?.parentElement?.parentElement).not.toHaveClass('ml-auto')
    expect(screen.queryByText(/Cloned voices ·/)).not.toBeInTheDocument()
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
    expect(toastMock).toHaveBeenCalledWith('Your uploaded voice is getting cloned', expect.objectContaining({ duration: Infinity }))
    expect(toastMock.mock.calls.find(([message]) => message === 'Your uploaded voice is getting cloned')![1].icon).toMatchObject({ props: { status: 'running', size: 18, color: 'var(--progress)' } })
    expect(button.innerHTML).toBe(originalContents)
    expect(toastMock.dismiss).not.toHaveBeenCalled()
    expect(onAddVoice).toHaveBeenCalledTimes(1)
    await act(async () => { finish(result) })
    if (result === 'done') {
      expect(toastMock.dismiss).not.toHaveBeenCalled()
      expect(toastMock).toHaveBeenLastCalledWith('Your voice has been cloned', expect.objectContaining({
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
    expect(toastMock).toHaveBeenCalledWith('Your uploaded voice is getting cloned', expect.anything())
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
    expect(toastMock).toHaveBeenCalledWith('Your uploaded voice is waiting to be cloned', expect.objectContaining({ description: second.name }))
    await act(async () => { finish[0]('done') })
    expect(onAddVoice).toHaveBeenNthCalledWith(2, second)
    await act(async () => { finish[1]('done') })
  })

  it('shows the active clone and waiting files in the Voices list, then hands each off to its saved row', async () => {
    const finish: Array<(result: 'done') => void> = []
    const onAddVoice = vi.fn(() => new Promise<'done'>((resolve) => { finish.push(resolve) }))
    const { container } = renderSection({ onAddVoice })
    const input = container.querySelector('input[type="file"]')!
    const first = new File(['audio'], 'first-voice.wav', { type: 'audio/wav' })
    const second = new File(['audio'], 'second-voice.mp3', { type: 'audio/mpeg' })

    fireEvent.change(input, { target: { files: [first, second] } })
    expect(screen.getByText('first voice')).toBeInTheDocument()
    expect(screen.getByText('Cloning')).toHaveAttribute('role', 'status')
    expect(screen.getByText('second voice')).toBeInTheDocument()
    expect(screen.getByText('In queue')).toBeInTheDocument()

    await act(async () => { finish[0]('done') })
    expect(screen.queryByText('first voice')).not.toBeInTheDocument()
    expect(screen.getByText('second voice')).toBeInTheDocument()
    expect(screen.getByText('Cloning')).toBeInTheDocument()
    await act(async () => { finish[1]('done') })
    expect(screen.queryByText('second voice')).not.toBeInTheDocument()
  })

})
