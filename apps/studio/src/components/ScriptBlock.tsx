import { useEffect, type ReactNode, type RefObject } from 'react'
import { getEstimate, type Estimate } from '../api'
import { MAX_SCRIPT_CHARS } from '../constants'
import DropdownSelect from './DropdownSelect'

interface Props {
  text: string
  onTextChange: (text: string) => void
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  presetId: string | null
  onEstimate?: (estimate: Estimate | null) => void
  languages: string[]
  language: string | null
  onLanguageChange: (language: string | null) => void
  /** Owned by StudioShell because submission state belongs there. */
  generateAction: ReactNode
}

export default function ScriptBlock({
  text,
  onTextChange,
  textareaRef,
  presetId,
  onEstimate,
  languages,
  language,
  onLanguageChange,
  generateAction,
}: Props) {
  const overLimit = text.length > MAX_SCRIPT_CHARS

  // The estimate feeds StudioShell's long-reference-clip warning and keeps
  // pre-flight chunking aligned with the generated job.
  useEffect(() => {
    if (text.trim().length === 0 || overLimit) {
      onEstimate?.(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      getEstimate(text, presetId)
        .then((result) => { if (!cancelled) onEstimate?.(result) })
        .catch(() => { if (!cancelled) onEstimate?.(null) })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // onEstimate is intentionally excluded: it is a fresh closure each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, overLimit, presetId])

  const trimmed = text.trim()
  const words = trimmed ? trimmed.split(/\s+/).length : 0

  return (
    <div className="script-editor grid h-[clamp(300px,39svh,400px)] min-h-[clamp(300px,39svh,400px)] max-h-[clamp(300px,39svh,400px)] grid-rows-[minmax(0,1fr)_auto] overflow-visible rounded-md border border-transparent bg-surface-card" data-tour="script-editor">
      <div className="script-editor-input">
        <textarea
          ref={textareaRef}
          className="block h-full min-h-0 w-full resize-none overflow-y-auto border-none bg-transparent px-[18px] pt-3.5 pb-8 text-[15px]/[1.7] outline-none placeholder:text-faint"
          placeholder="Type or paste a script…"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
        />
        <span className={`script-word-count mono text-[11px] whitespace-nowrap ${overLimit ? 'text-danger' : 'text-faint'}`}>
          {words.toLocaleString()} word{words === 1 ? '' : 's'}
        </span>
      </div>

      <footer className="script-editor-footer">
        {languages.length > 0 && (
          <label className="script-language-control">
            <DropdownSelect
              className="w-[190px] min-w-[190px] max-w-[190px]"
              contentClassName="standard-options-popup"
              value={language ?? ''}
              ariaLabel="Script language"
              placeholder="Select language"
              options={[{ value: '', label: 'Select language' }, ...languages.map((name) => ({ value: name, label: name }))]}
              onValueChange={(next) => onLanguageChange(next || null)}
            />
          </label>
        )}
        <div className="script-editor-generate" data-tour="generate-control">{generateAction}</div>
      </footer>
      <span className="script-editor-frame" aria-hidden="true" />
    </div>
  )
}
