// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AudioSeekBar from './AudioSeekBar'

afterEach(cleanup)

describe('compact audio seek control', () => {
  it('retains a labelled, keyboard-native slider and seeks the shared audio element', () => {
    const audio = document.createElement('audio')
    Object.defineProperties(audio, {
      paused: { configurable: true, value: true },
      currentTime: { configurable: true, writable: true, value: 20 },
      duration: { configurable: true, writable: true, value: 100 },
    })
    const { container } = render(
      <AudioSeekBar audioRef={{ current: audio }} durationS={100} label="Voiceover 4" />,
    )

    const slider = screen.getByRole('slider', { name: 'Seek within Voiceover 4' })
    expect(slider.getAttribute('aria-valuetext')).toBe('0:20 of 1:40')
    expect(container.querySelector('input[type="range"]')).not.toBeNull()
    fireEvent.change(slider, { target: { value: '50' } })
    expect(audio.currentTime).toBe(50)
    expect(slider.getAttribute('aria-valuetext')).toBe('0:50 of 1:40')
  })
})
