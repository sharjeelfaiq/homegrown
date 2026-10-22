// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExternalToast } from 'sonner'
import { UNDO_MS } from '../../lib/constants'
import { showUndoDeleteToast } from './UndoDeleteToast'

const toastMock = vi.hoisted(() => Object.assign(
  vi.fn((_message: string, _options: ExternalToast) => 'delete-toast'),
  { dismiss: vi.fn() },
))
vi.mock('sonner', () => ({ toast: toastMock }))

const setup = (onDelete = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)) => {
  const callbacks = { label: 'My voice', onDelete, onUndo: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
  const cancel = showUndoDeleteToast(callbacks)
  const action = toastMock.mock.calls.at(-1)![1].action as {
    label: string; onClick: (event: { preventDefault: () => void }) => void
  }
  return { ...callbacks, cancel, undo: () => action.onClick({ preventDefault: vi.fn() }) }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); vi.clearAllMocks() })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('Undo delete toast', () => {
  it('waits the full Undo window, keeps the toast through deletion, then shows success for one second', async () => {
    let finish!: () => void
    const pending = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const callbacks = setup(pending)
    expect(toastMock).toHaveBeenCalledWith('My voice deleted', expect.objectContaining({
      duration: Infinity, action: expect.objectContaining({ label: 'Undo' }),
      icon: expect.objectContaining({ props: { deadline: UNDO_MS } }),
    }))
    await vi.advanceTimersByTimeAsync(UNDO_MS - 1)
    expect(pending).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(pending).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenLastCalledWith('Deleting My voice…', expect.objectContaining({
      id: 'delete-toast', duration: Infinity, action: null,
    }))
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(toastMock).toHaveBeenLastCalledWith('My voice deleted', expect.objectContaining({
      id: 'delete-toast', duration: 1000, action: null,
      icon: expect.objectContaining({ props: { status: 'done' } }),
    }))
    expect(toastMock.dismiss).not.toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalledTimes(1)
  })

  it('Undo cancels the request and restores the optimistically hidden voice', async () => {
    const callbacks = setup()
    await vi.advanceTimersByTimeAsync(UNDO_MS / 2)
    callbacks.undo()
    await vi.advanceTimersByTimeAsync(UNDO_MS)
    expect(callbacks.onDelete).not.toHaveBeenCalled()
    expect(callbacks.onUndo).toHaveBeenCalledTimes(1)
    expect(callbacks.onSettled).toHaveBeenCalledTimes(1)
    expect(toastMock.dismiss).toHaveBeenCalledWith('delete-toast')
  })

  it('removes pending feedback and reports failures for the caller to roll back', async () => {
    const error = new Error('Backend unavailable')
    const callbacks = setup(vi.fn().mockRejectedValue(error))
    await vi.advanceTimersByTimeAsync(UNDO_MS)
    expect(callbacks.onError).toHaveBeenCalledWith(error)
    expect(callbacks.onSettled).toHaveBeenCalledTimes(1)
    expect(toastMock.dismiss).toHaveBeenCalledWith('delete-toast')
    expect(toastMock).toHaveBeenCalledTimes(2) // Countdown and request, no success tick.
  })

  it('unmount cleanup cancels pending deletion without invoking Undo restoration', async () => {
    const callbacks = setup()
    callbacks.cancel()
    callbacks.cancel()
    await vi.advanceTimersByTimeAsync(UNDO_MS)
    expect(callbacks.onDelete).not.toHaveBeenCalled()
    expect(callbacks.onUndo).not.toHaveBeenCalled()
    expect(callbacks.onSettled).toHaveBeenCalledTimes(1)
  })

  it('does not recreate success feedback after unmount during an in-flight request', async () => {
    let finish!: () => void
    const callbacks = setup(vi.fn(() => new Promise<void>((resolve) => { finish = resolve })))
    await vi.advanceTimersByTimeAsync(UNDO_MS)
    callbacks.cancel()
    finish()
    await vi.advanceTimersByTimeAsync(0)
    expect(toastMock).toHaveBeenCalledTimes(2)
    expect(callbacks.onSettled).toHaveBeenCalledTimes(1)
  })

  it('cannot undo after deletion has started', async () => {
    const callbacks = setup()
    await vi.advanceTimersByTimeAsync(UNDO_MS)
    callbacks.undo()
    expect(callbacks.onDelete).toHaveBeenCalledTimes(1)
    expect(callbacks.onUndo).not.toHaveBeenCalled()
  })
})
