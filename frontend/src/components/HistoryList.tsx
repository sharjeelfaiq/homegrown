import { useEffect, useRef, useState, type RefObject } from 'react'
import { downloadUrl, mediaUrl, type HistoryEntry } from '../api'
import { downloadName, formatClock, timeAgo } from '../format'
import { usePersistedRecord } from '../hooks/usePersistedRecord'
import VoiceoverPlayer from './VoiceoverPlayer'
import { DownloadIcon, TrashIcon, WandIcon } from './Icons'

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

/** Position and total for one voiceover, as `0:12 / 1:06`.
 *
 * Owns its own state and subscribes to the shared audio element directly, so a
 * playing row updates this element four times a second instead of re-rendering
 * the whole row (and the rename input inside it) at the same rate.
 *
 * Clicking flips the left half to remaining. The total never changes, so the
 * two states are the same width -- see .result-time's min-width, which is what
 * stops the script preview beside it twitching on every toggle. */
function TransportTime({
  audioRef,
  fallbackDurationS,
}: {
  audioRef: RefObject<HTMLAudioElement | null>
  fallbackDurationS: number | null
}) {
  const [position, setPosition] = useState(0)
  const [decoded, setDecoded] = useState<number | null>(null)
  const [showRemaining, setShowRemaining] = useState(false)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    function sync() {
      const el = audioRef.current
      if (!el) return
      setPosition(el.currentTime)
      // audio.duration is authoritative once metadata is in; duration_s from
      // the API is the fallback for preload="none" before anything is loaded.
      if (isFinite(el.duration) && el.duration > 0) setDecoded(el.duration)
    }
    sync()
    for (const ev of ['timeupdate', 'loadedmetadata', 'seeked', 'ended', 'play'] as const) {
      audio.addEventListener(ev, sync)
    }
    return () => {
      for (const ev of ['timeupdate', 'loadedmetadata', 'seeked', 'ended', 'play'] as const) {
        audio.removeEventListener(ev, sync)
      }
    }
  }, [audioRef])

  const total = decoded ?? fallbackDurationS ?? 0
  const left = showRemaining
    ? `-${formatClock(Math.max(0, total - position))}`
    : formatClock(position)

  return (
    <button
      type="button"
      className="mono result-time"
      aria-label={showRemaining ? 'Showing time remaining. Show time played' : 'Showing time played. Show time remaining'}
      onClick={(e) => {
        e.stopPropagation()
        setShowRemaining((v) => !v)
      }}
    >
      {left} / {formatClock(total)}
    </button>
  )
}

/** One voiceover.
 *
 * A component rather than inline JSX because the row needs its own `useRef` for
 * the audio element -- VoiceoverPlayer and TransportTime both watch it, and a
 * hook cannot live inside a .map(). */
function VoiceoverRow({
  entry,
  number,
  name,
  isRenaming,
  draft,
  onDraftChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  skipBlurCommitRef,
  downloadHref,
  onRequeue,
  onDelete,
}: {
  entry: HistoryEntry
  number: number
  name: string
  isRenaming: boolean
  draft: string
  onDraftChange: (v: string) => void
  onStartRename: () => void
  onCommitRename: () => void
  onCancelRename: () => void
  skipBlurCommitRef: RefObject<boolean>
  downloadHref: string
  onRequeue: () => void
  onDelete: () => void
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const created = timeAgo(entry.created_at)

  return (
    <li className="result-row">
      {/* Name left, voice right. The name field is sized to its own text via
          the `size` attribute -- not `field-sizing: content`, which is
          Chromium-only. */}
      <div className="result-line result-line-head">
        <input
          type="text"
          className="result-name"
          spellCheck={false}
          size={Math.max(8, (isRenaming ? draft : name).length + 1)}
          aria-label={`Name of voiceover ${number}`}
          title={`Created ${created} — click to rename`}
          placeholder={`Voiceover ${number}`}
          value={isRenaming ? draft : name}
          onFocus={onStartRename}
          onChange={(e) => onDraftChange(e.target.value)}
          onBlur={() => {
            if (skipBlurCommitRef.current) {
              skipBlurCommitRef.current = false
              return
            }
            onCommitRename()
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              onCommitRename()
              skipBlurCommitRef.current = true
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              skipBlurCommitRef.current = true
              onCancelRename()
              e.currentTarget.blur()
            }
          }}
        />

        <span className="mono result-voice" title={`Voice: ${entry.preset_name}`}>
          {entry.preset_name}
        </span>
      </div>

      {/* Transport left, actions right. The player is the flexible element, so
          the icon strip never gets pushed off. */}
      <div className="result-line">
        <VoiceoverPlayer
          src={mediaUrl(entry.audio_url)}
          durationS={entry.duration_s}
          entryKey={entry.id}
          label={`${name} voiceover`}
          audioRef={audioRef}
        />

        <div className="result-actions">
          <a
            href={downloadHref}
            download
            className="icon-btn"
            aria-label={`Download ${name}`}
            title="Download"
          >
            <DownloadIcon size={14} />
          </a>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Reuse ${name} script`}
            title="Reuse this script"
            onClick={onRequeue}
          >
            <WandIcon size={14} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn-danger"
            aria-label={`Delete ${name}`}
            title="Delete"
            onClick={onDelete}
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </div>

      {/* Time left, script preview right. The preview is the element that
          yields width -- it already ellipsises by design, and a truncated
          clock would be useless. */}
      <div className="result-line result-line-meta">
        <TransportTime audioRef={audioRef} fallbackDurationS={entry.duration_s} />

        <p className="result-text" title={entry.text}>
          {truncate(entry.text)}
        </p>
      </div>
    </li>
  )
}

/** Generated voiceovers, newest first, one page at a time.
 *
 * Each row is three lines: name and voice, then the transport and actions, then
 * the position/total clock and the script preview. The column is only --aside
 * wide, so pairing one left-aligned fact with one right-aligned fact per line
 * is what keeps every value readable instead of competing for the same run of
 * pixels.
 *
 * Names are positional -- "Voiceover 1" is the oldest -- and editable, with the
 * override persisted per entry in localStorage. There is no separate rename
 * button: the name itself is the control, which is also why the download
 * filename follows whatever the row is called.
 *
 * Row actions are always visible but dimmed, brightening on row hover or
 * keyboard focus, so a page of voiceovers still reads as voiceovers rather
 * than as a wall of buttons -- without hiding them behind a gesture. */
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
  // The edit is held locally rather than written straight through, which is
  // what makes Escape able to revert -- the old rename box committed on every
  // keystroke, so there was nothing to go back to.
  const [draft, setDraft] = useState('')
  // Enter and Escape both blur the field themselves, and blur is what commits.
  // Without this flag Enter would commit twice, and Escape would commit the
  // very edit it just discarded.
  const skipBlurCommitRef = useRef(false)

  function startRename(id: string, current: string) {
    setDraft(current)
    skipBlurCommitRef.current = false
    setRenamingId(id)
  }

  function commitRename(id: string) {
    const next = draft.trim()
    // Blank clears the override, so the name falls back to "Voiceover N"
    // rather than being stored as an empty string.
    if (next) setFileName(id, next)
    else removeFileName(id)
    setRenamingId(null)
  }

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
            {history.map((entry, i) => {
              // Oldest is 1. History arrives newest-first and paginated, so the
              // number comes from the entry's position in the whole set, not
              // its index on this page. Derived, not stored: deleting a
              // voiceover renumbers the rest, which is what "chronological"
              // means here.
              const number = total - (page * pageSize + i)
              const name = entryFileNames[entry.id]?.trim() || `Voiceover ${number}`
              return (
                <VoiceoverRow
                  key={entry.id}
                  entry={entry}
                  number={number}
                  name={name}
                  isRenaming={renamingId === entry.id}
                  draft={draft}
                  onDraftChange={setDraft}
                  onStartRename={() => startRename(entry.id, name)}
                  onCommitRename={() => commitRename(entry.id)}
                  onCancelRename={() => setRenamingId(null)}
                  skipBlurCommitRef={skipBlurCommitRef}
                  downloadHref={downloadUrl(
                    entry.audio_url,
                    entryFileNames[entry.id]?.trim() || downloadName(name, entry.created_at),
                  )}
                  onRequeue={() => onRequeue(entry)}
                  onDelete={() => handleDelete(entry.id)}
                />
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
