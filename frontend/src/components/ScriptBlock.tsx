import { useEffect, useState } from 'react'
import { getEstimate, type Preset } from '../api'
import { formatDuration } from '../format'
import { MAX_SCRIPT_CHARS } from '../constants'
import { TrashIcon } from './Icons'

interface Props {
  index: number
  text: string
  onTextChange: (text: string) => void
  presetId: string | null
  onPresetChange: (id: string) => void
  presets: Preset[]
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  canRemove: boolean
}

export default function ScriptBlock({
  index,
  text,
  onTextChange,
  presetId,
  onPresetChange,
  presets,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  canRemove,
}: Props) {
  const overLimit = text.length > MAX_SCRIPT_CHARS
  const [estimatedS, setEstimatedS] = useState<number | null>(null)

  useEffect(() => {
    const chars = text.trim().length
    if (chars === 0 || overLimit) {
      setEstimatedS(null)
      return
    }
    const timer = setTimeout(() => {
      getEstimate(chars)
        .then((r) => setEstimatedS(r.estimated_s))
        .catch(() => setEstimatedS(null))
    }, 400)
    return () => clearTimeout(timer)
  }, [text, overLimit])

  return (
    <div className="script-block">
      <div className="script-block-header">
        <span className="script-block-label">Script {index + 1}</span>
        <div className="script-block-actions">
          <button type="button" className="icon-btn" aria-label="Move up" disabled={!canMoveUp} onClick={onMoveUp}>
            ^
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Move down"
            disabled={!canMoveDown}
            onClick={onMoveDown}
          >
            v
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            aria-label="Remove script"
            disabled={!canRemove}
            onClick={onRemove}
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </div>

      <select value={presetId ?? ''} onChange={(e) => onPresetChange(e.target.value)}>
        <option value="" disabled>
          Choose a voice...
        </option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <textarea
        placeholder="Text to synthesize"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        rows={5}
      />

      <p className={overLimit ? 'char-count char-count-over' : 'char-count'}>
        {text.length} / {MAX_SCRIPT_CHARS} characters
        {overLimit && ' -- too long'}
        {!overLimit && estimatedS != null && ` -- estimated time: ~${formatDuration(estimatedS)}`}
      </p>
    </div>
  )
}
