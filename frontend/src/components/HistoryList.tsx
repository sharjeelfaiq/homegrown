import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { motion } from 'framer-motion'
import { cancelQueuedJob, downloadUrl, mediaUrl, type HistoryEntry, type QueueEntry } from '../api'
import { downloadName, formatClock, timeAgo } from '../format'
import { useGenerationActivity } from '../GenerationActivityContext'
import { useElapsed } from '../hooks/useElapsed'
import { useOptimisticProgress } from '../hooks/useOptimisticProgress'
import { usePersistedRecord } from '../hooks/usePersistedRecord'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
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

/** Past this many chunks the boundary ticks fall below ~4px apart and read as
 * noise rather than structure, so they are dropped and the bar stands alone.
 * A voice with a long reference clip chunks at ~80 characters, which turns the
 * 60,000-character limit into ~750 chunks, so this end of the range is real. */
const MAX_TICKS = 60

function truncate(text: string, max = 96): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** The rename field plus the voice name -- line one of every row, finished or
 * in progress. Shared rather than duplicated: the whole point of the
 * in-progress row is that it is the same row, so a change to the rename
 * behaviour must not be able to apply to only one of them. */
interface NameControl {
  number: number
  name: string
  isRenaming: boolean
  draft: string
  onDraftChange: (v: string) => void
  onStartRename: () => void
  onCommitRename: () => void
  onCancelRename: () => void
  skipBlurCommitRef: RefObject<boolean>
}

function RowHead({
  number,
  name,
  isRenaming,
  draft,
  onDraftChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  skipBlurCommitRef,
  voiceName,
  nameTitle,
}: NameControl & { voiceName: string; nameTitle: string }) {
  return (
    // Name left, voice right. The name field is sized to its own text via the
    // `size` attribute -- not `field-sizing: content`, which is Chromium-only.
    <div className="result-line result-line-head">
      <input
        type="text"
        className="result-name"
        spellCheck={false}
        size={Math.max(8, (isRenaming ? draft : name).length + 1)}
        aria-label={`Name of voiceover ${number}`}
        title={nameTitle}
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

      <span className="mono result-voice" title={`Voice: ${voiceName}`}>
        {voiceName}
      </span>
    </div>
  )
}

/** Position and total for one voiceover, as `0:12 / 1:06`.
 *
 * Owns its own state and subscribes to the shared audio element directly, so a
 * playing row updates this element four times a second instead of re-rendering
 * the whole row (and the rename input inside it) at the same rate.
 *
 * Clicking flips the left half to remaining. The total never changes, so the
 * two states are the same width -- see .result-time's min-width, which is what
 * stops the script preview beside it twitching on every toggle.
 *
 * This is playback time, and the toggle stays: it is the generation readout
 * that has no remaining, because that number was an estimate that moved in
 * both directions. */
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
  const left = showRemaining ? formatClock(Math.max(0, total - position)) : formatClock(position)

  return (
    <button
      type="button"
      className="mono result-time"
      aria-label={
        showRemaining
          ? 'Showing time remaining. Show time played'
          : 'Showing time played. Show time remaining'
      }
      onClick={(e) => {
        e.stopPropagation()
        setShowRemaining((v) => !v)
      }}
    >
      {/* The minus gets a permanently reserved 1ch slot rather than being
          prepended to the string. It is the ONLY character that differs
          between the two states -- the digits are tabular -- so reserving it
          makes both states exactly the same width, at any duration. A
          min-width guess cannot do that: 84px was already too narrow for
          "-0:54 / 1:06", and any fixed number breaks again past ten minutes. */}
      <span className="result-time-sign" aria-hidden="true">
        {showRemaining ? '-' : ''}
      </span>
      {left} / {formatClock(total)}
    </button>
  )
}

/** One voiceover being generated, in the slot its finished self will occupy.
 *
 * Same three lines as VoiceoverRow, with three swaps: the waveform becomes the
 * progress bar, the transport controls become Cancel, and the playback clock
 * becomes elapsed generation time. There is no pause control because there is
 * no pause: generation is serialised behind one GPU lock, so a paused job would
 * hold that lock and stall every other queued job. Cancel is the honest
 * control, and it lands at the next chunk boundary (~1s).
 *
 * Download and "reuse this script" are absent for the obvious reason -- there
 * is nothing to download yet, and the script is still in flight. */
function PendingRow({
  job,
  nameControl,
  onCancel,
}: {
  job: QueueEntry
  nameControl: NameControl
  onCancel: () => void
}) {
  const running = job.status === 'running'
  const canceling = job.status === 'canceling'
  const progress = useOptimisticProgress(running ? job : undefined)
  const elapsed = useElapsed(job)
  const reduced = usePrefersReducedMotion()

  const total = job.total_chunks || 0
  const done = job.chunks_done || 0
  const showTicks = total > 1 && total <= MAX_TICKS
  const chunkLabel = total > 0 ? `chunk ${Math.min(done + 1, total)} of ${total}` : 'Generating'

  return (
    <li className="result-row result-row-pending">
      <RowHead {...nameControl} voiceName={job.preset_name} nameTitle="Click to rename" />

      {/* Bar left, Cancel right -- the same geometry as transport-then-actions,
          so the two row kinds line up down the column. */}
      <div className="result-line">
        {/* One bar for every chunk count. The boundary ticks are a repeating
            gradient driven by --chunks rather than one element per chunk, so
            three chunks and seven hundred cost the same. */}
        <div
          className={`result-bar${showTicks ? ' has-ticks' : ''}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total || 100}
          aria-valuenow={total ? done : Math.round(progress)}
          aria-label={total ? `Generating chunk ${Math.min(done + 1, total)} of ${total}` : 'Generating'}
          title={chunkLabel}
          style={{ '--chunks': total || 1 } as CSSProperties}
        >
          <motion.div
            className="result-bar-fill"
            initial={false}
            animate={{ width: `${running ? progress : 0}%` }}
            transition={reduced ? { duration: 0 } : { duration: 0.5, ease: [0.2, 0, 0, 1] }}
          >
            {running && !reduced && <span className="result-bar-sheen" aria-hidden="true" />}
          </motion.div>
        </div>

        <div className="result-actions">
          <button
            type="button"
            className="ghost-btn ghost-btn-danger result-cancel"
            onClick={onCancel}
            disabled={canceling}
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Elapsed left, script preview right. Elapsed, never remaining: the
          backend's eta_s is a rolling chars/second average that moves in both
          directions as chunks land, so watching it told the user nothing. */}
      <div className="result-line result-line-meta">
        <span className="mono result-time" aria-live="polite">
          {canceling ? 'Cancelling…' : elapsed == null ? 'Queued' : formatClock(elapsed)}
        </span>

        <p className="result-text" title={job.text_preview}>
          {truncate(job.text_preview)}
        </p>
      </div>
    </li>
  )
}

/** One voiceover.
 *
 * A component rather than inline JSX because the row needs its own `useRef` for
 * the audio element -- VoiceoverPlayer and TransportTime both watch it, and a
 * hook cannot live inside a .map(). */
function VoiceoverRow({
  entry,
  nameControl,
  name,
  downloadHref,
  onRequeue,
  onDelete,
}: {
  entry: HistoryEntry
  nameControl: NameControl
  name: string
  downloadHref: string
  onRequeue: () => void
  onDelete: () => void
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const created = timeAgo(entry.created_at)

  return (
    <li className="result-row">
      <RowHead
        {...nameControl}
        voiceName={entry.preset_name}
        nameTitle={`Created ${created} — click to rename`}
      />

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

/** Generated voiceovers, newest first, one page at a time -- plus whatever is
 * currently being generated, as the first rows.
 *
 * Each row is three lines: name and voice, then the transport and actions, then
 * the position/total clock and the script preview. The column is only --aside
 * wide, so pairing one left-aligned fact with one right-aligned fact per line
 * is what keeps every value readable instead of competing for the same run of
 * pixels.
 *
 * The in-progress rows come from the shared queue poller, not from a poll of
 * their own, and they use the same row layout so a job does not visibly jump
 * between two different presentations when it finishes. They render on every
 * page: a job you just submitted is live status, not a paginated result.
 *
 * Names are positional -- "Voiceover 1" is the oldest -- and editable, with the
 * override persisted per entry in localStorage. There is no separate rename
 * button: the name itself is the control, which is also why the download
 * filename follows whatever the row is called. A name typed into an in-progress
 * row is held under its job id and written through to the history entry when
 * the job lands (see the carry-over effect below).
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
  const { queue, refresh } = useGenerationActivity()
  const [entryFileNames, setFileName, removeFileName] = usePersistedRecord('historyFileNames')
  // Names for jobs that have no history entry yet, keyed by job id. Not
  // persisted: the job either lands within the session and the name moves to
  // localStorage under the real entry id, or it never existed.
  const [pendingNames, setPendingNames] = useState<Record<string, string>>({})
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // The edit is held locally rather than written straight through, which is
  // what makes Escape able to revert -- the old rename box committed on every
  // keystroke, so there was nothing to go back to.
  const [draft, setDraft] = useState('')
  // Enter and Escape both blur the field themselves, and blur is what commits.
  // Without this flag Enter would commit twice, and Escape would commit the
  // very edit it just discarded.
  const skipBlurCommitRef = useRef(false)

  const active = queue.filter(
    (e) => e.status === 'running' || e.status === 'queued' || e.status === 'canceling',
  )

  // Carry a name typed into an in-progress row over to the history entry it
  // becomes. There is no job_id on a HistoryEntry, so the two are matched on
  // audio_url -- the only field they share once the job is done. Without this
  // the rename silently vanishes at the exact moment the row turns real.
  useEffect(() => {
    const landed = queue.filter((e) => e.status === 'done' && e.audio_url && pendingNames[e.job_id])
    if (landed.length === 0) return
    const claimed: string[] = []
    for (const job of landed) {
      const entry = history.find((h) => h.audio_url === job.audio_url)
      if (!entry) continue // its page has not been fetched yet; try again next poll
      setFileName(entry.id, pendingNames[job.job_id])
      claimed.push(job.job_id)
    }
    if (claimed.length === 0) return
    setPendingNames((prev) => {
      const next = { ...prev }
      for (const id of claimed) delete next[id]
      return next
    })
  }, [queue, history, pendingNames, setFileName])

  function startRename(id: string, current: string) {
    setDraft(current)
    skipBlurCommitRef.current = false
    setRenamingId(id)
  }

  // Blank clears the override so the name falls back to "Voiceover N" -- and so
  // does the default itself. Focusing a row and tabbing straight out otherwise
  // stores "Voiceover 5" as an explicit name, which pins that number and stops
  // it renumbering when an older voiceover is deleted.
  function commitRename(id: string, pending: boolean, defaultName: string) {
    const typed = draft.trim()
    const next = typed === defaultName ? '' : typed
    if (pending) {
      setPendingNames((prev) => {
        const copy = { ...prev }
        if (next) copy[id] = next
        else delete copy[id]
        return copy
      })
    } else if (next) {
      setFileName(id, next)
    } else {
      removeFileName(id)
    }
    setRenamingId(null)
  }

  function nameControlFor(
    id: string,
    number: number,
    override: string | undefined,
    pending: boolean,
  ): NameControl {
    const defaultName = `Voiceover ${number}`
    const name = override?.trim() || defaultName
    return {
      number,
      name,
      isRenaming: renamingId === id,
      draft,
      onDraftChange: setDraft,
      onStartRename: () => startRename(id, name),
      onCommitRename: () => commitRename(id, pending, defaultName),
      onCancelRename: () => setRenamingId(null),
      skipBlurCommitRef,
    }
  }

  function handleDelete(id: string) {
    removeFileName(id)
    onDelete(id)
  }

  async function handleCancel(jobId: string) {
    try {
      await cancelQueuedJob(jobId)
    } finally {
      refresh()
    }
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

      {total === 0 && active.length === 0 ? (
        <p className="empty-hint">
          No voiceovers yet. Pick a voice, write a script, and press Generate.
        </p>
      ) : (
        <>
          <ul className="result-list">
            {active.map((job, i) => {
              // The number this row will keep. /api/queue returns the running
              // job first and queued jobs in real processing order, so the
              // running one is the next to land and takes the next number.
              const number = total + 1 + i
              return (
                <PendingRow
                  key={job.job_id}
                  job={job}
                  nameControl={nameControlFor(job.job_id, number, pendingNames[job.job_id], true)}
                  onCancel={() => handleCancel(job.job_id)}
                />
              )
            })}

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
                  nameControl={nameControlFor(entry.id, number, entryFileNames[entry.id], false)}
                  name={name}
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
