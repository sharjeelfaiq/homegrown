import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ClipboardPaste, Redo2, Undo2, X } from 'lucide-react'
import { toast } from 'sonner'
import { getEstimate, type Estimate } from '../../lib/api'
import { MAX_SCRIPT_CHARS } from './constants'
import DropdownSelect from '../../components/ui/DropdownSelect'
import { AppTooltip } from '../../components/ui/Tooltip'
import { Skeleton } from 'boneyard-js/react'
import { ScriptLanguageFixture } from '../../skeletons/BoneyardFixtures'

interface ScriptSnapshot {
  text: string
  selectionStart: number
  selectionEnd: number
}

interface ScriptHistory {
  past: ScriptSnapshot[]
  future: ScriptSnapshot[]
}

const SCRIPT_HISTORY_LIMIT = 100
const TYPING_GROUP_DELAY_MS = 750

function isSingleCharacterEdit(previous: string, next: string): boolean {
  const before = Array.from(previous)
  const after = Array.from(next)
  if (Math.abs(before.length - after.length) !== 1) return false
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < before.length - prefix
    && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) suffix += 1
  const removed = before.length - prefix - suffix
  const added = after.length - prefix - suffix
  return (removed === 1 && added === 0) || (removed === 0 && added === 1)
}

interface Props {
  text: string
  onTextChange: (text: string) => void
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  presetId: string | null
  onEstimate?: (estimate: Estimate | null) => void
  languages: string[]
  languagesLoading?: boolean
  languageEnabled?: boolean
  modelLoading?: boolean
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
  modelLoading = false,
  language,
  onLanguageChange,
  generateAction,
}: Props) {
  const localTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [showCharacterCount, setShowCharacterCount] = useState(false)
  const [scriptHistory, setScriptHistory] = useState<ScriptHistory>({ past: [], future: [] })
  const scriptHistoryRef = useRef(scriptHistory)
  const currentSnapshotRef = useRef<ScriptSnapshot>({
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  })
  const lastTypingAtRef = useRef(0)
  const overLimit = text.length > MAX_SCRIPT_CHARS

  const textareaElement = useCallback(() => {
    return textareaRef?.current ?? localTextareaRef.current
  }, [textareaRef])

  function rememberSelection(textarea: HTMLTextAreaElement) {
    const current = currentSnapshotRef.current
    if (textarea.value !== current.text) return
    currentSnapshotRef.current = {
      ...current,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
    }
  }

  function captureCurrentSnapshot(): ScriptSnapshot {
    const current = currentSnapshotRef.current
    const textarea = textareaElement()
    if (!textarea || textarea.value !== current.text) return current
    return {
      text: current.text,
      selectionStart: textarea.selectionStart,
      selectionEnd: textarea.selectionEnd,
    }
  }

  function updateHistory(next: ScriptHistory) {
    scriptHistoryRef.current = next
    setScriptHistory(next)
  }

  function commitText(
    nextText: string,
    typing = false,
    selection?: { start: number; end: number },
  ) {
    const previous = captureCurrentSnapshot()
    if (nextText === previous.text) return

    const now = Date.now()
    const grouped = typing
      && lastTypingAtRef.current > 0
      && now - lastTypingAtRef.current <= TYPING_GROUP_DELAY_MS
    const history = scriptHistoryRef.current
    const past = grouped ? history.past : [...history.past, previous].slice(-SCRIPT_HISTORY_LIMIT)
    updateHistory({ past, future: [] })
    currentSnapshotRef.current = {
      text: nextText,
      selectionStart: selection?.start ?? nextText.length,
      selectionEnd: selection?.end ?? nextText.length,
    }
    lastTypingAtRef.current = typing ? now : 0
    onTextChange(nextText)
  }

  function restoreSnapshot(snapshot: ScriptSnapshot) {
    currentSnapshotRef.current = snapshot
    lastTypingAtRef.current = 0
    onTextChange(snapshot.text)
    requestAnimationFrame(() => {
      const textarea = textareaElement()
      if (!textarea) return
      textarea.focus()
      const start = Math.min(snapshot.selectionStart, snapshot.text.length)
      const end = Math.min(snapshot.selectionEnd, snapshot.text.length)
      textarea.setSelectionRange(start, end)
    })
  }

  function undo() {
    const history = scriptHistoryRef.current
    if (history.past.length === 0) return
    const current = captureCurrentSnapshot()
    const snapshot = history.past[history.past.length - 1]
    updateHistory({
      past: history.past.slice(0, -1),
      future: [...history.future, current].slice(-SCRIPT_HISTORY_LIMIT),
    })
    restoreSnapshot(snapshot)
  }

  function redo() {
    const history = scriptHistoryRef.current
    if (history.future.length === 0) return
    const current = captureCurrentSnapshot()
    const snapshot = history.future[history.future.length - 1]
    updateHistory({
      past: [...history.past, current].slice(-SCRIPT_HISTORY_LIMIT),
      future: history.future.slice(0, -1),
    })
    restoreSnapshot(snapshot)
  }

  useEffect(() => {
    const current = currentSnapshotRef.current
    if (text === current.text) return
    const now = Date.now()
    const characterEdit = isSingleCharacterEdit(current.text, text)
    const grouped = lastTypingAtRef.current > 0
      && characterEdit
      && now - lastTypingAtRef.current <= TYPING_GROUP_DELAY_MS
    const textarea = textareaElement()
    updateHistory({
      past: grouped
        ? scriptHistoryRef.current.past
        : [...scriptHistoryRef.current.past, current].slice(-SCRIPT_HISTORY_LIMIT),
      future: [],
    })
    currentSnapshotRef.current = {
      text,
      selectionStart: textarea?.value === text ? textarea.selectionStart : text.length,
      selectionEnd: textarea?.value === text ? textarea.selectionEnd : text.length,
    }
    lastTypingAtRef.current = characterEdit ? now : 0
  }, [text, textareaElement])

  function getPastePosition() {
    const textarea = textareaElement()
    const wasFocused = textarea != null && document.activeElement === textarea
    const currentText = currentSnapshotRef.current.text
    return {
      start: wasFocused ? textarea.selectionStart : currentText.length,
      end: wasFocused ? textarea.selectionEnd : currentText.length,
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
      const currentText = currentSnapshotRef.current.text
      const capacity = Math.max(0, MAX_SCRIPT_CHARS - (currentText.length - (end - start)))
      let insertedText = clipboardText.slice(0, capacity)
      if (insertedText.length > 0 && /[\uD800-\uDBFF]$/.test(insertedText)) {
        insertedText = insertedText.slice(0, -1)
      }
      const nextText = currentText.slice(0, start) + insertedText + currentText.slice(end)
      const caret = start + insertedText.length
      commitText(nextText, false, { start: caret, end: caret })

      requestAnimationFrame(() => {
        const currentTextarea = textareaElement()
        if (!currentTextarea) return
        currentTextarea.focus()
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
  const languageSelect = (
    <DropdownSelect
      className="script-language-select"
      contentClassName="standard-options-popup script-language-options-popup"
      value={language ?? ''}
      disabled={!languageEnabled || modelLoading}
      tooltip={modelLoading ? 'Available when the voice model is ready.' : undefined}
      ariaLabel="Script language"
      placeholder="Select language"
      options={[{ value: '', label: 'Select language' }, ...orderedLanguages.map((name) => ({ value: name, label: name }))]}
      onValueChange={(next) => onLanguageChange(next || null)}
    />
  )

  return (
    <div className="script-editor grid h-[clamp(300px,39svh,400px)] min-h-[clamp(300px,39svh,400px)] max-h-[clamp(300px,39svh,400px)] grid-rows-[minmax(0,1fr)_auto] overflow-visible rounded-md border border-transparent bg-surface-card" data-tour="script-editor">
      <div className="script-editor-input">
        <textarea
          ref={textareaRef ?? localTextareaRef}
          autoFocus
          className="block h-full min-h-0 w-full resize-none overflow-y-auto border-none bg-transparent px-[18px] pr-14 pt-[18px] pb-8 text-[15px]/[1.7] outline-none placeholder:text-faint"
          placeholder="Type or paste a script…"
          value={text}
          onSelect={(event) => rememberSelection(event.currentTarget)}
          onChange={(event) => {
            const inputType = (event.nativeEvent as InputEvent).inputType
            const typing = !inputType
              || inputType.startsWith('insertText')
              || inputType.startsWith('deleteContent')
              || inputType === 'insertLineBreak'
              || inputType === 'insertParagraph'
            commitText(event.target.value, typing, {
              start: event.target.selectionStart,
              end: event.target.selectionEnd,
            })
          }}
          onKeyDown={(event) => {
            if (!(event.ctrlKey || event.metaKey) || event.altKey) return
            const key = event.key.toLowerCase()
            if (key === 'z') {
              event.preventDefault()
              if (event.shiftKey) redo()
              else undo()
            } else if (key === 'y') {
              event.preventDefault()
              redo()
            }
          }}
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
          onClick={() => commitText('', false, { start: 0, end: 0 })}
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
        <div className="script-history-controls" role="group" aria-label="Script history">
          <AppTooltip content="Undo">
            <button
              type="button"
              className="icon-btn"
              aria-label="Undo"
              disabled={scriptHistory.past.length === 0}
              onPointerDown={(event) => event.preventDefault()}
              onClick={undo}
            >
              <Undo2 size={16} aria-hidden="true" />
            </button>
          </AppTooltip>
          <AppTooltip content="Redo">
            <button
              type="button"
              className="icon-btn"
              aria-label="Redo"
              disabled={scriptHistory.future.length === 0}
              onPointerDown={(event) => event.preventDefault()}
              onClick={redo}
            >
              <Redo2 size={16} aria-hidden="true" />
            </button>
          </AppTooltip>
        </div>
      </div>

      <footer className="script-editor-footer">
        <div className="script-editor-selection">
          {languagesLoading && !modelLoading ? (
            <Skeleton
              name="script-language"
              loading
              fixture={<ScriptLanguageFixture />}
              select="viewport"
              snapshotConfig={{ excludeTags: ['svg', 'canvas'], excludeSelectors: ['[data-boneyard-decorative]'] }}
            >
              <ScriptLanguageFixture />
            </Skeleton>
          ) : (languages.length > 0 || modelLoading) && (
            <label className="script-language-control">
              {languageSelect}
            </label>
          )}
        </div>
        <div className="script-editor-generate" data-tour="generate-control">{generateAction}</div>
      </footer>
      <span className="script-editor-frame" aria-hidden="true" />
    </div>
  )
}
