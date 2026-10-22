import { useCallback, type RefObject } from 'react'
import { toast } from 'sonner'

/** Restore a generation's transcript, voice and language as one composer snapshot. */
export function useReuseVoiceover({ script, voiceId, language, languages, setScript, setVoiceId, setLanguage, textareaRef }: {
  script: string
  voiceId: string | null
  language: string | null
  languages: readonly string[]
  setScript: (text: string) => void
  setVoiceId: (id: string | null) => void
  setLanguage: (language: string | null) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
}) {
  return useCallback((text: string, presetId: string, savedLanguage?: string) => {
    // Legacy entries must not inherit an unrelated selection from the composer.
    const restoredLanguage = languages.find(value => value.toLowerCase() === savedLanguage?.trim().toLowerCase()) ?? null
    const replacing = script.trim() !== '' && (script !== text || voiceId !== presetId || language !== restoredLanguage)
    setScript(text)
    setVoiceId(presetId)
    setLanguage(restoredLanguage)
    textareaRef.current?.focus()
    if (!replacing) {
      toast('Transcript ready to reuse')
      return
    }
    toast('Script replaced', {
      description: 'The script, voice, and language were restored from this voiceover.',
      action: {
        label: 'Undo',
        onClick: () => {
          setScript(script)
          setVoiceId(voiceId)
          setLanguage(language)
        },
      },
    })
  }, [script, voiceId, language, languages, setScript, setVoiceId, setLanguage, textareaRef])
}
