// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import SettingsModal from './SettingsModal'
import type { BulkDeleteResult } from '../../lib/api'
import type { ExternalToast } from 'sonner'

const toastMock = vi.hoisted(() => Object.assign(vi.fn((_message: string, _options?: ExternalToast) => 'bulk-toast'), { error: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('./ThemeSwitch', () => ({ default: () => <button>Theme</button> }))
vi.mock('../../components/ui/Tooltip', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => true }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

function setup(onBulkDelete: (kind: 'history' | 'presets', adminPassword: string) => Promise<BulkDeleteResult> = vi.fn().mockResolvedValue({ deleted_ids: ['one'], cleanup_failed: [] })) {
  render(<SettingsModal open onClose={vi.fn()} mascotEnabled onMascotEnabledChange={vi.fn()} onBulkDelete={onBulkDelete} />)
  return onBulkDelete
}

it('requires confirmation and Cancel keeps data unchanged', async () => {
  const remove = setup()
  expect(screen.getByText('Danger Zone')).toBeTruthy()
  expect(remove).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Delete all generated voiceovers' }))
  expect(screen.getByText(/across all pages/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Delete all generated voiceovers' })).toBeTruthy())
  expect(remove).not.toHaveBeenCalled()
})

it.each([
  ['Delete all generated voiceovers', 'history'],
  ['Delete all uploaded voices', 'presets'],
])('confirms %s, prevents duplicate submissions, and reports completion', async (label, kind) => {
  let finish!: (value: { deleted_ids: string[]; cleanup_failed: string[] }) => void
  const remove = setup(vi.fn(() => new Promise<BulkDeleteResult>((resolve) => { finish = resolve })))
  fireEvent.click(screen.getByRole('button', { name: label }))
  fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
  fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'test-admin-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Delete permanently' }) as HTMLButtonElement).disabled).toBe(true))
  expect(remove).toHaveBeenCalledExactlyOnceWith(kind, 'test-admin-password')
  await act(async () => finish({ deleted_ids: ['one', 'two'], cleanup_failed: [] }))
  expect(toastMock.mock.calls.at(-1)?.[0]).toMatch(/^Deleted 2 /)
  expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(false)
})

it('reports cleanup failures separately from successful record deletion', async () => {
  setup(vi.fn().mockResolvedValue({ deleted_ids: ['one'], cleanup_failed: ['locked.mp3'] }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete all generated voiceovers' }))
  fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
  fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'test-admin-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('Deleted 1'), expect.objectContaining({ description: '1 media file remains on disk.' })))
})

it('shows active-work failures without a success toast and permits retry', async () => {
  setup(vi.fn().mockRejectedValue(new Error('Wait for voice cloning to finish.')))
  fireEvent.click(screen.getByRole('button', { name: 'Delete all uploaded voices' }))
  fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
  fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'test-admin-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Wait for voice cloning to finish.'))
  expect((screen.getByRole('button', { name: 'Delete permanently' }) as HTMLButtonElement).disabled).toBe(false)
})
