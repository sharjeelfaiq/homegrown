// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ScriptBlock from './ScriptBlock'

vi.mock('./VoicePicker', () => ({ default: () => <span data-testid="voice-picker" /> }))

function setReducedMotion() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
}

function renderUpload(result: 'done' | 'failed') {
  const onAddVoice = vi.fn().mockResolvedValue(result)
  const view = render(
    <ScriptBlock
      text=""
      onTextChange={vi.fn()}
      presetId={null}
      presets={[]}
      onSelectVoice={vi.fn()}
      onRenameVoice={vi.fn().mockResolvedValue(undefined)}
      onDeleteVoice={vi.fn().mockResolvedValue(undefined)}
      voicesLoading={false}
      creatingVoice={false}
      onAddVoice={onAddVoice}
    />,
  )
  return { ...view, onAddVoice }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ScriptBlock upload status', () => {
  it.each(['done', 'failed'] as const)('shows %s briefly before restoring the upload icon', async (result) => {
    setReducedMotion()
    vi.useFakeTimers()
    const { container, onAddVoice } = renderUpload(result)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [new File(['audio'], 'voice.wav', { type: 'audio/wav' })] } })
    expect(container.querySelector('[data-status="running"]')).toBeTruthy()
    expect(container.querySelector('[data-status-mark]')).toBeNull()

    await act(async () => { await Promise.resolve() })
    expect(onAddVoice).toHaveBeenCalledTimes(1)
    expect(container.querySelector(`[data-status="${result}"]`)).toBeTruthy()

    act(() => { vi.advanceTimersByTime(2000) })
    expect(container.querySelector('[data-status]')).toBeNull()
  })
})
