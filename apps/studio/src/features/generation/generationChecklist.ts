import { MAX_SCRIPT_CHARS } from './constants'

export interface ChecklistStep {
  /** User-facing step label. */
  label: string
  /** Whether the prerequisite is already satisfied. */
  done: boolean
}

/** The ordered prerequisites for generating a voiceover, shown as a checklist
 * in the empty Voiceovers card. Each flips to done the moment its state is
 * satisfied -- a cloned voice exists (it is then auto-selected), a script has
 * been written within the character limit, and a language has been chosen.
 *
 * These mirror the real generation gates in StudioShell (`canGenerate`), minus
 * the passive ones the user does not act on (model readiness). "Clone a voice"
 * stands in for voice selection because the first cloned voice auto-selects. */
export function generationChecklist(input: {
  clonedVoiceCount: number
  script: string
  language: string | null
}): ChecklistStep[] {
  return [
    { label: 'Clone a voice', done: input.clonedVoiceCount > 0 },
    { label: 'Write a script', done: input.script.trim().length > 0 && input.script.length <= MAX_SCRIPT_CHARS },
    { label: 'Choose a language', done: input.language != null },
  ]
}
