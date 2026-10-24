// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Preset } from '../lib/api'
import { historyQueryClient } from '../features/history/historyQuery'
import StudioShell from './StudioShell'

const mocks = vi.hoisted(() => ({ bulk: vi.fn(), rename: vi.fn(), remove: vi.fn(), error: vi.fn(), audio: null as HTMLAudioElement | null, release: vi.fn(), queue: [] as Array<{ status: string }> }))
vi.mock('../lib/api', async (original) => ({
  ...await original<typeof import('../lib/api')>(),
  listPresets: vi.fn().mockResolvedValue({ presets: [
    { id: 'uploaded', name: 'Uploaded voice', is_builtin: false },
    { id: 'builtin', name: 'Built-in voice', is_builtin: true },
  ] }),
  listLanguages: vi.fn().mockResolvedValue({ languages: ['English'] }),
  getHealth: vi.fn().mockResolvedValue({ model_loaded: true, device: 'cuda' }),
  deleteAllRecords: mocks.bulk, renamePreset: mocks.rename, deleteHistoryEntry: mocks.remove,
}))
vi.mock('../features/startup/wake', () => ({ wakeBackend: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../features/startup/useBootStatus', () => ({ useBootStatus: () => null }))
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

beforeEach(() => { vi.clearAllMocks(); mocks.audio = null; mocks.queue = []; localStorage.clear(); historyQueryClient.clear(); mocks.bulk.mockResolvedValue({ deleted_ids: ['uploaded'], cleanup_failed: [] }) })
afterEach(() => { cleanup(); historyQueryClient.clear() })

function renderStudio() {
  return render(<QueryClientProvider client={historyQueryClient}><StudioShell /></QueryClientProvider>)
}

async function ready() {
  const view = renderStudio()
  await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('uploaded'))
  return view
}

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

it('keeps Generate disabled when the loaded model is on CPU', async () => {
  let finishHealth!: (value: { model_loaded: boolean; sample_rate: number; device: string; device_reason: string }) => void
  const { getHealth } = await import('../lib/api')
  vi.mocked(getHealth).mockReturnValueOnce(new Promise((resolve) => { finishHealth = resolve }))
  renderStudio()
  await waitFor(() => expect(finishHealth).toBeTypeOf('function'))
  await act(async () => {
    finishHealth({ model_loaded: true, sample_rate: 24000, device: 'cpu', device_reason: 'No usable GPU' })
  })
  expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Waiting for GPU model')
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
