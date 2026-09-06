import { useState } from 'react'
import { downloadUrl, mediaUrl, type HistoryEntry } from '../api'
import { downloadName, formatDuration, timeAgo } from '../format'
import { usePersistedRecord } from '../hooks/usePersistedRecord'
import VoiceoverPlayer from './VoiceoverPlayer'
import { PencilIcon, TrashIcon, WandIcon } from './Icons'

interface Props {
  history: HistoryEntry[]
  total: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  /** Voiceovers finished while the user was reading an older page. */
  pendingNew: number
  onShowNew: () => void
  onDelete: (id: string) => void
  onRequeue: (entry: HistoryEntry) => void
}

function truncate(text: string, max = 96): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** Generated voiceovers, newest first, one page at a time.
 *
 * Each row leads with the waveform, because the waveform IS the content -- it
 * is the only saturated thing on the page and the only part you act on
 * directly (click or arrow-key to seek, via WaveRibbon inside VoiceoverPlayer).
 * Everything else is metadata in mono, and row actions stay hidden until hover
 * or keyboard focus so a page of voiceovers reads as voiceovers, not buttons. */
export default function HistoryList({
  history,
  total,
  page,
  pageSize,
  onPageChange,
  pendingNew,
  onShowNew,
  onDelete,
  onRequeue,
}: Props) {
  const [entryFileNames, setFileName, removeFileName] = usePersistedRecord('historyFileNames')
  const [renamingId, setRenamingId] = useState<string | null>(null)

  function handleDelete(id: string) {
    removeFileName(id)
    onDelete(id)
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return (
    <section className="results">
      <h2 className="section-rule">
        <span>Voiceovers</span>
        {total > 0 && <span className="mono section-count">{total}</span>}
      </h2>

      {/* Surfaced instead of yanking the user back to page 1 mid-read. */}
      {pendingNew > 0 && (
        <button type="button" className="ghost-btn new-voiceovers" onClick={onShowNew}>
          {pendingNew} new voiceover{pendingNew === 1 ? '' : 's'} — show
        </button>
      )}

      {total === 0 ? (
        <p className="empty-hint">
          No voiceovers yet. Pick a voice, write a script, and press Generate.
        </p>
      ) : (
        <>
          <ul className="result-list">
            {history.map((entry) => {
              const name = entryFileNames[entry.id]?.trim() || entry.preset_name
              return (
                <li key={entry.id} className="result-row">
                  <VoiceoverPlayer
                    src={mediaUrl(entry.audio_url)}
                    durationS={entry.duration_s}
                    entryKey={entry.id}
                    label={`${name} voiceover`}
                  />

                  <div className="result-meta">
                    <p className="result-text" title={entry.text}>
                      {truncate(entry.text)}
                    </p>

                    <div className="result-foot">
                      <span className="mono result-tags">
                        {name}
                        <span className="dot">·</span>
                        {timeAgo(entry.created_at)}
                        {entry.generation_s != null && (
                          <>
                            <span className="dot">·</span>
                            <span title="Time taken to generate">
                              took {formatDuration(entry.generation_s)}
                            </span>
                          </>
                        )}
                      </span>

                      <div className="result-actions">
                        <a
                          href={downloadUrl(
                            entry.audio_url,
                            entryFileNames[entry.id]?.trim() ||
                              downloadName(entry.preset_name, entry.created_at),
                          )}
                          download
                          className="ghost-btn"
                        >
                          Download
                        </a>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Rename ${name} download`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation()
                            setRenamingId((prev) => (prev === entry.id ? null : entry.id))
                          }}
                        >
                          <PencilIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Reuse ${name} script`}
                          onClick={() => onRequeue(entry)}
                        >
                          <WandIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          aria-label={`Delete ${name}`}
                          onClick={() => handleDelete(entry.id)}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                    </div>

                    {renamingId === entry.id && (
                      <input
                        type="text"
                        autoFocus
                        className="rename-input"
                        placeholder="File name (blank = auto)"
                        value={entryFileNames[entry.id] ?? ''}
                        onChange={(e) => setFileName(entry.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={() => setRenamingId(null)}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter' || e.key === 'Escape') setRenamingId(null)
                        }}
                      />
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          {pageCount > 1 && (
            <nav className="paginator" aria-label="Voiceover pages">
              <button
                type="button"
                className="ghost-btn"
                disabled={page === 0}
                onClick={() => onPageChange(page - 1)}
              >
                ← Newer
              </button>
              <span className="mono paginator-status">
                {page + 1} / {pageCount}
              </span>
              <button
                type="button"
                className="ghost-btn"
                disabled={page >= pageCount - 1}
                onClick={() => onPageChange(page + 1)}
              >
                Older →
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  )
}
