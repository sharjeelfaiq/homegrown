// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Preset } from '../lib/api'
import { historyQueryClient } from '../features/history/historyQuery'
import StudioShell from './StudioShell'

const mocks = vi.hoisted(() => ({ bulk: vi.fn(), rename: vi.fn(), remove: vi.fn(), error: vi.fn(), audio: null as HTMLAudioElement | null, release: vi.fn(), queue: [] as Array<{ status: string }>, boot: null as { phase: string; detail: string | null; percent: number | null } | null }))
vi.mock('../lib/api', async (original) => ({
  ...await original<typeof import('../lib/api')>(),
  listPresets: vi.fn().mockResolvedValue({ presets: [
    { id: 'uploaded', name: 'Uploaded voice', is_builtin: false },
    { id: 'builtin', name: 'Built-in voice', is_builtin: true },
  ] }),
  listLanguages: vi.fn().mockResolvedValue({ languages: ['English'] }),
  getHealth: vi.fn().mockResolvedValue({
    model_loaded: true,
    generation_ready: true,
    device: 'cuda',
    device_reason: 'NVIDIA GeForce RTX 4090 (sm_89)',
  }),
  deleteAllRecords: mocks.bulk, renamePreset: mocks.rename, deleteHistoryEntry: mocks.remove,
}))
vi.mock('../features/startup/wake', () => ({ wakeBackend: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../features/startup/useBootStatus', () => ({ useBootStatus: () => mocks.boot }))
vi.mock('../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => true }))
vi.mock('../features/onboarding/useOnboardingTour', () => ({ useOnboardingTour: () => ({ startTour: vi.fn() }) }))
vi.mock('../features/generation/useJobToasts', () => ({ useJobToasts: vi.fn() }))
vi.mock('../lib/theme/ThemeContext', () => ({ useTheme: () => ({ theme: 'studio' }) }))
vi.mock('../lib/audio/AudioActivityContext', () => ({ useAudioActivity: () => ({ activeAudio: mocks.audio, releaseAudio: mocks.release }) }))
vi.mock('../features/generation/GenerationActivityContext', () => ({ useGenerationActivity: () => ({ queue: mocks.queue, refresh: vi.fn(), reachable: true }) }))
vi.mock('../features/history/historyQuery', async original => ({
  ...await original<typeof import('../features/history/historyQuery')>(), invalidateHistory: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('sonner', () => ({ Toaster: () => null, toast: Object.assign(vi.fn(), { error: mocks.error, dismiss: vi.fn() }) }))
vi.mock('../components/ui/Tooltip', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../components/effects/ParticleText', () => ({ default: () => null }))
vi.mock('../components/effects/CursorGrid', () => ({ default: () => null }))
vi.mock('../features/mascots/MascotPicker', () => ({ default: () => null }))
vi.mock('../features/startup/BootOverlay', () => ({ default: () => null }))
vi.mock('../features/generation/ScriptBlock', () => ({ default: ({ generateAction }: { generateAction: React.ReactNode }) => <div>{generateAction}</div> }))
vi.mock('../features/generation/GenerateButton', () => ({ default: ({ disabled, blockedReason }: { disabled: boolean; blockedReason?: string | null }) => <>
  <button aria-label="Generate" disabled={disabled}>Generate</button>
  {blockedReason && <span role="status">{blockedReason}</span>}
</> }))
vi.mock('boneyard-js/react', () => ({ Skeleton: ({ children, fixture, loading, name }: {
  children: React.ReactNode; fixture?: React.ReactNode; loading?: boolean; name?: string
}) => loading ? <div data-testid={`skeleton-${name}`}>{fixture}</div> : children }))
vi.mock('../features/settings/SettingsModal', () => ({ default: ({ onBulkDelete }: { onBulkDelete: (kind: 'presets' | 'history', password: string) => Promise<unknown> }) => <>
  <button onClick={() => { void onBulkDelete('presets', 'test-admin-password').catch(mocks.error) }}>Bulk voices</button>
  <button onClick={() => { void onBulkDelete('history', 'test-admin-password').catch(mocks.error) }}>Bulk history</button>
</> }))
vi.mock('../features/voices/ClonedVoicesSection', () => ({ default: ({ presets, selectedPresetId, onRename, onCloneBusyChange }: {
  presets: Preset[]; selectedPresetId: string | null; onRename: (id: string, name: string) => Promise<void>; onCloneBusyChange: (busy: boolean) => void
}) => <>
  <span data-testid="selected">{selectedPresetId ?? 'none'}</span>
  {presets.map(p => <span key={p.id}>{p.name}<span data-testid={`count-${p.id}`}>{p.completed_voiceovers ?? 0}</span></span>)}
  <button onClick={() => { void onRename('uploaded', 'Renamed') }}>Rename uploaded</button>
  <button onClick={() => onCloneBusyChange(true)}>Queue clones</button>
</> }))
vi.mock('../features/history/HistoryList', () => ({ default: ({ onDelete }: { onDelete: (id: string) => Promise<void> }) =>
  <button onClick={() => { void onDelete('history-one').catch(mocks.error) }}>Delete one voiceover</button> }))

beforeEach(() => { vi.clearAllMocks(); mocks.audio = null; mocks.queue = []; mocks.boot = null; localStorage.clear(); historyQueryClient.clear(); mocks.bulk.mockResolvedValue({ deleted_ids: ['uploaded'], cleanup_failed: [] }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); historyQueryClient.clear() })

function renderStudio() {
  return render(<QueryClientProvider client={historyQueryClient}><StudioShell /></QueryClientProvider>)
}

async function ready() {
  const view = renderStudio()
  await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('uploaded'))
  return view
}

it('shows a generic voice engine status and active graphics card from backend health', async () => {
  await ready()
  expect(screen.getByText('Voice engine')).toBeInTheDocument()
  expect(screen.getByText('Ready')).toBeInTheDocument()
  expect(screen.queryByText(/Qwen|custom voice model/i)).not.toBeInTheDocument()
  expect(screen.getByText('NVIDIA GeForce RTX 4090')).toBeInTheDocument()
})
it('renders the Studio shell immediately while backend readiness is pending', async () => {
  const { wakeBackend } = await import('../features/startup/wake')
  let finish!: () => void
  vi.mocked(wakeBackend).mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve }))
  renderStudio()
  expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Open settings' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
  await act(async () => { finish() })
})

it('shows the same model choice screen when the backend has no installed model', async () => {
  const { wakeBackend } = await import('../features/startup/wake')
  const { getHealth } = await import('../lib/api')
  vi.mocked(getHealth).mockResolvedValue({
    model_loaded: false,
    generation_ready: false,
    sample_rate: null,
    device: 'cpu',
    device_reason: 'No usable GPU',
    device_ready: true,
  })
  vi.mocked(wakeBackend).mockImplementationOnce(async (onStatus) => {
    onStatus?.('onboarding', 0)
  })
  renderStudio()
  expect(await screen.findByRole('heading', { name: 'Set up voice generation' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download Standard' })).toBeEnabled()
  expect(screen.getByText('Higher quality')).toBeInTheDocument()
  expect(screen.getAllByText(/hardware details are unavailable/i).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/unknown · unknown/i).length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
})

it('keeps onboarding open with a retryable message when the model download request fails', async () => {
  const { wakeBackend } = await import('../features/startup/wake')
  vi.mocked(wakeBackend).mockImplementationOnce(async (onStatus) => {
    onStatus?.('onboarding', 0)
  })
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    if (String(input) === '/api/models') return { ok: true, json: async () => ({ choices: { standard: { available: true, installed: false, reason: null } } }) } as Response
    if (String(input) === '/api/models/select') return { ok: true, json: async () => ({ state: 'needs_download' }) } as Response
    if (String(input) === '/api/models/download') return { ok: false, json: async () => ({ detail: 'Download unavailable' }) } as Response
    return { ok: true, json: async () => ({}) } as Response
  }))

  renderStudio()
  fireEvent.click(await screen.findByRole('button', { name: 'Download Standard' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Download unavailable')
  expect(screen.getByRole('heading', { name: 'Set up voice generation' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download Standard' })).toBeEnabled()
})

it('keeps the choice dialog open during download polling and shows download progress', async () => {
  const { wakeBackend } = await import('../features/startup/wake')
  const { getHealth } = await import('../lib/api')
  vi.mocked(getHealth).mockResolvedValue({
    model_loaded: false,
    generation_ready: false,
    sample_rate: null,
    device: 'cuda',
    device_reason: 'NVIDIA GeForce RTX 4090 (sm_89)',
    device_ready: true,
  })
  vi.mocked(wakeBackend)
    .mockImplementationOnce(async (onStatus) => { onStatus?.('onboarding', 0) })
    .mockImplementationOnce(() => new Promise<void>(() => {}))
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    if (String(input) === '/api/models') return { ok: true, json: async () => ({ choices: { standard: { available: true, installed: false, reason: null } } }) } as Response
    if (String(input) === '/api/models/select') return { ok: true, json: async () => ({ state: 'needs_download' }) } as Response
    if (String(input) === '/api/models/download') return { ok: true, json: async () => ({ ok: true }) } as Response
    return { ok: true, json: async () => ({}) } as Response
  }))

  const view = renderStudio()
  fireEvent.click(await screen.findByRole('button', { name: 'Download Standard' }))
  await waitFor(() => expect(wakeBackend).toHaveBeenCalledTimes(2))
  mocks.boot = { phase: 'downloading', detail: '1.0 GB of 2.5 GB', percent: 42 }
  view.rerender(<QueryClientProvider client={historyQueryClient}><StudioShell /></QueryClientProvider>)

  expect(screen.getByRole('heading', { name: 'Set up voice generation' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Downloading 42%' })).toBeDisabled()
  expect(screen.getByText('Voice engine').parentElement).toHaveTextContent('Downloading 42%')
  expect(screen.getByRole('status')).toHaveTextContent('Downloading Standard42%')
  expect(screen.getByText('NVIDIA GeForce RTX 4090')).toBeInTheDocument()
})

it('accepts a successfully loaded CPU model and explains the slow path', async () => {
  const { getHealth } = await import('../lib/api')
  vi.mocked(getHealth).mockResolvedValue({ model_loaded: true, generation_ready: true, sample_rate: 24000, device: 'cpu', device_reason: 'No usable GPU' })
  renderStudio()
  expect(await screen.findByText(/Generation can take many minutes per chunk/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
  expect(screen.queryByText('Waiting for GPU model')).not.toBeInTheDocument()
})

it('filters legacy built-ins from active voice choices and ignores a stale rename rollback', async () => {
  let fail!: (error: Error) => void
  mocks.rename.mockReturnValue(new Promise((_resolve, reject) => { fail = reject }))
  await ready()
  fireEvent.click(screen.getByText('Rename uploaded'))
  fireEvent.click(screen.getByText('Bulk voices'))
  await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('none'))
  await act(async () => { fail(new Error('Old request failed')) })
  expect(screen.queryByText('Uploaded voice')).toBeNull()
  expect(screen.queryByText('Renamed')).toBeNull()
  expect(screen.queryByText('Built-in voice')).toBeNull()
})

it('refreshes voiceover counts when a generation job completes', async () => {
  const { listPresets } = await import('../lib/api')
  const view = await ready()
  expect(screen.getByTestId('count-uploaded')).toHaveTextContent('0')
  vi.mocked(listPresets).mockResolvedValueOnce({
    presets: [{
      id: 'uploaded', name: 'Uploaded voice', language: 'English', ref_text: '', audio_path: '',
      tag: '', is_builtin: false, preview_url: '', created_at: 0, completed_voiceovers: 1,
    }],
    total: 1,
  })

  mocks.queue = [{ status: 'done' }]
  view.rerender(<QueryClientProvider client={historyQueryClient}><StudioShell /></QueryClientProvider>)

  await waitFor(() => expect(screen.getByTestId('count-uploaded')).toHaveTextContent('1'))
  expect(listPresets).toHaveBeenCalledTimes(2)
})

it('does not restore deleted history from a stale individual-delete rollback', async () => {
  let fail!: (error: Error) => void
  mocks.remove.mockReturnValue(new Promise((_resolve, reject) => { fail = reject }))
  mocks.bulk.mockResolvedValue({ deleted_ids: ['history-one'], cleanup_failed: [] })
  mocks.audio = Object.assign(document.createElement('audio'), { src: '/audio/history-one.mp3', pause: vi.fn() })
  await ready()
  const key = ['voiceover-history', 'local-user', {}]
  historyQueryClient.setQueryData(key, { history: [{ id: 'history-one' }], total: 1 })
  fireEvent.click(screen.getByText('Delete one voiceover'))
  fireEvent.click(screen.getByText('Bulk history'))
  await waitFor(() => expect(historyQueryClient.getQueryData(key)).toEqual({ history: [], total: 0 }))
  await act(async () => { fail(new Error('Old delete failed')) })
  expect(historyQueryClient.getQueryData(key)).toEqual({ history: [], total: 0 })
  expect(mocks.audio.pause).toHaveBeenCalledOnce()
  expect(mocks.release).toHaveBeenCalledWith(mocks.audio)
})

it('refuses bulk voice deletion when the browser has queued clones', async () => {
  await ready()
  fireEvent.click(screen.getByText('Queue clones'))
  fireEvent.click(screen.getByText('Bulk voices'))
  await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('queued voices') })))
  expect(mocks.bulk).not.toHaveBeenCalled()
  expect(screen.getByTestId('selected').textContent).toBe('uploaded')
})
