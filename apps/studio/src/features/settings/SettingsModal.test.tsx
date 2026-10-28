// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import SettingsModal from './SettingsModal'
import type { BackupDownload, BulkDeleteResult, RestoreResult } from '../../lib/api'
import type { ExternalToast } from 'sonner'

const toastMock = vi.hoisted(() => Object.assign(vi.fn((_message: string, _options?: ExternalToast) => 'bulk-toast'), { error: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('./ThemeSwitch', () => ({ default: () => <button>Theme</button> }))
vi.mock('../../components/ui/Tooltip', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => true }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

function setup(onBulkDelete: (kind: 'history' | 'presets', adminPassword: string) => Promise<BulkDeleteResult> = vi.fn().mockResolvedValue({ deleted_ids: ['one'], cleanup_failed: [] }), onBackup: (password: string) => Promise<BackupDownload> = vi.fn().mockResolvedValue({ blob: new Blob(['backup']), filename: 'homegrown-backup.zip' }), onRestore: (password: string, file: File) => Promise<RestoreResult> = vi.fn().mockResolvedValue({ ok: true, pre_restore_backup: 'homegrown-pre-restore.zip' })) {
  render(<SettingsModal open onClose={vi.fn()} mascotEnabled onMascotEnabledChange={vi.fn()} onBulkDelete={onBulkDelete} onBackup={onBackup} onRestore={onRestore} />)
  return onBulkDelete
}

function openBackup() {
  fireEvent.click(screen.getByRole('tab', { name: 'Backup' }))
}

function openDangerZone() {
  fireEvent.click(screen.getByRole('tab', { name: 'Danger Zone' }))
}

it('opens Appearance by default and supports accessible keyboard tab navigation', () => {
  setup()
  const appearance = screen.getByRole('tab', { name: 'Appearance' })
  expect(appearance).toHaveAttribute('aria-selected', 'true')
  expect(document.getElementById(appearance.getAttribute('aria-controls')!)).toHaveAttribute('role', 'tabpanel')

  fireEvent.keyDown(appearance, { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: 'Backup' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Backup' }), { key: 'ArrowRight' })
  const danger = screen.getByRole('tab', { name: 'Danger Zone' })
  expect(danger).toHaveAttribute('aria-selected', 'true')
  expect(danger).toHaveFocus()
  expect(document.getElementById(danger.getAttribute('aria-controls')!)).toHaveAttribute('aria-labelledby', danger.id)
})

it('shows Backup before Danger Zone and opens its password prompt', () => {
  setup()
  const tabs = screen.getAllByRole('tab')
  expect(tabs.map((tab) => tab.textContent)).toEqual(['Appearance', 'Backup', 'Danger Zone'])
  openBackup()
  expect(screen.getByText(/persisted voices, history, queue state/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Download backup' }))
  expect(screen.getByRole('heading', { name: 'Admin password required' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Download backup' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Enter the admin password')
})

it('downloads a backup and resets the prompt', async () => {
  const onBackup = vi.fn().mockResolvedValue({ blob: new Blob(['backup']), filename: 'homegrown-backup-test.zip' })
  setup(undefined, onBackup)
  openBackup()
  fireEvent.click(screen.getByRole('button', { name: 'Download backup' }))
  fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'test-admin-password' } })
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  fireEvent.click(screen.getByRole('button', { name: 'Download backup' }))
  await waitFor(() => expect(onBackup).toHaveBeenCalledExactlyOnceWith('test-admin-password'))
  expect(createObjectURL).toHaveBeenCalled()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
  expect(toastMock.mock.calls.at(-1)?.[0]).toMatch(/Backup downloaded/)
  await waitFor(() => expect(screen.queryByLabelText('Admin password')).toBeNull())
  createObjectURL.mockRestore(); revokeObjectURL.mockRestore()
})

it('confirms restore, requires a password, and reports successful replacement', async () => {
  const onRestore = vi.fn().mockResolvedValue({ ok: true, pre_restore_backup: 'homegrown-pre-restore.zip' })
  setup(undefined, undefined, onRestore)
  openBackup()
  const file = new File(['zip'], 'backup.zip', { type: 'application/zip' })
  fireEvent.change(screen.getByLabelText('Backup ZIP file'), { target: { files: [file] } })
  expect(screen.getByText(/permanently replaces current voices/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
  fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Enter the admin password')
  fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'test-admin-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Restore backup' }))
  await waitFor(() => expect(onRestore).toHaveBeenCalledWith('test-admin-password', file))
  expect(toastMock.mock.calls.at(-1)?.[0]).toMatch(/Backup restored/)
})

it('requires confirmation and Cancel keeps data unchanged', async () => {
  const remove = setup()
  openDangerZone()
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
  openDangerZone()
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
  openDangerZone()
  fireEvent.click(screen.getByRole('button', { name: 'Delete all generated voiceovers' }))
  fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
  fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'test-admin-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining('Deleted 1'), expect.objectContaining({ description: '1 media file remains on disk.' })))
})

it('shows active-work failures without a success toast and permits retry', async () => {
  setup(vi.fn().mockRejectedValue(new Error('Wait for voice cloning to finish.')))
  openDangerZone()
  fireEvent.click(screen.getByRole('button', { name: 'Delete all uploaded voices' }))
  fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }))
  fireEvent.change(screen.getByLabelText('Admin password'), { target: { value: 'test-admin-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Wait for voice cloning to finish.'))
  expect((screen.getByRole('button', { name: 'Delete permanently' }) as HTMLButtonElement).disabled).toBe(false)
})
