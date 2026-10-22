// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HistoryScriptLine from './HistoryScriptLine'

let frame: FrameRequestCallback | undefined
const cancelFrame = vi.fn()

function mediaElement() {
  const audio = document.createElement('audio')
  Object.defineProperties(audio, {
    paused: { configurable: true, writable: true, value: true },
    ended: { configurable: true, writable: true, value: false },
    currentTime: { configurable: true, writable: true, value: 20 },
    duration: { configurable: true, writable: true, value: 100 },
  })
  return audio
}

function setPaused(audio: HTMLAudioElement, paused: boolean) {
  Object.defineProperty(audio, 'paused', { configurable: true, value: paused })
}

function renderLine(audio = mediaElement(), onReuse = vi.fn()) {
  const audioRef = { current: audio }
  const view = render(
    <HistoryScriptLine
      text="A short spoken script"
      fullText="A short spoken script"
      label="Voiceover 4"
      audioRef={audioRef}
      durationS={100}
      onReuse={onReuse}
    />,
  )
  return { ...view, audio, onReuse }
}

beforeEach(() => {
  frame = undefined
  cancelFrame.mockReset()
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', cancelFrame)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('completed voiceover script line', () => {
  it('tracks audio progress smoothly, freezes on pause, and resumes from the current position', () => {
    const { audio } = renderLine()
    const preview = screen.getByRole('button', { name: 'Script preview. Reuse the script of Voiceover 4' })
      .querySelector<HTMLSpanElement>('span[aria-hidden="true"]')!

    expect(preview.style.clipPath).toContain('80%')
    setPaused(audio, false)
    act(() => audio.dispatchEvent(new Event('play')))
    audio.currentTime = 40
    act(() => frame?.(0))
    expect(preview.style.clipPath).toContain('60%')
    const underline = preview.parentElement?.parentElement?.querySelector(':scope > span:last-child > span')
    expect(underline?.getAttribute('style')).toContain('width: 40%')

    setPaused(audio, true)
    act(() => audio.dispatchEvent(new Event('pause')))
    expect(cancelFrame).toHaveBeenCalled()
    audio.currentTime = 60
    setPaused(audio, false)
    act(() => audio.dispatchEvent(new Event('play')))
    expect(preview.style.clipPath).toContain('40%')
  })

  it('keeps the script preview and adjacent Reuse action independently operable', () => {
    const onReuse = vi.fn()
    const { container } = renderLine(mediaElement(), onReuse)
    const preview = screen.getByRole('button', { name: 'Script preview. Reuse the script of Voiceover 4' })
    const reuse = screen.getByRole('button', { name: 'Reuse Voiceover 4 script' })

    expect(container.querySelector('.flex.min-h-6')?.contains(reuse)).toBe(true)
    expect(container.querySelector('.flex.min-h-6')?.classList.contains('gap-2')).toBe(true)
    fireEvent.click(preview)
    fireEvent.click(reuse)
    expect(onReuse).toHaveBeenCalledTimes(2)
  })
})
