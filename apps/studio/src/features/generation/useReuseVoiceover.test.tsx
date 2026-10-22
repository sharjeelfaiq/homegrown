// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { Action, ExternalToast } from 'sonner'
import { afterEach, expect, it, vi } from 'vitest'
import { useReuseVoiceover } from './useReuseVoiceover'

const toastMock = vi.hoisted(() => vi.fn((_message: string, _options?: ExternalToast) => 'reuse-toast'))
vi.mock('sonner', () => ({ toast: toastMock }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

function useComposer() {
  const [script, setScript] = useState('Previous transcript')
  const [voiceId, setVoiceId] = useState<string | null>('previous-voice')
  const [language, setLanguage] = useState<string | null>('English')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const reuse = useReuseVoiceover({
    script, voiceId, language, languages: ['English', 'German'],
    setScript, setVoiceId, setLanguage, textareaRef,
  })
  return { script, voiceId, language, reuse }
}

it('restores the generation language with its transcript and voice, and Undo restores all previous selections', () => {
  const { result } = renderHook(useComposer)
  act(() => result.current.reuse('German narration', 'saved-voice', 'german'))
  expect(result.current).toMatchObject({ script: 'German narration', voiceId: 'saved-voice', language: 'German' })
  const action = toastMock.mock.calls.at(-1)![1]!.action as Action
  act(() => action.onClick({} as never))
  expect(result.current).toMatchObject({ script: 'Previous transcript', voiceId: 'previous-voice', language: 'English' })
})

it.each([undefined, '', 'Unsupported language'])('requires an explicit selection for legacy or unsupported language %s', (savedLanguage) => {
  const { result } = renderHook(useComposer)
  act(() => result.current.reuse('Saved transcript', 'saved-voice', savedLanguage))
  expect(result.current).toMatchObject({ script: 'Saved transcript', voiceId: 'saved-voice', language: null })
})
