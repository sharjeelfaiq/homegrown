// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Preset } from '../lib/api'
import { historyQueryClient } from '../features/history/historyQuery'
import StudioShell from './StudioShell'

const mocks = vi.hoisted(() => ({ bulk: vi.fn(), rename: vi.fn(), remove: vi.fn(), error: vi.fn(), audio: null as HTMLAudioElement | null, release: vi.fn() }))
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
vi.mock('../features/generation/GenerationActivityContext', () => ({ useGenerationActivity: () => ({ queue: [], refresh: vi.fn(), reachable: true }) }))
vi.mock('../features/history/historyQuery', async original => ({
  ...await original<typeof import('../features/history/historyQuery')>(), invalidateHistory: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('sonner', () => ({ Toaster: () => null, toast: Object.assign(vi.fn(), { error: mocks.error, dismiss: vi.fn() }) }))
vi.mock('../components/ui/Tooltip', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../components/effects/ParticleText', () => ({ default: () => null }))
vi.mock('../components/effects/CursorGrid', () => ({ default: () => null }))
vi.mock('../features/mascots/MascotPicker', () => ({ default: () => null }))
vi.mock('../features/startup/BootOverlay', () => ({ default: () => null }))
vi.mock('../features/generation/ScriptBlock', () => ({ default: () => null }))
vi.mock('../features/generation/GenerateButton', () => ({ default: () => null }))
vi.mock('boneyard-js/react', () => ({ Skeleton: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../features/settings/SettingsModal', () => ({ default: ({ onBulkDelete }: { onBulkDelete: (kind: 'presets' | 'history', password: string) => Promise<unknown> }) => <>
  <button onClick={() => { void onBulkDelete('presets', 'test-admin-password').catch(mocks.error) }}>Bulk voices</button>
  <button onClick={() => { void onBulkDelete('history', 'test-admin-password').catch(mocks.error) }}>Bulk history</button>
</> }))
vi.mock('../features/voices/ClonedVoicesSection', () => ({ default: ({ presets, selectedPresetId, onRename, onCloneBusyChange }: {
  presets: Preset[]; selectedPresetId: string | null; onRename: (id: string, name: string) => Promise<void>; onCloneBusyChange: (busy: boolean) => void
}) => <>
  <span data-testid="selected">{selectedPresetId ?? 'none'}</span>
  {presets.map(p => <span key={p.id}>{p.name}</span>)}
  <button onClick={() => { void onRename('uploaded', 'Renamed') }}>Rename uploaded</button>
  <button onClick={() => onCloneBusyChange(true)}>Queue clones</button>
</> }))
vi.mock('../features/history/HistoryList', () => ({ default: ({ onDelete }: { onDelete: (id: string) => Promise<void> }) =>
  <button onClick={() => { void onDelete('history-one').catch(mocks.error) }}>Delete one voiceover</button> }))

beforeEach(() => { vi.clearAllMocks(); mocks.audio = null; localStorage.clear(); historyQueryClient.clear(); mocks.bulk.mockResolvedValue({ deleted_ids: ['uploaded'], cleanup_failed: [] }) })
afterEach(() => { cleanup(); historyQueryClient.clear() })

async function ready() {
  render(<StudioShell />)
  await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('uploaded'))
}

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
