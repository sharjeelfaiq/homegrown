import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { motion } from 'framer-motion'
import {
  ApiError,
  cancelQueuedJob,
  deleteQueueJob,
  retryQueueJob,
  downloadUrl,
  mediaUrl,
  type HistoryEntry,
  type QueueEntry,
} from '../api'
import { downloadName, formatClock, timeAgo } from '../format'
import { useGenerationActivity } from '../GenerationActivityContext'
import { useElapsed } from '../hooks/useElapsed'
import { useOptimisticProgress } from '../hooks/useOptimisticProgress'
import { usePersistedRecord } from '../hooks/usePersistedRecord'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import InlineName from './InlineName'
import VoiceoverPlayer from './VoiceoverPlayer'
import { DownloadIcon, TrashIcon, WandIcon } from './Icons'

interface Props {
  history: HistoryEntry[]
  total: number
  /** The APPLIED search. The draft being typed lives here; this is what the
   *  caller has already fetched against. */
  query: string
  /** Called with a debounced query. The caller refetches from offset 0. */
  onQueryChange: (q: string) => void
  /** True while more entries exist past what `history` already holds. */
  hasMore: boolean
  /** Fetch the next slice. Safe to call repeatedly -- the caller de-dupes. */
  onLoadMore: () => void
  /** Voiceovers that finished while the user was scrolled away from the top. */
  pendingNew: number
  onShowNew: () => void
  /** Fires when the list scrolls to or away from its top, so the caller can
   * decide whether a finished voiceover may be inserted under the user's eyes
   * or has to be announced instead. */
  onAtTopChange: (atTop: boolean) => void
  onDelete: (id: string) => void
  onRequeue: (entry: HistoryEntry) => void
  /** Surfaces a failed Retry. Without it an ApiError from the retry endpoint
   * is swallowed and the click looks like it did nothing -- the exact failure
   * mode this whole row state exists to remove. */
  onError: (message: string) => void
  /** True once the GPU is gone. Retry is hidden rather than disabled-with-a-
   * tooltip: there is nothing the user can do in-app to make it work. */
  gpuFault?: boolean
  /** True before the first fetch has returned. Without it an empty column
   * tells a starting-up user to "pick a voice and press Generate", which is
   * advice they cannot act on yet. */
  loading?: boolean
}

/** Past this many chunks the boundary ticks fall below ~4px apart and read as
 * noise rather than structure, so they are dropped and the bar stands alone.
 * A voice with a long reference clip chunks at ~80 characters, which turns the
 * 60,000-character limit into ~750 chunks, so this end of the range is real. */
const MAX_TICKS = 60

/* The two-column layout, and with it the fixed-height scrolling Voiceovers
 * block. Mirrors the `@media (min-width: 1025px)` / `(max-width: 1024px)` pair
 * in index.css -- above it the list scrolls, below it the page does, and the two
 * effects below have to pick their scroll root accordingly. Change all three
 * together; nothing enforces it. */
const TWO_COLUMN_QUERY = '(min-width: 1025px)'

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
  /** Overrides the "Voiceover N" placeholder. A failed row has no number --
   * it never becomes a voiceover -- so it must not advertise one. */
  placeholder?: string
  /** Receives the trimmed draft. The editing mechanics live in InlineName. */
  onCommitRename: (next: string) => void
}

function RowHead({
  number,
  name,
  placeholder,
  onCommitRename,
  voiceName,
  nameTitle,
}: NameControl & { voiceName: string; nameTitle: string }) {
  return (
    // Name left, voice right.
    <div className="flex min-h-[26px] min-w-0 items-center justify-between gap-2">
      <InlineName
        value={name}
        placeholder={placeholder ?? `Voiceover ${number}`}
        ariaLabel={placeholder ?? `Name of voiceover ${number}`}
        title={nameTitle}
        onCommit={onCommitRename}
      />

      <span className="mono ml-auto max-w-[55%] flex-none overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-faint" title={`Voice: ${voiceName}`}>
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
      <span className="inline-block w-[1ch]" aria-hidden="true">
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
  onRetry,
}: {
  job: QueueEntry
  nameControl: NameControl
  onCancel: () => void
  /** Only meaningful on a failed row; undefined elsewhere. */
  onRetry?: () => void
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

  // Queued is the only state that gets its own colour. `canceling` deliberately
  // does not: the job is still running until the current chunk ends, so
  // painting it as "not started" would be a lie -- the row already says
  // "Cancelling…".
  const queued = job.status === 'queued'
  // Terminal and unrecoverable. The row stays so the failure is visible, but
  // everything that implies work in progress -- the sheen, the elapsed clock,
  // Cancel -- has to stop meaning what it meant.
  const failed = job.status === 'error'
  const reason = job.error || 'Generation failed.'
  // A retry mints a new job id and replaces this row, so a job that fails
  // instantly on every attempt looks like a button that does nothing. The
  // count is the proof that something happened.
  const attempt = job.attempt ?? 1

  return (
    <li
      className={[
        'flex flex-col gap-0.5 border-b border-hairline py-[7px] last:border-b-0',
        queued && 'is-queued',
        failed && 'is-failed',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <RowHead {...nameControl} voiceName={job.preset_name} nameTitle="Click to rename" />

      {/* Bar left, Cancel right -- the same geometry as transport-then-actions,
          so the two row kinds line up down the column. */}
      <div className="flex min-w-0 items-center gap-2.5">
        {/* One bar for every chunk count. The boundary ticks are a repeating
            gradient driven by --chunks rather than one element per chunk, so
            three chunks and seven hundred cost the same. */}
        <div
          className={['result-bar', showTicks && 'has-ticks'].filter(Boolean).join(' ')}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total || 100}
          aria-valuenow={total ? done : Math.round(progress)}
          aria-label={
            failed
              ? 'Failed'
              : queued
                ? 'Queued, not started'
                : total
                  ? `Generating chunk ${Math.min(done + 1, total)} of ${total}`
                  : 'Generating'
          }
          title={
            failed
              ? reason
              : queued
                ? 'Queued — starts when the current voiceover finishes'
                : chunkLabel
          }
          style={{ '--chunks': total || 1 } as CSSProperties}
        >
          <motion.div
            className="relative h-full overflow-hidden rounded-sm bg-progress"
            initial={false}
            animate={{ width: `${running ? progress : 0}%` }}
            transition={reduced ? { duration: 0 } : { duration: 0.5, ease: [0.2, 0, 0, 1] }}
          >
            {running && !reduced && <span className="absolute inset-0 animate-sheen bg-[linear-gradient(90deg,transparent,var(--sheen),transparent)]" aria-hidden="true" />}
          </motion.div>
        </div>

        {/* Elapsed, never remaining: the backend's eta_s is a rolling
            chars/second average that moves in both directions as chunks land,
            so watching it told the user nothing. Same slot the finished row
            puts its clock in, so the two line up. */}
        <span className="mono result-time" aria-live="polite">
          {/* The same reserved slot TransportTime puts the minus in. Empty
              here -- there is no remaining to toggle to -- but it keeps this
              row's digits on the same column as a finished row's. */}
          <span className="inline-block w-[1ch]" aria-hidden="true" />
          {failed
            ? attempt > 1
              ? `Failed · try ${attempt}`
              : 'Failed'
            : canceling
              ? 'Cancelling…'
              : elapsed == null
                ? 'Queued'
                : formatClock(elapsed)}
        </span>

        <div className="result-actions flex flex-none items-center gap-0.5">
          {/* Retry first: after a failure that was not the script's fault --
              a GPU fault takes out everything queued behind it -- resubmitting
              is what the user wants, and dismissing throws the script away. */}
          {failed && onRetry && (
            <button type="button" className="ghost-btn h-6 px-2.5 text-[11px]" onClick={onRetry}>
              Retry
            </button>
          )}
          <button
            type="button"
            className="ghost-btn ghost-btn-danger h-6 px-2.5 text-[11px]"
            onClick={onCancel}
            disabled={canceling}
          >
            {failed ? 'Dismiss' : 'Cancel'}
          </button>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2.5">
        <p className="result-text m-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-muted" title={failed ? reason : job.text_preview}>
          {truncate(failed ? reason : job.text_preview)}
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
    <li className="group/row flex flex-col gap-0.5 border-b border-hairline py-[7px] last:border-b-0">
      <RowHead
        {...nameControl}
        voiceName={entry.preset_name}
        nameTitle={`Created ${created} — click to rename`}
      />

      {/* Transport, clock, actions -- one line. The clock used to sit on its own
          line beside the script preview; moving it up is what lets the preview
          have the last line to itself and the row get shorter. The player is
          the flexible element, so the icon strip is never pushed off. */}
      <div className="flex min-w-0 items-center gap-2.5">
        <VoiceoverPlayer
          src={mediaUrl(entry.audio_url)}
          durationS={entry.duration_s}
          entryKey={entry.id}
          label={`${name} voiceover`}
          audioRef={audioRef}
        />

        <TransportTime audioRef={audioRef} fallbackDurationS={entry.duration_s} />

        <div className="result-actions flex flex-none items-center gap-0.5 opacity-50 transition-opacity duration-(--fast) ease-(--ease) group-hover/row:opacity-100 group-focus-within/row:opacity-100">
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

      {/* The script preview now has this line to itself, so it gets the full
          column width before ellipsising. */}
      <div className="flex min-w-0 items-center gap-2.5">
        <p className="result-text m-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-muted" title={entry.text}>
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
 * than as a wall of buttons -- without hiding them behind a gesture.
 *
 * Three class names below are HOOKS, not styles -- everything they look like
 * is in the utilities sitting beside them:
 *   .results         part of the min-height: 0 chain (StudioShell's wide:
 *                    utilities). A flex item's
 *                    default min-height: auto refuses to shrink below its
 *                    content, and one missing link anywhere in that chain puts
 *                    the scrollbar back on the page instead of on the list.
 *   .result-actions  two media-query behaviours: (hover: none) pins the strip
 *                    at full opacity, because a touch screen has no hover to
 *                    reveal it with, and (pointer: coarse) widens its gap.
 *   .result-text     is-failed colours it --danger-text by descendant selector.
 * Delete any of them and the thing it hooks stops happening, silently. */
export default function HistoryList({
  history,
  total,
  query,
  onQueryChange,
  hasMore,
  onLoadMore,
  pendingNew,
  onShowNew,
  onAtTopChange,
  onDelete,
  onRequeue,
  onError,
  gpuFault = false,
  loading = false,
}: Props) {
  const { queue, refresh } = useGenerationActivity()
  const [entryFileNames, setFileName, removeFileName] = usePersistedRecord('historyFileNames')
  // Names for jobs that have no history entry yet, keyed by job id. Not
  // persisted: the job either lands within the session and the name moves to
  // localStorage under the real entry id, or it never existed.
  const [pendingNames, setPendingNames] = useState<Record<string, string>>({})
  // The edit is held locally rather than written straight through, which is
  // what makes Escape able to revert -- the old rename box committed on every
  // keystroke, so there was nothing to go back to.
  // Enter and Escape both blur the field themselves, and blur is what commits.
  // Without this flag Enter would commit twice, and Escape would commit the
  // very edit it just discarded.

  const listRef = useRef<HTMLUListElement>(null)
  const sentinelRef = useRef<HTMLLIElement>(null)

  // The search box is uncontrolled by the parent on purpose: `draft` is what
  // is being typed and `query` is what has been fetched. Lifting the draft up
  // would make every keystroke a request, and threading it back down would
  // make every keystroke re-render the whole voiceovers column.
  const [draft, setDraft] = useState(query)
  // Follow the parent when it clears or changes the query from outside (there
  // is no such caller today, but a stale draft after an external reset is the
  // kind of thing that only shows up much later).
  useEffect(() => {
    setDraft(query)
    // Intentionally NOT depending on `draft`: this syncs down, never up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // 250ms: below ~150 the request fires mid-word on a fast typist, above ~350
  // the list feels detached from the keyboard. The guard matters as much as
  // the delay -- without it, blurring or re-rendering would re-issue the same
  // query and reset the user's scroll depth for no new information.
  useEffect(() => {
    if (draft === query) return
    const id = window.setTimeout(() => onQueryChange(draft), 250)
    return () => window.clearTimeout(id)
  }, [draft, query, onQueryChange])

  // Failures are included, and sorted to the bottom. That ordering does not
  // come for free: /api/queue sorts by `queue_position if not None else -1`,
  // and a terminal job has no position -- so a job that failed BEFORE the
  // current one started shares the running job's -1 and can sort above it.
  //
  // `canceled` stays out. The user stopped that one deliberately and does not
  // need telling. (Those entries do sit in the backend's in-memory _jobs
  // unclaimed; dismissing them would mean firing a side-effectful request from
  // a poll loop, which is the worse trade.)
  //
  // A RUNNING SEARCH HIDES THEM. An in-flight job has no finished script to
  // match -- its text_preview is truncated to 80 chars server-side and the
  // filter runs on the backend's full history, which it is not in yet -- so
  // leaving these visible would put rows in a filtered list that the filter
  // never considered, and make the heading's count disagree with what is on
  // screen. Clearing the box brings them straight back.
  const active =
    query !== ''
      ? []
      : queue
          .filter(
            (e) =>
              e.status === 'running' ||
              e.status === 'queued' ||
              e.status === 'canceling' ||
              e.status === 'error',
          )
          .sort((a, b) => Number(a.status === 'error') - Number(b.status === 'error'))

  // Load the next slice when the end of the list scrolls into view.
  // IntersectionObserver rather than a scroll handler: it fires once per
  // crossing instead of on every frame of a scroll.
  //
  // The root has to follow the layout. Above the breakpoint the list is a
  // fixed-height scroller and is the correct root. Below it the CSS sets
  // `overflow-y: visible`, so the <ul> grows to fit its rows and the sentinel
  // is ALWAYS inside its bounds -- rooted there, the observer reports
  // intersecting immediately and every append re-arms it, which chain-loads the
  // entire history in one go. `null` (the viewport) is what actually works down
  // there, since the page is the scroller.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return
    const mq = window.matchMedia(TWO_COLUMN_QUERY)
    let io: IntersectionObserver | undefined
    const arm = () => {
      io?.disconnect()
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) onLoadMore()
        },
        { root: mq.matches ? listRef.current : null, rootMargin: '120px' },
      )
      io.observe(sentinel)
    }
    arm()
    mq.addEventListener('change', arm)
    return () => {
      mq.removeEventListener('change', arm)
      io?.disconnect()
    }
  }, [hasMore, onLoadMore, history.length])

  // Whether the reader is at the top decides if a finished voiceover may be
  // inserted above them or has to be announced. Reported up rather than decided
  // here, because the caller owns the fetch.
  //
  // Same split as above: the list's own scrollTop is meaningless below the
  // breakpoint, where it never scrolls and would read 0 forever -- i.e. always
  // "at the top", so a finished voiceover would always be inserted under the
  // reader. There, ask where the list sits in the viewport instead.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const mq = window.matchMedia(TWO_COLUMN_QUERY)
    const report = () => {
      onAtTopChange(mq.matches ? list.scrollTop < 8 : list.getBoundingClientRect().top > -8)
    }
    report()
    list.addEventListener('scroll', report, { passive: true })
    window.addEventListener('scroll', report, { passive: true })
    mq.addEventListener('change', report)
    return () => {
      list.removeEventListener('scroll', report)
      window.removeEventListener('scroll', report)
      mq.removeEventListener('change', report)
    }
  }, [onAtTopChange])

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

  // Blank clears the override so the name falls back to "Voiceover N" -- and so
  // does the default itself. Focusing a row and tabbing straight out otherwise
  // stores "Voiceover 5" as an explicit name, which pins that number and stops
  // it renumbering when an older voiceover is deleted.
  function commitRename(id: string, pending: boolean, defaultName: string, typed: string) {
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
  }

  function nameControlFor(
    id: string,
    number: number,
    override: string | undefined,
    pending: boolean,
    placeholder?: string,
  ): NameControl {
    const defaultName = placeholder ?? `Voiceover ${number}`
    const name = override?.trim() || defaultName
    return {
      number,
      name,
      placeholder,
      onCommitRename: (typed: string) => commitRename(id, pending, defaultName, typed),
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

  // Cancel is meaningless on a job that already stopped, so a failed row's
  // control removes it instead. The endpoint accepts only canceled/error
  // status, which is exactly what this can be called with -- its 400 branch is
  // unreachable from here.
  async function handleDismiss(jobId: string) {
    try {
      await deleteQueueJob(jobId)
    } finally {
      refresh()
    }
  }

  // The backend resubmits from the script it still holds and removes the failed
  // job only once the new one is accepted, so a retry that fails validation
  // leaves the original row and its error in place.
  async function handleRetry(jobId: string) {
    try {
      await retryQueueJob(jobId)
    } catch (e) {
      // The endpoint revalidates like any submission, so this is a real answer
      // -- most often a 404 because the voice was deleted since the failure.
      onError(e instanceof ApiError ? e.message : 'Could not retry that voiceover.')
    } finally {
      refresh()
    }
  }

  return (
    <section className="results flex flex-col gap-1">
      <h2 className="section-rule">
        <span>Voiceovers</span>
        {total > 0 && <span className="mono order-3 text-[11px]">{total}</span>}
      </h2>

      {/* Rendered whenever there is anything to search OR a search is already
          running -- the second half matters, or the box vanishes the moment a
          query matches nothing and there is no way to clear it.

          type="search", not "text": it gets the native clear affordance and
          the right on-screen keyboard, and Escape clears it for free. The
          onKeyDown stops propagation for the same reason InlineName does --
          the app binds "/" and Space globally (useHotkeys), so without it
          typing a search would fire shortcuts. isTyping() already covers
          INPUT, but Escape is NOT gated by it and would clear the composer's
          error banner behind the column. */}
      {(total > 0 || query !== '' || history.length > 0) && (
        <input
          type="search"
          className="mb-2 h-8 w-full rounded-sm border border-control bg-surface-raised px-2.5 text-[13px] text-ink outline-none placeholder:text-faint focus:border-audio-line"
          placeholder="Search scripts and voices…"
          aria-label="Search voiceovers by script text or voice name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') setDraft('')
          }}
        />
      )}

      {/* Surfaced instead of scrolling the list out from under a reader. */}
      {pendingNew > 0 && (
        <button
          type="button"
          className="ghost-btn mb-2.5 self-start border-audio-line text-audio hover:not-disabled:border-audio hover:not-disabled:bg-audio-soft hover:not-disabled:text-audio"
          onClick={() => {
            onShowNew()
            listRef.current?.scrollTo({ top: 0 })
          }}
        >
          {pendingNew} new voiceover{pendingNew === 1 ? '' : 's'} — show
        </button>
      )}

      {total === 0 && active.length === 0 ? (
        <p className="m-0 py-5 text-[13px] text-faint">
          {loading
            ? 'Loading your voiceovers…'
            : query !== ''
              ? // Distinct from the never-generated-anything copy below. Telling
                // someone with 40 voiceovers to "pick a voice and press
                // Generate" because their search missed reads as the app having
                // lost their work.
                `No voiceovers match “${query}”. Searching looks at the script and the voice, not the name you gave a voiceover.`
              : 'No voiceovers yet. Pick a voice, write a script, and press Generate.'}
        </p>
      ) : (
        <>
          <ul className="result-list" ref={listRef}>
            {active.map((job, i) => {
              // The number this row will keep. /api/queue returns the running
              // job first and queued jobs in real processing order, so the
              // running one is the next to land and takes the next number.
              //
              // A failed job never becomes a voiceover, so it must not consume
              // a number -- doing so would both promise one that never arrives
              // and shift every row beneath it. Count only the rows still
              // headed for the history, which is why this counts rather than
              // using the map index. (Failures sort last, so the count is
              // already complete by the time one is reached.)
              const failed = job.status === 'error'
              const pendingBefore = active.slice(0, i).filter((e) => e.status !== 'error').length
              const number = total + 1 + pendingBefore
              return (
                <PendingRow
                  key={job.job_id}
                  job={job}
                  nameControl={nameControlFor(
                    job.job_id,
                    number,
                    pendingNames[job.job_id],
                    true,
                    failed ? 'Failed' : undefined,
                  )}
                  onCancel={() => (failed ? handleDismiss(job.job_id) : handleCancel(job.job_id))}
                  onRetry={failed && !gpuFault ? () => handleRetry(job.job_id) : undefined}
                />
              )
            })}

            {history.map((entry, i) => {
              // Oldest is 1. The list is newest-first and accumulates as you
              // scroll, so index in the list IS index in the whole set --
              // no page offset any more. Derived, not stored: deleting a
              // voiceover renumbers the rest, which is what "chronological"
              // means here.
              const number = total - i
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
            {/* The trigger for the next slice, and the only "there is more"
                signal the user gets. Inside the <ul> so it scrolls with the
                rows and so IntersectionObserver can scope to this list. */}
            {hasMore && (
              <li className="py-3.5 text-center text-[11px] text-faint" ref={sentinelRef}>
                Loading more…
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  )
}
