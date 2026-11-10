import { describe, expect, it } from 'vitest'
import { generationChecklist } from './generationChecklist'
import { MAX_SCRIPT_CHARS } from './constants'

describe('generationChecklist', () => {
  it('lists the three user steps in order', () => {
    const steps = generationChecklist({ clonedVoiceCount: 0, script: '', language: null })
    expect(steps.map((s) => s.label)).toEqual(['Clone a voice', 'Write a script', 'Choose a language'])
  })

  it('leaves every step undone for a fresh, empty Studio', () => {
    const steps = generationChecklist({ clonedVoiceCount: 0, script: '   ', language: null })
    expect(steps.every((s) => !s.done)).toBe(true)
  })

  it('checks "Clone a voice" once a cloned voice exists', () => {
    const steps = generationChecklist({ clonedVoiceCount: 2, script: '', language: null })
    expect(steps.find((s) => s.label === 'Clone a voice')!.done).toBe(true)
  })

  it('checks "Write a script" only for non-empty text within the limit', () => {
    expect(generationChecklist({ clonedVoiceCount: 0, script: 'Hello', language: null })
      .find((s) => s.label === 'Write a script')!.done).toBe(true)
    expect(generationChecklist({ clonedVoiceCount: 0, script: 'x'.repeat(MAX_SCRIPT_CHARS + 1), language: null })
      .find((s) => s.label === 'Write a script')!.done).toBe(false)
  })

  it('checks "Choose a language" once a language is selected', () => {
    expect(generationChecklist({ clonedVoiceCount: 0, script: '', language: 'English' })
      .find((s) => s.label === 'Choose a language')!.done).toBe(true)
  })

  it('checks every step when all prerequisites are met', () => {
    const steps = generationChecklist({ clonedVoiceCount: 1, script: 'A script', language: 'English' })
    expect(steps.every((s) => s.done)).toBe(true)
  })
})
