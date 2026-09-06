import { useEffect, useState, type RefObject } from 'react'
import { getEstimate, type Estimate } from '../api'
import { formatDuration } from '../format'
import { MAX_SCRIPT_CHARS } from '../constants'

interface Props {
  text: string
  onTextChange: (text: string) => void
  /** Focused by the "/" shortcut. */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  /** Chunking depends on the voice, so the estimate has to be re-fetched when
   * it changes -- not only when the text does. */
  presetId: string | null
  /** No job has finished yet this session, so timings are unreliable. */
  firstRun?: boolean
  onEstimate?: (estimate: Estimate | null) => void
}

/** Show the character counter only as the limit gets close. "0/60000" at rest
 * is noise, and 60,000 is an alarming number out of context. */
const COUNTER_VISIBLE_FROM = MAX_SCRIPT_CHARS * 0.8

export default function ScriptBlock({
  text,
  onTextChange,
  textareaRef,
  presetId,
  firstRun,
  onEstimate,
}: Props) {
  const overLimit = text.length > MAX_SCRIPT_CHARS
  const [estimate, setEstimate] = useState<Estimate | null>(null)

  useEffect(() => {
    if (text.trim().length === 0 || overLimit) {
      setEstimate(null)
      onEstimate?.(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      getEstimate(text, presetId)
        .then((r) => {
          if (cancelled) return
          setEstimate(r)
          onEstimate?.(r)
        })
        .catch(() => {
          if (cancelled) return
          setEstimate(null)
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

  const showCounter = text.length >= COUNTER_VISIBLE_FROM || overLimit

  return (
    <div className="block">
      {/* Fixed height, resized by dragging the corner grip -- not auto-growing.
          The user sets the working height once and it stays put instead of the
          page reflowing on every keystroke. */}
      <textarea
        ref={textareaRef}
        className="block-input"
        placeholder="Write what the voice should say…"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
      />

      <div className="block-foot">
        <span className="mono block-meta">
          {estimate?.chunks != null && estimate.chunks > 0 && (
            <span
              title={
                estimate.chunk_chars != null
                  ? `Split into ${estimate.chunks} chunk${estimate.chunks === 1 ? '' : 's'} of up to ${estimate.chunk_chars} characters — a size set by this voice's reference clip, not a fixed limit.`
                  : undefined
              }
            >
              {estimate.chunks} chunk{estimate.chunks === 1 ? '' : 's'}
            </span>
          )}
          {showCounter && (
            <span className={overLimit ? 'over' : undefined}>
              {text.length.toLocaleString()}/{MAX_SCRIPT_CHARS.toLocaleString()}
            </span>
          )}
          {overLimit && <span className="over">too long</span>}
          {!overLimit && estimate != null && (
            <span
              title={
                firstRun
                  ? 'The first render after starting the app also builds CUDA graphs, so it runs slower than this estimate.'
                  : 'Estimated from how long your previous renders took.'
              }
            >
              ≈{formatDuration(estimate.estimated_s)}
              {firstRun && <span className="est-caveat"> · first run is slower</span>}
            </span>
          )}
        </span>
      </div>
    </div>
  )
}
