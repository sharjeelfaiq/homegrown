import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ClipboardPaste, X } from 'lucide-react'
import { toast } from 'sonner'
import { getEstimate, type Estimate } from '../../lib/api'
import { MAX_SCRIPT_CHARS } from './constants'
import DropdownSelect from '../../components/ui/DropdownSelect'
import { Skeleton } from 'boneyard-js/react'
import { ScriptLanguageFixture } from '../../skeletons/BoneyardFixtures'

interface Props {
  text: string
  onTextChange: (text: string) => void
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  presetId: string | null
  onEstimate?: (estimate: Estimate | null) => void
  languages: string[]
  languagesLoading?: boolean
  languageEnabled?: boolean
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
  languagesLoading = false,
  languageEnabled = true,
  language,
  onLanguageChange,
  generateAction,
}: Props) {
  const localTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [showCharacterCount, setShowCharacterCount] = useState(false)
  const overLimit = text.length > MAX_SCRIPT_CHARS

  function getPastePosition() {
    const textarea = textareaRef?.current ?? localTextareaRef.current
    const wasFocused = textarea != null && document.activeElement === textarea
    return {
      start: wasFocused ? textarea.selectionStart : text.length,
      end: wasFocused ? textarea.selectionEnd : text.length,
    }
  }

  async function pasteFromClipboard() {
    const position = getPastePosition()
    try {
      if (!navigator.clipboard?.readText) {
        toast.error('Clipboard access is unavailable in this browser or page context. You can still paste with Ctrl+V in the script box.')
        return
      }
      const clipboardText = await navigator.clipboard.readText()
      const { start, end } = position
      const capacity = Math.max(0, MAX_SCRIPT_CHARS - (text.length - (end - start)))
      let insertedText = clipboardText.slice(0, capacity)
      if (insertedText.length > 0 && /[\uD800-\uDBFF]$/.test(insertedText)) {
        insertedText = insertedText.slice(0, -1)
      }
      const nextText = text.slice(0, start) + insertedText + text.slice(end)
      onTextChange(nextText)

      requestAnimationFrame(() => {
        const currentTextarea = textareaRef?.current ?? localTextareaRef.current
        if (!currentTextarea) return
        currentTextarea.focus()
        const caret = start + insertedText.length
        currentTextarea.setSelectionRange(caret, caret)
      })
    } catch (error) {
      const errorName = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
      const message = errorName === 'NotAllowedError'
        ? 'Clipboard access was blocked. Allow Clipboard for this site in your browser settings, or use Ctrl+V in the script box.'
        : 'Could not read the clipboard. Check this site’s browser permission, or use Ctrl+V in the script box.'
      toast.error(message)
    }
  }

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
  const orderedLanguages = [...languages].sort((left, right) =>
    Number(right.toLocaleLowerCase() === 'english') - Number(left.toLocaleLowerCase() === 'english'),
  )

  return (
    <div className="script-editor grid h-[clamp(300px,39svh,400px)] min-h-[clamp(300px,39svh,400px)] max-h-[clamp(300px,39svh,400px)] grid-rows-[minmax(0,1fr)_auto] overflow-visible rounded-md border border-transparent bg-surface-card" data-tour="script-editor">
      <div className="script-editor-input">
        <textarea
          ref={textareaRef ?? localTextareaRef}
          autoFocus
          className="block h-full min-h-0 w-full resize-none overflow-y-auto border-none bg-transparent px-[18px] pr-14 pt-3 pb-8 text-[15px]/[1.7] outline-none placeholder:text-faint"
          placeholder="Type or paste a script…"
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
        />
        <button
          type="button"
          className="script-paste-button icon-btn"
          aria-label="Paste from clipboard"
          title="Paste from clipboard"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => void pasteFromClipboard()}
        >
          <ClipboardPaste size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="script-clear-button icon-btn"
          aria-label="Clear script"
          title="Clear script"
          disabled={text.length === 0}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onTextChange('')}
        >
          <X size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`script-word-count mono text-[11px] whitespace-nowrap ${overLimit ? 'text-danger' : 'text-faint'}`}
          aria-label={showCharacterCount ? 'Show word count' : 'Show character count'}
          aria-pressed={showCharacterCount}
          onClick={() => setShowCharacterCount((current) => !current)}
        >
          {showCharacterCount
            ? `${text.length.toLocaleString()} character${text.length === 1 ? '' : 's'}`
            : `${words.toLocaleString()} word${words === 1 ? '' : 's'}`}
        </button>
      </div>

      <footer className="script-editor-footer">
        <div className="script-editor-selection">
          {languagesLoading ? (
            <Skeleton
              name="script-language"
              loading
              fixture={<ScriptLanguageFixture />}
              select="viewport"
              snapshotConfig={{ excludeTags: ['svg', 'canvas'], excludeSelectors: ['[data-boneyard-decorative]'] }}
            >
              <ScriptLanguageFixture />
            </Skeleton>
          ) : languages.length > 0 && (
            <label className="script-language-control">
              <DropdownSelect
                className="script-language-select"
                contentClassName="standard-options-popup script-language-options-popup"
                value={language ?? ''}
                disabled={!languageEnabled}
                ariaLabel="Script language"
                placeholder="Select language"
                options={[{ value: '', label: 'Select language' }, ...orderedLanguages.map((name) => ({ value: name, label: name }))]}
                onValueChange={(next) => onLanguageChange(next || null)}
              />
            </label>
          )}
        </div>
        <div className="script-editor-generate" data-tour="generate-control">{generateAction}</div>
      </footer>
      <span className="script-editor-frame" aria-hidden="true" />
    </div>
  )
}
