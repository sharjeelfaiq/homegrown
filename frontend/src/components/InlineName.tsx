import { useEffect, useRef, useState } from 'react'
import { useFlushOnHide } from '../hooks/useFlushOnHide'

interface Props {
  /** The name to show when not being edited. */
  value: string
  /** Shown when `value` is empty, and what a commit is compared against so
   *  typing the default back in clears the override rather than pinning it. */
  placeholder: string
  ariaLabel: string
  title?: string
  /** Receives the trimmed draft. Called on Enter, on blur, and when the page
   *  is going away mid-edit -- never on Escape. May be async; the field does
   *  not wait for it.
   *
   *  `unloading` is true only for that last case. It matters because the two
   *  callers persist to different places: a voiceover's name is a localStorage
   *  write that lands instantly either way, but a voice's name is a PATCH, and
   *  an ordinary fetch started while the page unloads is cancelled. The caller
   *  needs to know to send it keepalive. */
  onCommit: (next: string, opts?: { unloading?: boolean }) => void
  /** Smallest `size` the field will shrink to, in characters. */
  minChars?: number
  className?: string
}

/** A name that is also its own rename field.
 *
 * One <input>, always present, dressed as plain text until focused. Used for
 * voiceover names in the Voiceovers column and for voice names in the voices
 * dialog. The two persist to completely different places -- localStorage and
 * the backend respectively -- which is exactly why the commit is a prop and
 * this component knows nothing about storage.
 *
 * Shared rather than duplicated because the editing mechanics below are
 * fiddly and were all arrived at by hitting the failure first. Every one of
 * them is load-bearing:
 *
 *  - Width comes from the `size` attribute, set from the text. NOT
 *    `field-sizing: content`, which is Chromium-only.
 *  - Escape must not commit. It blurs, and blur commits, so a flag has to
 *    suppress exactly one commit. A boolean ref rather than state: it is read
 *    and cleared inside the same event, and a re-render there would be both
 *    pointless and too late.
 *  - onKeyDown stops propagation. The app binds "/" and Ctrl+Enter
 *    globally (useHotkeys), so without this, typing a name starts submitting
 *    scripts and toggling playback.
 *  - The draft is not overwritten while the field has focus. A name can
 *    change underneath the editor -- an in-progress voiceover lands and its
 *    name carries over to the history entry -- and that must not yank the
 *    text out from under someone mid-edit.
 *  - An edit still in the field when the page goes away IS committed. Holding
 *    the draft locally is what makes Escape able to revert, so committing on
 *    every keystroke is not an option -- that was the original design and was
 *    removed for exactly that reason -- but the consequence was that typing a
 *    name and hitting reload threw it away. useFlushOnHide closes that without
 *    touching Escape, which blurs first and has therefore already left editing
 *    mode by the time any hide event could fire.
 *
 * The `result-name` utility it is styled with carries the other half of this:
 * every box-affecting property is identical focused and unfocused, so
 * clicking the name moves nothing on the page. Only `background` and
 * `border-color` change on focus. Never add a padding or border-width change
 * there.
 */
export default function InlineName({
  value,
  placeholder,
  ariaLabel,
  title,
  onCommit,
  minChars = 8,
  className = 'result-name',
}: Props) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const skipBlurCommit = useRef(false)

  // Follow the value from outside, but only while not being edited.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  // Committed by the flush already, so the blur that follows must not repeat
  // it -- a reload triggers pagehide AND visibilitychange, and an unmount runs
  // the same handler once more.
  const flushed = useRef(false)

  useFlushOnHide(() => {
    if (!editing || flushed.current) return
    const next = draft.trim()
    // Nothing typed, or typed back to what it already was.
    if (next === value) return
    flushed.current = true
    // Blur fires after this in some teardown orders; suppress its commit
    // rather than send the same value twice (for a voice that is two PATCHes).
    skipBlurCommit.current = true
    onCommit(next, { unloading: true })
  })

  const shown = editing ? draft : value

  return (
    <input
      type="text"
      className={className}
      spellCheck={false}
      size={Math.max(minChars, shown.length + 1)}
      aria-label={ariaLabel}
      title={title}
      placeholder={placeholder}
      value={shown}
      onFocus={() => {
        setDraft(value)
        skipBlurCommit.current = false
        flushed.current = false
        setEditing(true)
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false)
        if (skipBlurCommit.current) {
          skipBlurCommit.current = false
          return
        }
        onCommit(draft.trim())
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          onCommit(draft.trim())
          skipBlurCommit.current = true
          e.currentTarget.blur()
        }
        if (e.key === 'Escape') {
          skipBlurCommit.current = true
          setDraft(value)
          e.currentTarget.blur()
        }
      }}
    />
  )
}
