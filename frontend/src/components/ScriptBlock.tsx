import { useEffect, type RefObject } from 'react'
import { getEstimate, type Estimate } from '../api'
import { MAX_SCRIPT_CHARS } from '../constants'

interface Props {
  text: string
  onTextChange: (text: string) => void
  /** Focused by the "/" shortcut. */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  /** Chunking depends on the voice, so the estimate has to be re-fetched when
   * it changes -- not only when the text does. */
  presetId: string | null
  onEstimate?: (estimate: Estimate | null) => void
}

export default function ScriptBlock({
  text,
  onTextChange,
  textareaRef,
  presetId,
  onEstimate,
}: Props) {
  const overLimit = text.length > MAX_SCRIPT_CHARS

  // The estimate is not displayed. onEstimate feeds StudioShell's
  // long-reference-clip warning; the backend calculation also keeps the
  // generated job's chunk count aligned with the pre-flight result. Deleting
  // this request removes the warning path.
  useEffect(() => {
    if (text.trim().length === 0 || overLimit) {
      onEstimate?.(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      getEstimate(text, presetId)
        .then((r) => {
          if (cancelled) return
          onEstimate?.(r)
        })
        .catch(() => {
          if (cancelled) return
          onEstimate?.(null)
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // onEstimate is intentionally excluded: it is a fresh closure each render
    // and would re-fire this request on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, overLimit, presetId])

  const trimmed = text.trim()
  const words = trimmed ? trimmed.split(/\s+/).length : 0

  return (
    // focus-within carries the audio accent: focusing the script is the most
    // common interaction in the app and it earns colour at rest, not only
    // during a render.
    <div className="relative rounded-md border border-hairline bg-surface-card transition-[border-color] duration-(--base) ease-(--ease) focus-within:border-audio-line">
      {/* A stable 40% of the visible page height, not auto-growing or user-resizable.
          A stable writing surface keeps long scripts from reflowing the page. */}
      <textarea
        ref={textareaRef}
        className="block h-[40svh] min-h-[40svh] max-h-[40svh] w-full resize-none overflow-y-auto border-none bg-transparent px-[18px] pt-3.5 pb-9 text-[15px]/[1.7] outline-none placeholder:text-faint"
        placeholder="Write what the voice should say…"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        // The visible cap lives on the Script heading, not in here: a cap
        // inside the box overlapped the first line of text (measured: cap
        // 11-29px, line one 15-40.5px, and a long line reaches under it).
        aria-keyshortcuts="/"
      />


      {/* Word count only. Chunking is still calculated by the request above so
          StudioShell can render its long-reference-clip warning, but no time
          estimate or chunk count is shown here.

          Overlaid on the textarea rather than given a row of its own: a
          30px bordered strip for six characters was the widest thing in the
          compose column doing the least. Three things make an overlay work
          where a row did not:
            - `pointer-events-none`, so the corner of the textarea it sits
              over still takes clicks and drags through to the field;
            - an opaque `bg-surface-card` (the textarea is bg-transparent
              over this same colour, so it matches exactly), because pb-9
              only reserves space at the END of the content -- a script
              scrolled to its middle runs lines straight under this;
            - `right-6`, not `right-0`: once a script overflows
              `overflow-y-auto`, Windows gives its scrollbar 17px, so 16px
              is not enough to keep the count clear of it. */}
      <span
        className={`mono pointer-events-none absolute right-6 bottom-2 rounded-sm bg-surface-card px-1.5 py-0.5 text-[11px] whitespace-nowrap ${
          overLimit ? 'text-danger' : 'text-faint'
        }`}
      >
        {words.toLocaleString()} word{words === 1 ? '' : 's'}
      </span>
    </div>
  )
}
