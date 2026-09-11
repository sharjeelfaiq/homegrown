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

  // The estimate is fetched but no longer displayed here. It is not dead code:
  // onEstimate feeds StudioShell, which renders the result's `warning` as the
  // long-reference-clip notice and uses `estimated_s` nowhere else. Deleting
  // this request would silently remove that warning.
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
    <div className="rounded-md border border-hairline bg-surface-card transition-[border-color] duration-(--base) ease-(--ease) focus-within:border-audio-line">
      {/* Fixed height, resized by dragging the corner grip -- not auto-growing.
          The user sets the working height once and it stays put instead of the
          page reflowing on every keystroke. */}
      <textarea
        ref={textareaRef}
        className="block h-[clamp(140px,30svh,260px)] min-h-[140px] w-full resize-y overflow-y-auto border-none bg-transparent px-[18px] pt-3.5 pb-6 text-[15px]/[1.7] outline-none placeholder:text-faint"
        placeholder="Write what the voice should say…"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
      />

      {/* Word count only. The chunk count, character counter and time estimate
          all still exist -- the estimate request below is unchanged, because
          StudioShell renders its `warning` field as the long-reference-clip
          notice -- they simply are not shown here any more. */}
      <div className="flex h-[30px] items-center justify-end border-t border-hairline px-3.5">
        <span className="mono flex min-w-0 items-center gap-2.5 overflow-hidden text-[11px] whitespace-nowrap text-faint">
          <span className={overLimit ? 'text-danger' : undefined}>
            {words.toLocaleString()} word{words === 1 ? '' : 's'}
          </span>
        </span>
      </div>
    </div>
  )
}
