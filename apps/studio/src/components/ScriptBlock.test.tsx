// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
      languages={[]}
      language={null}
      onLanguageChange={vi.fn()}
      voiceLanguage={null}
    />,
  )
  return { ...view, onAddVoice }
}

const LANGUAGES = ['English', 'German', 'Japanese']

function renderLanguage(overrides: {
  languages?: string[]
  language?: string | null
  voiceLanguage?: string | null
} = {}) {
  const onLanguageChange = vi.fn()
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
      onAddVoice={vi.fn().mockResolvedValue('done')}
      languages={overrides.languages ?? LANGUAGES}
      language={overrides.language ?? null}
      onLanguageChange={onLanguageChange}
      voiceLanguage={overrides.voiceLanguage ?? 'English'}
    />,
  )
  const trigger = screen.queryByRole('button', { name: 'Script language' })
  return { ...view, trigger, onLanguageChange }
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

describe('ScriptBlock language control', () => {
  it('is absent when the backend reported no languages', () => {
    const { trigger } = renderLanguage({ languages: [] })
    expect(trigger).toBeNull()
  })

  it('shows the language placeholder and offers every model language', async () => {
    const { trigger } = renderLanguage({ voiceLanguage: 'German' })
    expect(trigger).toHaveTextContent('Select language')
    fireEvent.click(trigger!)
    const options = (await screen.findAllByRole('menuitemradio')).map((item) => item.textContent?.trim())
    expect(options).toEqual(['Select language', ...LANGUAGES])
  })

  it('reports a language pick and reports null when returned to the placeholder', async () => {
    const { trigger, onLanguageChange } = renderLanguage()
    fireEvent.click(trigger!)
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Japanese' }))
    expect(onLanguageChange).toHaveBeenCalledWith('Japanese')
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Select language' }))
    expect(onLanguageChange).toHaveBeenLastCalledWith(null)
  })

  it('exposes language choices from its menu trigger', () => {
    const { trigger } = renderLanguage()
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(within(trigger!.parentElement!).getByRole('button', { name: 'Script language' })).toBe(trigger)
  })
})
