import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { motion } from 'framer-motion'
import {
  ApiError,
  cancelQueuedJob,
  deleteQueueJob,
  retryQueueJob,
  zipHistory,
  downloadUrl,
  mediaUrl,
  type HistoryEntry,
  type QueueEntry,
} from '../api'
import { downloadName, formatClock, timeAgo } from '../format'
import { useGenerationActivity } from '../GenerationActivityContext'
import { useElapsed } from '../hooks/useElapsed'
import { useOptimisticProgress } from '../hooks/useOptimisticProgress'
import { toast } from 'sonner'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard'
import { usePersistedRecord } from '../hooks/usePersistedRecord'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import InlineName from './InlineName'
import VoiceoverPlayer from './VoiceoverPlayer'
import { ChevronIcon, DownloadIcon, TrashIcon, WandIcon } from './Icons'
import { MOD_ARIA, MOD_KEY } from '../keys'
import Kbd from './Kbd'

interface Props {
  history: HistoryEntry[]
  total: number
  /** Focused (and selected) by the Ctrl/Cmd+F shortcut, which is bound in
   *  StudioShell -- the same arrangement as the script box and "/". */
  searchRef?: RefObject<HTMLInputElement | null>
  /** Fires when a search starts or stops. The caller's job is to make sure
   *  the WHOLE history is loaded while one is running -- filtering happens
   *  here, over what has been fetched, so a half-loaded list would silently
   *  hide matches. */
  onSearchActiveChange?: (active: boolean) => void
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
/** How long a deleted voiceover can be brought back. Longer than sonner's
 *  4s default because this one is irreversible once it fires: 4s is enough to
 *  notice a toast, not always enough to read it, decide, and move the mouse. */
const UNDO_MS = 7000

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
  // Armed only for a RUNNING job. Cancelling a queued one costs nothing --
  // no GPU time has been spent on it yet -- so making every cancel two clicks
  // would tax the cheap case to protect the expensive one.
  //
  // A confirm rather than the undo-toast used for deleting a voiceover,
  // because cancel is not undoable in the same sense: the generation stops and
  // the partial audio is discarded, so "undo" could only mean re-queueing from
  // scratch and paying the whole render again.
  const [confirmingCancel, setConfirmingCancel] = useState(false)
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
        {/* NOT aria-live. It was polite-live until the job-completion toast
            existed, which meant a screen reader read a new elapsed time every
            second for the whole render and said nothing when it finished --
            the one event worth announcing was the one thing it did not cover.
            useJobToasts now announces completion through sonner's own live
            region. Visual output here is unchanged. */}
        <span className="mono result-time">
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
          {confirmingCancel ? (
            // Inline two-step, matching the voices dialog. window.confirm
            // blocks the page and looks nothing like the rest of the app.
            <>
              <span className="mono text-[11px] whitespace-nowrap text-muted">Stop it?</span>
              <button
                type="button"
                className="ghost-btn ghost-btn-danger h-6 px-2.5 text-[11px]"
                onClick={() => {
                  setConfirmingCancel(false)
                  onCancel()
                }}
              >
                Stop
              </button>
              <button
                type="button"
                className="ghost-btn h-6 px-2.5 text-[11px]"
                onClick={() => setConfirmingCancel(false)}
              >
                Keep going
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ghost-btn ghost-btn-danger h-6 px-2.5 text-[11px]"
              onClick={() => (running ? setConfirmingCancel(true) : onCancel())}
              disabled={canceling}
            >
              {failed ? 'Dismiss' : 'Cancel'}
            </button>
          )}
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
  selected,
  onToggleSelect,
  expanded,
  onToggleExpand,
  onCopy,
}: {
  entry: HistoryEntry
  nameControl: NameControl
  name: string
  downloadHref: string
  onRequeue: () => void
  onDelete: () => void
  selected: boolean
  onToggleSelect: (shiftKey: boolean) => void
  expanded: boolean
  onToggleExpand: () => void
  onCopy: () => void
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
        {/* Ahead of the transport rather than at the row's edge: it lines up
            with the play buttons down the column, so the checkboxes read as
            one strip instead of a second ragged column. Dimmed until the row
            is hovered or the box is checked, matching .result-actions -- a
            column of eight permanently visible checkboxes was the thing this
            list was pared back to avoid. */}
        <input
          type="checkbox"
          className={`size-3.5 flex-none accent-audio transition-opacity duration-(--fast) ease-(--ease) group-hover/row:opacity-100 group-focus-within/row:opacity-100 ${
            selected ? 'opacity-100' : 'opacity-0'
          }`}
          checked={selected}
          // onChange, not onClick, so the keyboard (space) works. shiftKey is
          // read off the native event: a click-driven change carries it, a
          // keyboard one does not, which is the correct behaviour either way.
          onChange={(e) =>
            onToggleSelect('shiftKey' in e.nativeEvent && (e.nativeEvent as MouseEvent).shiftKey)
          }
          aria-label={`Select ${name}`}
        />
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
          column width before ellipsising.

          A BUTTON, because the whole script was otherwise unreachable. The
          row showed 96 characters and the rest lived only in `title`, which
          the OS truncates and which cannot be scrolled, selected or copied --
          for text that runs to MAX_SCRIPT_CHARS (60,000). The only way to read
          one was the re-queue wand, which replaces whatever is in the compose
          box.

          `title` is dropped with the change: a native tooltip duplicating an
          expander that works properly is just a second, worse copy. */}
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          className="result-text m-0 flex min-w-0 flex-1 items-center gap-1.5 bg-transparent p-0 text-left text-[12px] text-muted hover:text-ink"
          aria-expanded={expanded}
          onClick={onToggleExpand}
        >
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {truncate(entry.text)}
          </span>
          <ChevronIcon size={12} className={expanded ? 'rotate-180' : undefined} />
        </button>
      </div>

      {expanded && (
        // max-h + overflow so a 60,000-character script cannot push every
        // other row out of the window. The list is a max-height scroller, so
        // this makes its CONTENT taller, never the window itself.
        <div className="mt-1 flex flex-col gap-1.5 rounded-sm border border-hairline bg-surface-raised px-2.5 py-2">
          <p className="m-0 max-h-[180px] overflow-y-auto text-[12px]/[1.55] whitespace-pre-wrap text-ink">
            {entry.text}
          </p>
          <button type="button" className="ghost-btn self-end" onClick={onCopy}>
            Copy script
          </button>
        </div>
      )}
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
  searchRef,
  onSearchActiveChange,
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

  // Rows deleted in the UI but NOT yet on the server. A voiceover can be forty
  // minutes of GPU time and the delete is irreversible server-side -- it
  // rewrites history.json and unlinks both the .wav and the .mp3 -- so the
  // click hides the row and the request is held for UNDO_MS.
  //
  // Deferred on the client rather than soft-deleted on the server: a real
  // undo would need a deleted_at flag, a restore route, a purge policy, and a
  // way to un-unlink files already removed, which is a lot of machinery for a
  // single-user local tool.
  //
  // THE FAILURE MODE, stated so it is not later found as a bug: close the tab
  // inside the undo window and the DELETE never fires, so the row comes back
  // on reload. That is the safe direction -- nothing is lost -- but it is a
  // real inconsistency, not an oversight.
  // Selection is keyed by id and is NOT derived from what is on screen.
  // Selecting rows, then typing a search, then acting has to operate on what
  // was selected -- filtering the action down to the visible rows would
  // silently do less than the count says.
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [zipping, setZipping] = useState(false)
  // One row expanded at a time. Several open at once turns an eight-row window
  // into a wall of text with no rows visible.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // Anchor for shift-click ranges. An index into `shown`, NOT into `history`:
  // a range drawn across a filtered list has to select what lies between the
  // two rows the user can see.
  const lastClickedIndex = useRef<number | null>(null)
  const copy = useCopyToClipboard()

  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(() => new Set())
  const deleteTimers = useRef(new Map<string, number>())

  // Timers are cleared, NOT flushed, on unmount. Flushing would turn a
  // navigation into a destructive act the user never confirmed.
  useEffect(() => {
    const timers = deleteTimers.current
    return () => {
      for (const id of timers.values()) window.clearTimeout(id)
      timers.clear()
    }
  }, [])

  const listRef = useRef<HTMLUListElement>(null)
  const sentinelRef = useRef<HTMLLIElement>(null)

  // The search is CLIENT-SIDE and undebounced, so it filters on the keystroke.
  //
  // It has to be. Two of the three things it searches do not exist on the
  // server: a voiceover's display name is a localStorage override
  // (usePersistedRecord/historyFileNames, and CLAUDE.md is explicit the two
  // name stores must not be unified), and the default "Voiceover 27" is not
  // stored anywhere at all -- it is derived from the row's position in the
  // list. No server query can match either.
  //
  // That also removes the reason for a debounce: there is no request to
  // coalesce, so the 250ms wait was pure latency.
  const [draft, setDraft] = useState('')
  const searching = draft.trim() !== ''

  // Filtering only sees what has been fetched, so while a search runs the
  // parent has to finish loading the history. Without this, a query would
  // quietly miss every voiceover past the first page.
  useEffect(() => {
    onSearchActiveChange?.(searching)
  }, [searching, onSearchActiveChange])

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
    searching
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

  // Numbered FIRST, filtered second, and the order is load-bearing. The
  // number is derived from a row's position in the whole list (total - i), so
  // numbering the filtered array would renumber every voiceover the moment a
  // search narrowed it -- "Voiceover 26" would become "Voiceover 3" while you
  // typed, and the name you were searching for would stop matching itself.
  const numbered = history.map((entry, i) => {
    const number = total - i
    return {
      entry,
      number,
      name: entryFileNames[entry.id]?.trim() || `Voiceover ${number}`,
    }
  })

  // Matches the voiceover's NAME and the VOICE that spoke it. Deliberately
  // NOT the script: a script runs to 60,000 characters, so a common word
  // matches nearly everything and the result is a list that has not been
  // narrowed. Names are short, deliberate and the thing people actually
  // remember a voiceover by.
  // Pending deletes are dropped here, with the search, and for the same
  // reason they cannot be dropped earlier: `number` is a row's position in the
  // WHOLE list, so removing rows before numbering would renumber everything
  // beneath a row the user just deleted.
  const visible = numbered.filter(({ entry }) => !pendingDeletes.has(entry.id))

  // A selected row that has since been deleted (here or in another tab) must
  // not keep inflating the count or be sent to the zip endpoint.
  const liveIds = new Set(visible.map(({ entry }) => entry.id))
  const selectedIds = [...selected].filter((id) => liveIds.has(id))
  const selectedCount = selectedIds.length

  const needle = draft.trim().toLowerCase()
  const shown = needle
    ? visible.filter(
        ({ entry, name }) =>
          name.toLowerCase().includes(needle) ||
          (entry.preset_name ?? '').toLowerCase().includes(needle),
      )
    : visible

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
    if (!sentinel || !hasMore || searching) return
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
  }, [hasMore, onLoadMore, history.length, searching])

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

  /** Commit or cancel a held delete. Both paths clear the timer and un-hide
   *  nothing the other has already handled -- `pendingDeletes.delete` is
   *  idempotent and the timer id is dropped either way. */
  function settleDelete(id: string, commit: boolean) {
    const timer = deleteTimers.current.get(id)
    if (timer !== undefined) window.clearTimeout(timer)
    deleteTimers.current.delete(id)
    setPendingDeletes((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    if (!commit) return
    // The localStorage name goes with the row, and only now. Removing it at
    // click time would make an Undo restore the row under its default
    // "Voiceover N" instead of the name the user gave it.
    removeFileName(id)
    onDelete(id)
  }

  /** Toggle one row, or shift-click to fill the range from the last one.
   *
   * `index` is the row's position in `shown` -- what is on screen after the
   * search filter -- so a range drawn across a filtered list selects the span
   * the user actually drew, not whatever sits between those two rows in the
   * unfiltered history. */
  function toggleSelected(id: string, index: number, shiftKey: boolean) {
    const anchor = lastClickedIndex.current
    setSelected((prev) => {
      const next = new Set(prev)
      if (shiftKey && anchor !== null && anchor !== index) {
        // A shift-range ADDS; it never deselects. Range-clearing needs its own
        // gesture or a stray shift-click wipes a carefully built selection.
        const [from, to] = anchor < index ? [anchor, index] : [index, anchor]
        for (let i = from; i <= to; i++) {
          const row = shown[i]
          if (row) next.add(row.entry.id)
        }
        return next
      }
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    lastClickedIndex.current = index
  }

  /** The header checkbox. Acts on what is ON SCREEN, so the box can never
   *  claim to have selected rows a search is hiding. Rows already selected but
   *  filtered out stay selected -- clearing them would silently undo work the
   *  user did before they typed a query. */
  const shownIds = shown.map(({ entry }) => entry.id)
  const shownSelectedCount = shownIds.filter((id) => selected.has(id)).length
  const allShownSelected = shownIds.length > 0 && shownSelectedCount === shownIds.length

  function toggleSelectAllShown() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allShownSelected) for (const id of shownIds) next.delete(id)
      else for (const id of shownIds) next.add(id)
      return next
    })
    lastClickedIndex.current = null
  }

  async function handleCopyScript(text: string) {
    const ok = await copy(text)
    // Never claim a success that did not happen. Over LAN the page is not a
    // secure context, so navigator.clipboard is absent and the execCommand
    // fallback is what runs -- and it can still be refused.
    if (ok) toast.success('Script copied')
    else onError('Could not copy the script. Select the text and copy it manually.')
  }

  async function handleZipSelected() {
    if (selectedCount === 0 || zipping) return
    setZipping(true)
    try {
      // The display names go with the request: they are a localStorage
      // override the server has never seen, so without them every file in the
      // zip would be named after its voice instead.
      const names: Record<string, string> = {}
      for (const { entry, name } of visible) {
        if (selected.has(entry.id)) names[entry.id] = name
      }
      const blob = await zipHistory(selectedIds, names)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'voiceovers.zip'
      a.click()
      // Revoking immediately can cancel the download in some browsers; one
      // frame is enough for the click to have been taken.
      requestAnimationFrame(() => URL.revokeObjectURL(url))
    } catch (e) {
      // Keep the server's own detail, but never show it alone. This endpoint
      // failing with a bare "Method Not Allowed" is the signature of a backend
      // started before /api/history/zip existed -- the path falls through to
      // DELETE /api/history/{entry_id} with "zip" read as an id -- and that
      // message on its own tells the user nothing about what to do.
      onError(
        e instanceof ApiError
          ? `Could not download those voiceovers — ${e.message}. If the backend was started before this feature, restart it.`
          : 'Could not download those voiceovers.',
      )
    } finally {
      setZipping(false)
    }
  }

  function handleDeleteSelected() {
    if (selectedCount === 0) return
    const ids = selectedIds
    setPendingDeletes((prev) => {
      const next = new Set(prev)
      for (const id of ids) next.add(id)
      return next
    })
    setSelected(new Set())
    // ONE timer and ONE toast for the batch, not one per row -- a stack of
    // nine identical toasts is unreadable and each would need its own Undo.
    const timer = window.setTimeout(() => {
      for (const id of ids) settleDelete(id, true)
    }, UNDO_MS)
    for (const id of ids) deleteTimers.current.set(id, timer)
    // Pluralised into a variable rather than interpolated mid-word. This is a
    // toast message and not a class list, but check_orphan_css.py scans for a
    // word glued to an interpolation anywhere in a .tsx -- comments included,
    // which is how an earlier version of THIS comment failed the guard while
    // explaining why it should not.
    const label = ids.length === 1 ? '1 voiceover' : `${ids.length} voiceovers`
    toast(`${label} deleted`, {
      duration: UNDO_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          window.clearTimeout(timer)
          for (const id of ids) settleDelete(id, false)
        },
      },
    })
  }

  function handleDelete(id: string, label: string) {
    setPendingDeletes((prev) => new Set(prev).add(id))
    const timer = window.setTimeout(() => settleDelete(id, true), UNDO_MS)
    deleteTimers.current.set(id, timer)
    toast(`${label} deleted`, {
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => settleDelete(id, false) },
    })
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

  // Two things here, and they are separate.
  //
  // mb-6 wide:mb-0 -- the bottom margin is for the SCROLLING layout only.
  // Below 1025px the page scrolls and this is the last thing above main's
  // pb-[72px]. Above it the page is pinned to one viewport and a bottom
  // margin would just be 24px this column cannot afford; the separation there
  // comes from main's wide:pb-8.
  //
  // wide:h-full wide:min-h-0 -- this is the link the documented min-h-0 chain
  // was missing. .result-list is `flex: 1 1 auto; min-height: 0` so it can
  // shrink below eight rows on a short viewport, but a flex child can only
  // shrink against a parent with a constrained height, and this section was
  // height:auto. So the list took its full max-height at every viewport and
  // the overflow was CLIPPED by the shell's wide:overflow-hidden rather than
  // scrolling. Measured before this: 716px list and 8.00 visible rows at
  // 1100/900/768/700, with the root overflowing by 101/233/301px at the last
  // three.
  return (
    <section className="results mb-6 flex flex-col gap-1 wide:mb-0 wide:h-full wide:min-h-0">
      <h2 className="section-rule">
        <span>Voiceovers</span>
        {/* Select-all, in the heading rather than as a new row -- the heading
            already occupies this space, so nothing shifts. It acts on what is
            ON SCREEN: with a search running it selects the matches, and rows
            selected earlier but now filtered out stay selected rather than
            being silently dropped. `indeterminate` is a DOM property with no
            HTML attribute, so it can only be set through a ref. */}
        {shown.length > 0 && (
          <input
            type="checkbox"
            className="order-2 size-3.5 flex-none accent-audio"
            checked={allShownSelected}
            ref={(el) => {
              if (el) el.indeterminate = shownSelectedCount > 0 && !allShownSelected
            }}
            onChange={toggleSelectAllShown}
            aria-label={allShownSelected ? 'Deselect all shown voiceovers' : 'Select all shown voiceovers'}
            title={allShownSelected ? 'Deselect all' : 'Select all'}
          />
        )}
        {total > 0 && <span className="mono order-3 text-[11px]">{total}</span>}
      </h2>

      {/* Rendered whenever there is anything to search OR a search is already
          running -- the second half matters, or the box vanishes the moment a
          query matches nothing and there is no way to clear it.

          type="search", not "text": it gets the native clear affordance and
          the right on-screen keyboard, and Escape clears it for free. The
          onKeyDown stops propagation for the same reason InlineName does --
          the app binds "/" globally (useHotkeys), so without it
          typing a search would fire shortcuts. isTyping() already covers
          INPUT, but Escape is NOT gated by it and would clear the composer's
          error banner behind the column. */}
      {(total > 0 || searching || history.length > 0) && (
        <div
          // shrink-0 is the whole reason the height works. .results is a flex
          // column with a CONSTRAINED height above 1025px (wide:h-full), and a
          // flex item's default flex-shrink: 1 treats `height` as a starting
          // size, not a commitment -- so this box was squashed to its content
          // height, measured at ~19px while the class said 40, and three
          // separate increases to the h-* utility changed the emitted CSS and
          // nothing on screen. .result-list is flex: 1 1 auto and takes the
          // space instead.
          className="relative mb-2 shrink-0"
        >
          <input
            ref={searchRef}
            type="search"
            aria-keyshortcuts={`${MOD_ARIA}+F`}
            title={`Search voiceovers (${MOD_KEY}+F)`}
            className="peer h-10 w-full rounded-sm border border-control bg-surface-raised pr-16 pl-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-audio-line coarse:pr-3"
            placeholder="Search by name or voice…"
            aria-label="Search voiceovers by name or voice"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setDraft('')
            }}
          />
          {/* The shortcut, inside the thing it opens -- the convention every
              search field with a hotkey uses, and the only placement that is
              read BEFORE the key is pressed rather than after.

              Only while empty AND unfocused, and both halves matter:
                - type="search" grows a native clear ✕ on the right the moment
                  it has a value, in exactly this spot. Rendering on `draft`
                  being empty means the two can never occupy it at once.
                - peer-focus hides it once you are typing, when it has already
                  done its job and is only competing with the caret.

              pr-16 on the field, not just absolute placement: the cap is
              ~42px wide and text scrolling past it would run underneath,
              which is the same mistake the word count and the "/" cap each
              had to be fixed for. */}
          {draft === '' && (
            <Kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 transition-opacity duration-(--fast) ease-(--ease) peer-focus:opacity-0 coarse:hidden">
              {`${MOD_KEY}+F`}
            </Kbd>
          )}
        </div>
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

      {/* OUT OF FLOW, and that is the whole point. This started as a normal
          block above the list, which meant ticking one checkbox inserted a
          ~40px row and pushed every voiceover down -- the exact layout shift
          the rest of this column was rebuilt to remove.

          Reserving the row permanently was the alternative and costs 40px of
          a column that was deliberately pared back, to advertise an action
          that is irrelevant most of the time. Putting the buttons in the
          VOICEOVERS heading does not work either: that line is ~17px and
          ghost-btn is 32px, so the heading grows and the shift comes back
          smaller.

          `fixed`, not `absolute` inside .results: above 1025px the page is
          pinned to one viewport, but BELOW it the page scrolls and an
          absolutely-positioned bar would sit at the bottom of a long list,
          off-screen exactly when a phone user needs it.

          z-100 puts it under the modal backdrop (200) and well under sonner
          (999999999), so a dialog or a toast is never obscured by it. */}
      {selectedCount > 0 && (
        <div
          className="fixed bottom-4 left-1/2 z-100 flex -translate-x-1/2 items-center gap-2 rounded-md border border-control bg-surface-card px-3 py-2 shadow-(--shadow-menu)"
          role="group"
          aria-label="Actions for selected voiceovers"
        >
          <span className="mono text-[11px] whitespace-nowrap text-muted">{selectedCount} selected</span>
          <button type="button" className="ghost-btn" disabled={zipping} onClick={handleZipSelected}>
            {zipping ? 'Zipping…' : 'Download'}
          </button>
          <button
            type="button"
            className="ghost-btn ghost-btn-danger"
            onClick={handleDeleteSelected}
          >
            Delete
          </button>
          <button type="button" className="ghost-btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {shown.length === 0 && active.length === 0 ? (
        <p className="m-0 py-5 text-[13px] text-faint">
          {loading
            ? 'Loading your voiceovers…'
            : searching
              ? // Distinct from the never-generated-anything copy below. Telling
                // someone with 40 voiceovers to "pick a voice and press
                // Generate" because their search missed reads as the app having
                // lost their work.
                `No voiceovers match “${draft.trim()}”.`
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

            {shown.map(({ entry, number, name }, i) => {
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
                  onDelete={() => handleDelete(entry.id, name)}
                  selected={selected.has(entry.id)}
                  onToggleSelect={(shiftKey) => toggleSelected(entry.id, i, shiftKey)}
                  expanded={expandedId === entry.id}
                  onToggleExpand={() => setExpandedId((cur) => (cur === entry.id ? null : entry.id))}
                  onCopy={() => handleCopyScript(entry.text)}
                />
              )
            })}
            {/* The trigger for the next slice, and the only "there is more"
                signal the user gets. Inside the <ul> so it scrolls with the
                rows and so IntersectionObserver can scope to this list. */}
            {hasMore && !searching && (
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
