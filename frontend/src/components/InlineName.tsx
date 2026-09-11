import { useEffect, useRef, useState } from 'react'

interface Props {
  /** The name to show when not being edited. */
  value: string
  /** Shown when `value` is empty, and what a commit is compared against so
   *  typing the default back in clears the override rather than pinning it. */
  placeholder: string
  ariaLabel: string
  title?: string
  /** Receives the trimmed draft. Called on Enter and on blur, never on
   *  Escape. May be async; the field does not wait for it. */
  onCommit: (next: string) => void
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
