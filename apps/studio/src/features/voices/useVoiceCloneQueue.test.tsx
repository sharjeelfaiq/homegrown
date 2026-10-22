// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ExternalToast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceCloneQueue } from './useVoiceCloneQueue'

const toastState = vi.hoisted(() => ({ next: 0 }))
const toastMock = vi.hoisted(() => Object.assign(
  vi.fn((_message: string, options: ExternalToast): string => String(options.id ?? `clone-${++toastState.next}`)),
  { dismiss: vi.fn() },
))
vi.mock('sonner', () => ({ toast: toastMock }))

function request() {
  let resolve!: (value: 'done' | 'failed') => void
  let reject!: (error: Error) => void
  const promise = new Promise<'done' | 'failed'>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const file = (name: string) => new File(['audio'], name, { type: 'audio/wav' })

beforeEach(() => { vi.clearAllMocks(); toastState.next = 0 })
afterEach(cleanup)

describe('voice clone FIFO', () => {
  it('serializes a batch and appends new uploads without interrupting the active clone', async () => {
    const requests = [request(), request(), request(), request()]
    let active = 0
    let peak = 0
    const onAddVoice = vi.fn((_file: File) => {
      peak = Math.max(peak, ++active)
      return requests[onAddVoice.mock.calls.length - 1].promise.finally(() => { active -= 1 })
    })
    const files = ['first.wav', 'second.wav', 'third.wav', 'fourth.wav'].map(file)
    const { result } = renderHook(() => useVoiceCloneQueue({ modelReady: true, onAddVoice }))
    act(() => result.current(files.slice(0, 3)))
    expect(onAddVoice).toHaveBeenCalledExactlyOnceWith(files[0])
    expect(toastMock).toHaveBeenCalledWith('Your uploaded voice is waiting to be cloned.', expect.objectContaining({
      description: 'second.wav', duration: Infinity,
      icon: expect.objectContaining({ props: expect.objectContaining({ status: 'pending', className: 'voice-clone-waiting' }) }),
    }))
    act(() => result.current([files[3]]))
    expect(onAddVoice).toHaveBeenCalledTimes(1)
    for (let index = 0; index < requests.length; index++) {
      await act(async () => { requests[index].resolve('done') })
      expect(onAddVoice).toHaveBeenCalledTimes(Math.min(index + 2, 4))
    }
    expect(onAddVoice.mock.calls.map(([uploaded]) => uploaded)).toEqual(files)
    expect(peak).toBe(1)
    const success = toastMock.mock.calls.filter(([message]) => message === 'Your voice has been cloned.')
    expect(success.map(([, options]) => options.description)).toEqual(files.map(f => f.name))
    expect(success.every(([, options]) => options.duration === 1000)).toBe(true)
    expect(new Set(success.map(([, options]) => options.id)).size).toBe(4)
  })

  it('continues after either a thrown error or a reported failure', async () => {
    const requests = [request(), request(), request()]
    const onAddVoice = vi.fn(() => requests[onAddVoice.mock.calls.length - 1].promise)
    const files = ['bad.wav', 'failed.wav', 'good.wav'].map(file)
    const { result } = renderHook(() => useVoiceCloneQueue({ modelReady: true, onAddVoice }))
    act(() => result.current(files))
    await act(async () => { requests[0].reject(new Error('Invalid reference audio')) })
    expect(onAddVoice).toHaveBeenNthCalledWith(2, files[1])
    expect(toastMock).toHaveBeenCalledWith('Could not clone bad.wav.', expect.objectContaining({
      id: 'clone-1', description: 'Invalid reference audio',
      icon: expect.objectContaining({ props: expect.objectContaining({ status: 'failed' }) }),
    }))
    await act(async () => { requests[1].resolve('failed') })
    expect(toastMock.dismiss).toHaveBeenCalledWith('clone-2')
    expect(onAddVoice).toHaveBeenNthCalledWith(3, files[2])
    await act(async () => { requests[2].resolve('done') })
    expect(toastMock).toHaveBeenLastCalledWith('Your voice has been cloned.', expect.objectContaining({ description: 'good.wav' }))
  })

  it('pauses while the model is unavailable and resumes with the latest request callback', async () => {
    const first = request()
    const initial = vi.fn(() => first.promise)
    const next = vi.fn().mockResolvedValue('done')
    const { result, rerender } = renderHook(({ ready, clone }) => useVoiceCloneQueue({ modelReady: ready, onAddVoice: clone }), {
      initialProps: { ready: true, clone: initial },
    })
    act(() => result.current([file('first.wav'), file('second.wav')]))
    rerender({ ready: false, clone: next })
    await act(async () => { first.resolve('done') })
    expect(next).not.toHaveBeenCalled()
    await act(async () => { rerender({ ready: true, clone: next }) })
    expect(initial).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'second.wav' }))
  })

  it('rejects new work before model readiness and filters non-audio files consistently', async () => {
    const onAddVoice = vi.fn().mockResolvedValue('done')
    const { result, rerender } = renderHook(({ ready }) => useVoiceCloneQueue({ modelReady: ready, onAddVoice }), {
      initialProps: { ready: false },
    })
    act(() => result.current([file('too-early.wav')]))
    expect(toastMock).not.toHaveBeenCalled()
    rerender({ ready: true })
    const audio = new File(['audio'], 'recording.MP3', { type: '' })
    await act(async () => result.current([new File(['text'], 'notes.txt', { type: 'text/plain' }), audio]))
    expect(onAddVoice).toHaveBeenCalledExactlyOnceWith(audio)
  })

  it('drops waiting files on unmount and never restarts processing or toasts after the active request settles', async () => {
    const pending = request()
    const onAddVoice = vi.fn(() => pending.promise)
    const { result, unmount } = renderHook(() => useVoiceCloneQueue({ modelReady: true, onAddVoice }))
    act(() => result.current([file('active.wav'), file('waiting.wav')]))
    const calls = toastMock.mock.calls.length
    unmount()
    expect(toastMock.dismiss).toHaveBeenCalledWith('clone-1')
    expect(toastMock.dismiss).toHaveBeenCalledWith('clone-2')
    await act(async () => { pending.resolve('done') })
    expect(onAddVoice).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledTimes(calls)
  })
})
