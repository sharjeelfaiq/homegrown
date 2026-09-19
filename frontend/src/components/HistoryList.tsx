import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'framer-motion'
import {
  ApiError,
  cancelQueuedJob,
  deleteQueueJob,
  reorderQueue,
  retryQueueJob,
  zipHistory,
  downloadUrl,
  mediaUrl,
  type HistoryEntry,
  type QueueEntry,
} from '../api'
import { downloadName, formatClock, formatTimeOfDay, formatTimestampFull, timeAgo } from '../format'
import { useGenerationActivity } from '../GenerationActivityContext'
import { useOptimisticProgress } from '../hooks/useOptimisticProgress'
import { toast } from 'sonner'
import { useFlushOnHide } from '../hooks/useFlushOnHide'
import { usePersistedDraft } from '../hooks/usePersistedDraft'
import { usePersistedRecord } from '../hooks/usePersistedRecord'
import { UNDO_MS } from '../constants'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import InlineName from './InlineName'
import UndoCountdown from './UndoCountdown'
import VoiceoverPlayer from './VoiceoverPlayer'
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CrossIcon, DownloadIcon, MoreIcon, PlayIcon, StopIcon, TrashIcon, WandIcon } from './Icons'
import { MOD_ARIA, MOD_KEY } from '../keys'
import Kbd from './Kbd'
import VoiceoverFilters, { type VoiceoverFilterState } from './VoiceoverFilters'
import Dock, { type DockItemData } from './Dock'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, readHistoryPageSize, writeHistoryPageSize, type HistoryPageSize } from '../historyPageSize'

/** How many numbered buttons the pager shows, whatever page you are on.
 *
 * This is the whole reason the pager is hand-rolled rather than react-paginate.
 * That component sizes its own output from `pageRangeDisplayed` and
 * `marginPagesDisplayed`, and the number of buttons it emits CHANGES WITH THE
 * SELECTED PAGE: with six pages it rendered `< 1 2 3 … 6 >` on page 1 and
 * `< 1 2 3 4 5 6 >` on page 2, so clicking a page number reshaped the control
 * that was just clicked. No combination of its two props fixes that -- the
 * break only appears when there is a gap to collapse, so the count is a
 * function of the selection by construction.
 *
 * A sliding window of a fixed size has no such state: the count is
 * `min(PAGE_WINDOW, pageCount)` at every selection, so the row is the same
 * shape on every page. It also drops the ellipsis, which was only ever a
 * symptom of the variable window. */
const PAGE_WINDOW = 5

/** The window's page indices, clamped so it never runs past either end. */
function pageWindow(page: number, pageCount: number): number[] {
  const size = Math.min(PAGE_WINDOW, Math.max(1, pageCount))
  const start = Math.max(0, Math.min(page - Math.floor(size / 2), pageCount - size))
  return Array.from({ length: size }, (_, i) => start + i)
}

interface Props {
  history: HistoryEntry[]
  presets: import('../api').Preset[]
  filters: VoiceoverFilterState
  onFiltersChange: (filters: VoiceoverFilterState) => void
  total: number
  /** Focused (and selected) by the Ctrl/Cmd+F shortcut, which is bound in
   *  StudioShell -- the same arrangement as the script box and "/". */
  searchRef?: RefObject<HTMLInputElement | null>
  /** Voiceovers that finished while the user was scrolled away from the top. */
  pendingNew: number
  onShowNew: () => void
  /** Fires when the list scrolls to or away from its top, so the caller can
   * decide whether a finished voiceover may be inserted under the user's eyes
   * or has to be announced instead. */
  onAtTopChange: (atTop: boolean) => void
  onDelete: (id: string, opts?: { unloading?: boolean }) => void
  onRequeue: (entry: HistoryEntry) => void
  /** Fetches and restores a pending job's full script on demand. */
  onReusePendingScript: (jobId: string) => void
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

/** Search terms stay intentionally short: unlike scripts, this is a quick
 * client-side filter that is persisted and restored with the workspace. */
const MAX_SEARCH_CHARS = 100

/* The two-column layout, and with it the fixed-height scrolling Voiceovers
 * block. Mirrors the `@media (min-width: 1025px)` / `(max-width: 1024px)` pair
 * in index.css -- above it the list scrolls, below it the page does, and the two
 * effects below have to pick their scroll root accordingly. Change all three
 * together; nothing enforces it. */

const TWO_COLUMN_QUERY = '(min-width: 1025px)'

/** 80, matching the backend's own `text_preview` cut (main.py: `text[:80]`).
 *
 * It used to be 96, which meant the SAME voiceover showed two different
 * previews either side of finishing: while running the row rendered the
 * backend's already-shortened 80 chars ending in three ASCII dots -- a 96-char
 * cut can never fire on an 83-char string -- and the moment it landed the row
 * re-rendered from the full text at 96 chars ending in a real ellipsis. The
 * preview visibly grew and changed punctuation at the completion boundary.
 *
 * Reconciled on the CLIENT rather than by raising the backend's cut: that 80
 * exists to keep /api/queue small at a 1s poll cadence, and every entry
 * carries one. */
const PREVIEW_CHARS = 80


function truncate(text: string, max = PREVIEW_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** The backend ends its cut with "...", this file with "…". Normalise to one.
 *
 *  The trailing "..." is also the only signal that anything was cut, so it is
 *  swapped rather than stripped: strip it and the remainder is exactly
 *  PREVIEW_CHARS, `truncate` does not re-fire (it needs `>`, not `>=`), and a
 *  shortened preview would render with no terminator at all while the finished
 *  row showed one. */
function previewOf(backendPreview: string): string {
  if (backendPreview.endsWith('...')) return `${backendPreview.slice(0, -3)}…`
  return truncate(backendPreview)
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
        className="result-name voiceover-name"
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
 * Download is absent because there is nothing to download yet, and Reuse is
 * present but DISABLED for the same reason -- the script preview's control only
 * becomes live once the row is a voiceover. The fetch behind it (the complete
 * text, pulled on demand rather than on every one-second queue poll) is
 * therefore currently unreachable; see onReuseScript below. */
function PendingRow({
  job,
  nameControl,
  onCancel,
  cancelPending = false,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
  reordering = false,
  onRetry,
  onReuseScript,
}: {
  job: QueueEntry
  nameControl: NameControl
  onCancel: () => void
  /** True while the Undo toast still allows this cancellation to be reversed. */
  cancelPending?: boolean
  canMoveUp?: boolean
  canMoveDown?: boolean
  onMoveUp?: () => void
  onMoveDown?: () => void
  reordering?: boolean
  /** Only meaningful on a failed row; undefined elsewhere. */
  onRetry?: () => void
  /** Present for running, canceling, and queued jobs; failed jobs omit it. */
  onReuseScript?: () => void
}) {
  const running = job.status === 'running'
  const canceling = job.status === 'canceling'
  // A running render cannot be paused and resumed, so ask before stopping it.
  // The tick does not stop the GPU on the spot, though: it starts the same
  // UNDO_MS hold a queued cancellation gets (see holdCancel). Nothing is
  // paused during that window -- the job carries on generating exactly as it
  // was -- so an Undo needs no state restored, and the row stays amber and
  // ticking until the hold commits.
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  // useOptimisticProgress is self-bounding: it never crosses the next chunk
  // boundary, so with a dead backend it stalls within one chunk instead of
  // running away. That is why it needs no liveness flag. The elapsed clock DID
  // need one -- its advance was local and unbounded, so a dead backend counted
  // up forever -- and that whole apparatus (useElapsed, the `reachable` read
  // here) went with the clock.
  // `canceling` is passed in too, or the hook resets to 0 the moment the
  // status flips and the bar -- which is supposed to FREEZE where it is --
  // animates back to the left edge instead. useOptimisticProgress already
  // stops advancing on `canceling` (it clamps to chunks_done/total_chunks), so
  // handing it the job is what holds the width at the last committed chunk.
  const progress = useOptimisticProgress(running || canceling ? job : undefined)
  const reduced = usePrefersReducedMotion()

  const total = job.total_chunks || 0
  const done = job.chunks_done || 0
  const showTicks = total > 1 && total <= MAX_TICKS
  const chunkLabel = total > 0 ? `chunk ${Math.min(done + 1, total)} of ${total}` : 'Generating'

  // Queued is the only state that gets its own colour. `canceling` deliberately
  // does not: the job is still running until the current chunk ends, so
  // painting it as "not started" would be a lie. The row no longer says
  // "Cancelling…" either -- the disabled Cancel button carries that.
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
  // Why this row will leave, decided while it is still mounted -- framer reads
  // the LAST rendered props on unmount, and `canceled` never appears in
  // /api/queue, so there is no render in which the row knows it has already
  // gone. `canceling` covers the running path (the backend reports it until the
  // current chunk ends); `cancelPending` covers the queued path, whose request
  // is held behind the Undo toast and fires only when that window closes.
  //
  // cancelPending drives the COLOUR as well, and this note used to say the
  // opposite -- that a row turning red mid-countdown would claim a cancellation
  // that had not happened. The call went the other way: the red is feedback
  // that the tick registered, and the Undo toast counting down beside it is
  // what says the decision is still reversible. A row that stayed amber for
  // seven seconds after the tick read as a click that did nothing.
  //
  // It is qualified by `queued`, and that qualification is load-bearing now
  // that a RUNNING cancel is held too. A queued job leaves the queue the
  // instant its cancel commits, still reporting `queued`, so nothing but this
  // flag can identify it. A running job cannot be read that way: it leaves the
  // queue for two different reasons -- it was cancelled, or it simply FINISHED
  // inside the seven seconds -- and the last render looks identical either way.
  // So the running path relies on `canceling` instead, which the backend
  // reports once the request has actually been sent. A job that completes
  // mid-hold therefore keeps the completion fade, which is what covers the
  // handoff seam.
  const leavingCancelled = canceling || (cancelPending && queued)
  // False for exactly as long as AnimatePresence is holding this row on screen
  // after React has removed it. Paired with leavingCancelled it is the one bit
  // the content needs: "you are on your way out, and it was a cancellation".
  const present = useIsPresent()
  const sliding = !present && leavingCancelled && !reduced
  // Red from the tick, not from the backend's reply. `canceling` arrives only
  // after the request is sent -- up to UNDO_MS later on a held cancel, and then
  // only at the next chunk boundary -- so keying the colour on it alone left
  // the row unchanged through the entire undo window. Both kinds of row get it:
  // is-canceling is written after is-queued, so a queued row's purple hands
  // over to red for the countdown and back again on Undo.
  const showCanceling = canceling || cancelPending

  return (
    // Enter AND exit, unlike a VoiceoverRow, which only exits. A pending row
    // appears because the user just pressed Generate -- never a paginated
    // append, never the other half of a handoff -- so an entrance here always
    // marks something they did.
    //
    // The exit fade is LOAD-BEARING, and it was removed once on a misreading
    // before being measured properly. A finishing job does not hand off
    // atomically: the queue poll drops it and the /api/history refetch adds it,
    // and those are two independent round trips. Sampled every 100ms across two
    // real generations -- with the fade, the row count went 14 -> 15 -> 14 and
    // never dipped; without it, 15 -> 14 with the finished voiceover in NEITHER
    // list until the refetch landed. So the fade does not create a duplicate, it
    // covers a seam: for ~160ms the outgoing row is fading over its own finished
    // row, which reads as a handoff. An empty slot reads as a lost voiceover.
    //
    // No height collapse, only opacity -- collapsing would move every row below
    // it twice, once shut and once open again, for a row that is being replaced
    // at its own height.
    //
    // A CANCELLED row leaves differently, and the two exits must not be
    // unified. A completing job is a handoff and has to be covered; a cancelled
    // one is not replaced by anything, so the same quiet fade reads as the row
    // having been dropped rather than stopped. It slides out to the right
    // instead -- the one exit in this column that says "removed" rather than
    // "became something else".
    //
    // The slide is on the row's CONTENT, not on the <li>, and the <li> carries
    // overflow-hidden to clip it. Translating the <li> itself would have had to
    // be clipped by .result-list, whose overflow-y is `auto` above the
    // breakpoint and deliberately `visible` below it -- an overflow-x there
    // would either add a horizontal scrollbar or turn the mobile list back into
    // the nested scroll region its own comment forbids.
    //
    // The content learns it is leaving through useIsPresent, NOT through a
    // framer variant label, and that is a correction rather than a preference.
    // The label version (parent `exit="slide"`, child `variants={{slide}}`) was
    // built first and measured: the child applied translateX(100%) as a static
    // jump, the <li>'s own opacity never left 1, and because the parent's exit
    // animation therefore never completed, AnimatePresence kept the row mounted
    // FOREVER -- 259 consecutive samples of a row that had already left the
    // queue, translated off its own edge and still in the DOM. Plain objects on
    // both elements have no such coupling: the <li>'s opacity drives the
    // presence completion, the content's x is an ordinary `animate`.
    <motion.li
      initial={reduced ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={
        reduced
          ? undefined
          : { opacity: 0, transition: { duration: leavingCancelled ? 0.22 : 0.16 } }
      }
      transition={{ duration: reduced ? 0 : 0.16, ease: [0.2, 0, 0, 1] }}
      className={[
        // No px-2, and its absence is load-bearing: VoiceoverRow has none
        // either, and .result-list already supplies 8px of side padding. The
        // extra padding here inset this row 8px on BOTH sides, which is exactly
        // how far the progress track sat inside a finished row's waveform --
        // measured in the real app at dL +8.0 / dR -8.1 while a synthetic
        // harness (which gave both rows px-2) reported 0.0 and hid it.
        'group/row flex overflow-hidden border-b border-hairline py-[7px] last:border-b-0',
        queued && 'is-queued',
        failed && 'is-failed',
        // Written after is-queued and is-running in index.css, so it wins the
        // tint, the bar fill and the .result-time colour off source order for
        // as long as it applies -- and stops applying, restoring amber or
        // purple, the moment an Undo clears cancelPending.
        showCanceling && 'is-canceling',
        // is-over used to sit beside this, tinting the clock once elapsed
        // passed the estimate. Both it and the estimate are gone: a prediction
        // that was beaten by 12 of 12 measured jobs is not worth showing, and
        // "over" is undefined without one.
        running && 'is-running',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <motion.div
        className="flex min-w-0 flex-1 flex-col gap-0.5"
        animate={{ x: sliding ? '100%' : 0 }}
        transition={{ duration: reduced || !sliding ? 0 : 0.22, ease: [0.2, 0, 0, 1] }}
      >
      <RowHead {...nameControl} voiceName={job.preset_name} nameTitle="Click to rename" />

      {/* Bar left, Cancel right -- the same geometry as transport-then-actions,
          so the two row kinds line up down the column. */}
      <div className="flex min-h-7 min-w-0 items-center gap-2.5">
        {/* Queued is the only state that still spells itself out, because it is
            the only one with nothing else to say: no bar, no moving clock.
            "Generating" and "Cancelling" are gone -- an amber bar that is
            filling, beside a pulsing dot and a ticking clock, already says the
            GPU is working, and the word was the one thing on this line whose
            width changed as the state did. "Failed" is not repeated here
            either; `.result-time` renders it (with the attempt count). */}
        {queued && (
          <span className="mono flex-none text-[10px] font-medium text-queued">Queued</span>
        )}
        {/* Queued work has no progress to report. Its reorder controls and
            status lead this line instead of an empty bar.

            Everything else gets the bar inside a wrapper that MIRRORS
            VoiceoverPlayer's own box -- same `flex min-w-0 flex-1 items-center
            gap-2`, led by an element carrying the play button's exact classes.
            That is what makes the bar start and end on the same two pixels as a
            finished row's waveform, and it stays true if those classes ever
            change, which a hardcoded 32px spacer would not. The right edge is
            held by `.result-actions`' shared min-width.

            That leading box held nothing but air while the row carried an
            elapsed clock, then briefly held a percentage ring. It now holds the
            REAL control, disabled: the same play button, with the same classes
            and the same glyph, that this row will own the moment it becomes a
            voiceover. A second reading of the percentage was redundant beside
            the track; an empty box was a hole where a control belongs. Disabled
            says the right thing -- there is nothing to play YET -- and
            `icon-btn:disabled` already dims it, so no new style. */}
        {!queued && <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          className="icon-btn size-6 flex-none border-none bg-transparent text-muted"
          disabled
          aria-label="Not ready to play yet"
          title="Not ready to play yet"
        >
          <PlayIcon size={16} />
        </button>
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
          {/* `result-bar-fill` rather than the bg-progress utility: the fill's
              colour is a property of the ROW's state, and a utility class here
              could not be overridden by `is-canceling` without an !important
              fight. Width holds during `canceling` for the same reason the hook
              is still fed the job -- `running ? progress : 0` sent a cancelled
              bar sliding back to zero, which reads as work undone rather than
              work stopped. */}
          <motion.div
            className="result-bar-fill relative h-full overflow-hidden rounded-sm"
            initial={false}
            animate={{ width: `${running || canceling ? progress : 0}%` }}
            transition={reduced ? { duration: 0 } : { duration: 0.5, ease: [0.2, 0, 0, 1] }}
          >
            {running && !reduced && <span className="absolute inset-0 animate-sheen bg-[linear-gradient(90deg,transparent,var(--sheen),transparent)]" aria-hidden="true" />}
          </motion.div>
        </div>
        </div>}

        {/* No elapsed clock any more -- the ring in the leading box reports
            progress instead, and nothing on a generating row reports time.
            (`generation_s` is still written to every history entry; nothing
            reads it, exactly as with the retired estimates.)

            The span STAYS, and rendering it empty is not an oversight. It is
            14ch of reserved width, and it is the only reason the track beside
            it ends on the same pixel as a finished row's waveform -- the
            alignment measured at dL/dR 0.0px across 340/420/560px columns.
            Remove it and the bar grows 14ch past the waveform on every
            generating row. It still carries the one thing here that is not a
            time: a failed row's `Failed · try 3`. */}
        <span className="mono result-time">
          {/* The pulsing dot that used to live in this span's 1ch sign slot is
              gone with the clock it was aligned against. It existed to separate
              a running row from a queued one while the bar was still at zero;
              the ring does that now, in a box of its own, and two "this is
              working" signals on one line was one too many. */}
          {failed ? (attempt > 1 ? `Failed · try ${attempt}` : 'Failed') : ''}
        </span>

        {queued && (
          <div className="order-first flex flex-none items-center gap-0.5" aria-label="Reorder queued generation">
            <button
              type="button"
              className="icon-btn"
              aria-label="Move queued generation up"
              title="Move up"
              disabled={!canMoveUp || reordering || cancelPending}
              onClick={onMoveUp}
            >
              <ArrowUpIcon size={15} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Move queued generation down"
              title="Move down"
              disabled={!canMoveDown || reordering || cancelPending}
              onClick={onMoveDown}
            >
              <ArrowDownIcon size={15} />
            </button>
          </div>
        )}

        {/* The progress bar normally supplies this flexible space and keeps
            Cancel on the right edge. Queued rows intentionally have no bar,
            so retain only its layout role here. */}
        {queued && <div className="min-w-0 flex-1" aria-hidden="true" />}

        <div className="result-actions flex flex-none items-center gap-0.5">
          {/* Retry first: after a failure that was not the script's fault --
              a GPU fault takes out everything queued behind it -- resubmitting
              is what the user wants, and dismissing throws the script away. */}
          {failed && onRetry && (
            <button type="button" className="ghost-btn h-6 px-2.5 text-[11px]" onClick={onRetry}>
              Retry
            </button>
          )}
          {!failed && confirmingCancel ? (
            <>
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                aria-label="Confirm cancellation"
                title="Cancel generation"
                onClick={() => {
                  setConfirmingCancel(false)
                  onCancel()
                }}
              >
                <CheckIcon size={15} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Keep generation running"
                title="Keep generating"
                onClick={() => setConfirmingCancel(false)}
              >
                <CrossIcon size={15} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ghost-btn ghost-btn-danger h-6 px-2.5 text-[11px]"
              onClick={() => (failed ? onCancel() : setConfirmingCancel(true))}
              disabled={canceling || cancelPending}
            >
              {failed ? 'Dismiss' : 'Cancel'}
            </button>
          )}
        </div>
      </div>

      {/* Script left, submitted-at right -- the same one-left-fact,
          one-right-fact pairing lines 1 and 2 already use, which is what keeps
          this narrow column readable. The preview gives up exactly the
          timestamp's width; it does NOT get a line of its own -- every row in
          this list is one height, and a second line here would break that. */}
      <div className="flex min-w-0 items-center gap-2.5">
        {failed || !onReuseScript ? (
          <p className="result-text m-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-faint" title={failed ? reason : job.text_preview}>
            {failed ? truncate(reason) : previewOf(job.text_preview)}
          </p>
        ) : (
          // Disabled until the job lands. The affordance stays visible --
          // removing it would make the control appear only once, at the moment
          // the row is replaced -- but it does nothing while the voiceover is
          // still being made. Consequence worth stating: `onReusePendingScript`
          // and the `GET /api/queue/{id}/script` endpoint behind it are now
          // unreachable from the UI. Both are left wired, because re-enabling
          // this is deleting one word.
          <button
            type="button"
            className="result-text m-0 flex min-w-0 flex-1 items-center gap-1.5 bg-transparent p-0 text-left text-[12px] text-faint enabled:hover:text-ink disabled:opacity-55"
            title={job.text_preview}
            aria-label={`Reuse the script of ${nameControl.name || nameControl.placeholder || 'this pending voiceover'}`}
            disabled
            onClick={onReuseScript}
          >
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {previewOf(job.text_preview)}
            </span>
            <span className="flex flex-none items-center gap-1 text-[10px] text-muted"><WandIcon size={12} />Reuse</span>
          </button>
        )}
        {/* When it was SENT, not when it will finish -- a queued row has no
            other indication of how long it has been waiting. */}
        <time
          className="result-stamp mono"
          dateTime={new Date(job.submitted_at * 1000).toISOString()}
          title={`Sent to generate ${formatTimestampFull(job.submitted_at)}`}
        >
          {formatTimeOfDay(job.submitted_at)}
        </time>
      </div>
      </motion.div>
    </motion.li>
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
  animateExit,
  menuPlacement = 'up',
}: {
  entry: HistoryEntry
  nameControl: NameControl
  name: string
  downloadHref: string
  onRequeue: () => void
  onDelete: () => void
  selected: boolean
  onToggleSelect: (shiftKey: boolean) => void
  animateExit: boolean
  menuPlacement?: 'up' | 'down'
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const created = timeAgo(entry.created_at)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [menuOpen])

  return (
    // EXIT ONLY -- no initial/animate. The three ways a row appears here are a
    // job completing (which is a handoff from a PendingRow in the same slot, so
    // an entrance reads as a flicker), a load-more append, and the first paint.
    // None of those is an event the user caused at that row, so animating them
    // would be decoration. Leaving is different: it is always a delete, and the
    // collapse both acknowledges it and stops the rows below snapping upward
    // while the 7s undo is still open.
    //
    // Height is the one layout property this pass animates, and it is bounded
    // to a single row at a time. Do NOT reach for framer's `layout` prop to do
    // this instead: up to ~20 WaveRibbon canvases are mounted here and `layout`
    // measures every one of them each frame.
    <motion.li
      layout={false}
      exit={animateExit && !reduced
        ? { opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }
        : undefined}
      transition={{ duration: reduced ? 0 : 0.18, ease: [0.2, 0, 0, 1] }}
      className={`group/row ${selected ? 'is-selected' : ''} flex ${menuOpen ? 'overflow-visible' : 'overflow-hidden'} border-b border-hairline py-[7px] last:border-b-0`}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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

        <div className="result-actions flex flex-none items-center gap-0.5" ref={menuRef}>
          {/* Selection lives in the action strip, rather than reserving a left
              gutter on every row. It is subtly visible at rest, then brightens
              on hover, focus, or selection without moving row content. */}
          <input
            type="checkbox"
            className={`size-3.5 flex-none accent-audio transition-opacity duration-(--fast) ease-(--ease) group-hover/row:opacity-100 group-focus-within/row:opacity-100 ${
              selected ? 'opacity-100' : 'opacity-45'
            }`}
            checked={selected}
            // onChange, not onClick, so keyboard selection works too. A native
            // click carries shiftKey; a keyboard change correctly does not.
            onChange={(e) =>
              onToggleSelect('shiftKey' in e.nativeEvent && (e.nativeEvent as MouseEvent).shiftKey)
            }
            aria-label={`Select ${name}`}
          />
          <div className="row-overflow-action relative flex flex-none opacity-70 transition-opacity duration-(--fast) ease-(--ease) group-hover/row:opacity-100 group-focus-within/row:opacity-100">
            <button type="button" className="icon-btn" aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={menuOpen} title="More actions" onClick={() => setMenuOpen((open) => !open)}>
              <MoreIcon size={15} />
            </button>
          {menuOpen && (
              <div className={`voiceover-actions-menu absolute right-0 z-150 min-w-40 rounded-md border border-control bg-surface-card p-1 shadow-(--shadow-menu) ${menuPlacement === 'down' ? 'top-full mt-1' : 'bottom-full mb-1'}`} role="menu">
                <a href={downloadHref} download className="voiceover-action-item" role="menuitem" onClick={() => { setMenuOpen(false); toast('Download started') }}><DownloadIcon size={14} />Download</a>
                <button type="button" className="voiceover-action-item voiceover-action-danger" role="menuitem" onClick={() => { setMenuOpen(false); onDelete() }}><TrashIcon size={14} />Delete</button>
              </div>
          )}
          </div>
        </div>
      </div>

      {/* The script preview is also the direct route to reusing it. This keeps
          the common follow-up action beside the text it acts on instead of
          burying it under the row's overflow menu. */}
      <div className="flex min-h-7 min-w-0 items-center gap-2.5">
        <button
          type="button"
          className="result-text m-0 flex min-w-0 flex-1 items-center gap-1.5 bg-transparent p-0 text-left text-[12px] text-faint hover:text-ink"
          title={entry.text}
          aria-label={`Reuse the script of ${name}`}
          onClick={onRequeue}
        >
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
            {truncate(entry.text)}
          </span>
          <span className="flex flex-none items-center gap-1 text-[10px] text-muted"><WandIcon size={12} />Reuse</span>
        </button>
        {/* Outside the reuse button so the timestamp remains a separate fact. */}
        <time
          className="result-stamp mono"
          dateTime={new Date(entry.created_at * 1000).toISOString()}
          title={`Generated ${formatTimestampFull(entry.created_at)}`}
        >
          {formatTimeOfDay(entry.created_at)}
        </time>
      </div>
      </div>
    </motion.li>
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
  presets,
  filters,
  onFiltersChange,
  total,
  searchRef,
  pendingNew,
  onShowNew,
  onAtTopChange,
  onDelete,
  onRequeue,
  onReusePendingScript,
  onError,
  gpuFault = false,
  loading = false,
}: Props) {
  const { queue, refresh } = useGenerationActivity()
  // Read by held-cancel timers, which fire from a closure captured several
  // renders earlier -- `queue` there would be whatever it was when the hold
  // started, which is precisely the value that cannot be trusted.
  const queueRef = useRef(queue)
  queueRef.current = queue
  const [entryFileNames, setFileName, removeFileName] = usePersistedRecord('historyFileNames')
  // Names for jobs that have no history entry yet, keyed by job id.
  //
  // PERSISTED, and the comment here used to say the opposite: "the job either
  // lands within the session or it never existed". That premise was wrong. A
  // job outlives the tab -- queue.json is replayed on startup and job_id is
  // stable across a reload -- so renaming an in-progress voiceover and
  // refreshing silently threw the name away, while the job it belonged to
  // carried on generating.
  //
  // usePersistedRecord writes synchronously, so unlike the script draft this
  // needs no flush; the name is durable the moment InlineName commits it.
  const [pendingNames, setPendingName, removePendingName] =
    usePersistedRecord('pendingVoiceoverNames')
  // The edit is held locally rather than written straight through, which is
  // what makes Escape able to revert -- the old rename box committed on every
  // keystroke, so there was nothing to go back to.
  // Enter and Escape both blur the field themselves, and blur is what commits.
  // Without this flag Enter would commit twice, and Escape would commit the
  // very edit it just discarded.

  // Rows awaiting their irreversible server-side delete. A voiceover can be
  // forty minutes of GPU time and the delete rewrites history.json and unlinks
  // both the .wav and the .mp3, so the request is held for UNDO_MS. The row
  // remains visible throughout that Undo window; only a committed delete lets
  // the subsequent history refresh remove it.
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
  const [reordering, setReordering] = useState(false)
  // Anchor for shift-click ranges. An index into `shown`, NOT into `history`:
  // a range drawn across a filtered list has to select what lies between the
  // two rows the user can see.
  const lastClickedIndex = useRef<number | null>(null)

  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(() => new Set())
  const deleteTimers = useRef(new Map<string, number>())

  /** Queued jobs whose cancel is held behind an Undo toast. They remain in
   *  view until the timer commits their cancellation. */
  const [pendingCancels, setPendingCancels] = useState<Set<string>>(() => new Set())
  const cancelTimers = useRef(
    new Map<string, { timer: number; flush: () => void; toastId: string | number }>(),
  )

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

  useEffect(() => {
    setSelected(new Set())
    lastClickedIndex.current = null
    listRef.current?.scrollTo({ top: 0 })
  }, [filters])

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
  // Persisted, so a query survives a reload along with everything else the
  // user typed. Restoring it boots the column into a filtered view, which is
  // safe here and needs no extra affordance: the box renders whenever
  // `searching` is true (so it cannot vanish leaving an uncleadable filter),
  // it is type="search" so it keeps the native clear button, and Escape
  // clears it. A restored query is safe to filter on immediately because the
  // parent fetches the WHOLE server-filtered history before this renders a
  // page -- filtering only ever sees what has been fetched, and there is no
  // longer a half-loaded state for it to miss matches in.
  const [persistedDraft, setPersistedDraft] = usePersistedDraft('voiceoverSearch')
  const [page, setPage] = useState(0)
  // How many completed rows one page shows. Read synchronously from
  // localStorage so the first paint is already the user's size; see
  // historyPageSize.ts for why an unrecognised stored value is discarded.
  const [pageSize, setPageSize] = useState<HistoryPageSize>(readHistoryPageSize)
  // Cap restored drafts too. Keeping the derived value here means an old,
  // overlong localStorage value can neither render nor filter before the
  // persistence effect below replaces it with its bounded equivalent.
  const draft = persistedDraft.slice(0, MAX_SEARCH_CHARS)

  useEffect(() => {
    if (persistedDraft !== draft) setPersistedDraft(draft)
  }, [draft, persistedDraft, setPersistedDraft])

  const setDraft = (next: string) => setPersistedDraft(next.slice(0, MAX_SEARCH_CHARS))
  const reducedMotion = usePrefersReducedMotion()
  const searching = draft.trim() !== ''
  const filtering = searching || filters.status !== 'all' || filters.presetId !== undefined || filters.createdFrom !== undefined || filters.createdTo !== undefined || filters.durationMin !== undefined || filters.durationMax !== undefined

  // Failures are included, and sorted to the bottom. That ordering does not
  // come for free: /api/queue sorts by `queue_position if not None else -1`,
  // and a terminal job has no position -- so a job that failed BEFORE the
  // current one started shares the running job's -1 and can sort above it.
  //
  // `canceled` stays out, and it is the ABSENCE of that status here that the
  // row's slide-out exit is built around: the backend drops a cancelled job
  // from /api/queue outright, so the row never renders in a terminal state --
  // it simply unmounts between two polls. PendingRow therefore decides how it
  // is leaving while it is still mounted (`leavingCancelled`), and framer plays
  // that decision on the way out. Listing `canceled` here instead would leave a
  // dead row on screen that the user has to dismiss, which is the thing the
  // exit animation exists to avoid. (Those entries do sit in the backend's
  // in-memory _jobs unclaimed; dismissing them would mean firing a
  // side-effectful request from a poll loop, which is the worse trade.)
  //
  // A RUNNING SEARCH HIDES THEM. An in-flight job has no finished script to
  // match -- its text_preview is truncated to 80 chars server-side and the
  // filter runs on the backend's full history, which it is not in yet -- so
  // leaving these visible would put rows in a filtered list that the filter
  // never considered, and make the heading's count disagree with what is on
  // screen. Clearing the box brings them straight back.
  const queuedJobIds = queue.filter((job) => job.status === 'queued').map((job) => job.job_id)
  const active =
    filters.status === 'completed'
      ? []
      : queue
          .filter(
            (e) =>
              (filters.status === 'failed'
                ? e.status === 'error'
                : filters.status === 'active'
                  ? e.status === 'running' || e.status === 'queued' || e.status === 'canceling'
                  : e.status === 'running' || e.status === 'queued' || e.status === 'canceling' || e.status === 'error') &&
              (!searching || e.preset_name.toLowerCase().includes(draft.trim().toLowerCase()) || (pendingNames[e.job_id] ?? '').toLowerCase().includes(draft.trim().toLowerCase())),
          )
          .sort((a, b) => Number(a.status === 'error') - Number(b.status === 'error'))

  // Numbered FIRST, filtered second, and the order is load-bearing. The
  // number is derived from a row's position in the whole list (total - i), so
  // numbering the filtered array would renumber every voiceover the moment a
  // search narrowed it -- "Voiceover 26" would become "Voiceover 3" while you
  // typed, and the name you were searching for would stop matching itself.
  const numbered = history.map((entry, i) => {
    const number = entry.history_number ?? total - i
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
  // A held delete remains on screen until its Undo window ends. Besides making
  // the deferred action legible, this preserves numbering and the heading
  // count until the server-side delete has actually been committed.
  const visible = numbered
  const visibleTotal = total

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

  const pageCount = Math.ceil(shown.length / pageSize)
  const pageRows = shown.slice(page * pageSize, page * pageSize + pageSize)
  // Clamped rather than trusted: the window hands back real indices, but a
  // chevron can be pressed on the last render before a delete shortens the
  // list. Scrolling the list to its top is part of the move -- a page change
  // that left the reader halfway down the previous page reads as nothing
  // having happened.
  const goToPage = (next: number) => {
    const target = Math.max(0, Math.min(next, pageCount - 1))
    if (target === page) return
    setPage(target)
    lastClickedIndex.current = null
    listRef.current?.scrollTo({ top: 0 })
    listRef.current?.scrollIntoView({ block: 'start' })
  }
  const shownSignature = useMemo(() => shown.map(({ entry }) => entry.id).join(','), [shown])

  // A changed query/filter/match set must never leave the reader on a now
  // invalid page. Selection itself deliberately survives page changes.
  useEffect(() => {
    setPage(0)
    lastClickedIndex.current = null
  }, [pageSize, draft, filters, shownSignature])

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
    for (const id of claimed) removePendingName(id)
  }, [queue, history, pendingNames, setFileName, removePendingName])

  // Drop names whose job is gone. The in-memory version got this for free --
  // the record died with the tab -- but a persisted one accumulates an entry
  // per job forever otherwise.
  //
  // Gated on having seen a REAL poll, not on the queue being empty: an empty
  // array is what the first render and every idle moment look like, so pruning
  // on that would delete the name a user typed seconds ago on a job that is
  // merely between polls. Same trap useJobToasts documents for its
  // reported-ids set, and the same fix -- wait for evidence, not for silence.
  //
  // The residual hole, stated so it is not later filed as a bug: a job that
  // finishes AND leaves the queue without this client ever seeing it `done`
  // (a backend restart clears the in-memory job table) can no longer be
  // matched to a history entry, so its name is dropped here. That is the same
  // outcome the unpersisted version had, not a regression.
  const seenQueue = useRef(false)
  if (queue.length > 0) seenQueue.current = true
  useEffect(() => {
    if (!seenQueue.current) return
    const live = new Set(queue.map((e) => e.job_id))
    for (const id of Object.keys(pendingNames)) {
      if (!live.has(id)) removePendingName(id)
    }
  }, [queue, pendingNames, removePendingName])

  // Blank clears the override so the name falls back to "Voiceover N" -- and so
  // does the default itself. Focusing a row and tabbing straight out otherwise
  // stores "Voiceover 5" as an explicit name, which pins that number and stops
  // it renumbering when an older voiceover is deleted.
  function commitRename(id: string, pending: boolean, defaultName: string, typed: string) {
    const next = typed === defaultName ? '' : typed
    if (pending) {
      if (next) setPendingName(id, next)
      else removePendingName(id)
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
  function settleDelete(id: string, commit: boolean, unloading = false) {
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
    onDelete(id, unloading ? { unloading: true } : undefined)
  }

  // A held delete must survive the page going away, and the user must be told
  // before it does.
  //
  // Flush: settle every still-pending id on pagehide, with keepalive so the
  // DELETE outlives the document. Before this, reloading inside the 7s window
  // discarded the whole batch and every row came back -- which is how a
  // select-all of 20 rows reappeared intact after a refresh.
  //
  // THIS REVERSES THE OLD "safe direction" BEHAVIOUR, deliberately and at the
  // user's request: leaving the page inside the undo window now COMMITS the
  // delete instead of cancelling it. That is why the warning below exists.
  const pendingRef = useRef<Set<string>>(pendingDeletes)
  pendingRef.current = pendingDeletes
  useFlushOnHide(() => {
    for (const id of pendingRef.current) settleDelete(id, true, true)
    for (const held of [...cancelTimers.current.values()]) held.flush()
  })

  // beforeunload, which this app otherwise refuses to use -- it produces the
  // generic "Leave site?" prompt, its text is browser-controlled and cannot say
  // what is at stake, and registering it disqualifies the page from the
  // bfcache. It is defensible ONLY because it is scoped: the listener exists
  // only while a delete is actually held, which is at most UNDO_MS, and in
  // every other state the app behaves exactly as it did before.
  useEffect(() => {
    if (pendingDeletes.size === 0) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Assigning returnValue is what still triggers the prompt in Chrome;
      // preventDefault alone is the spec'd way and is not yet enough there.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pendingDeletes.size])

  /** Toggle one row, or shift-click to fill the range from the last one.
   *
   * `index` is the row's position in `pageRows` -- what is on screen after the
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
          const row = pageRows[i]
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
  const shownIds = pageRows.map(({ entry }) => entry.id)
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
      // A plain toast has no type and so no icon of its own. ExternalToast
      // takes one per-toast, which is cheaper than a custom toast component.
      icon: <TrashIcon size={15} />,
      action: {
        // The label carries the time left as well as the word, so the user can
        // see how long they have rather than guessing. sonner types `label` as
        // ReactNode, so this needs no wrapper or custom toast component.
        label: (
          <span className="inline-flex items-center gap-1.5">
            Undo
            <UndoCountdown ms={UNDO_MS} />
          </span>
        ),
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
      // A plain toast has no type and so no icon of its own. ExternalToast
      // takes one per-toast, which is cheaper than a custom toast component.
      icon: <TrashIcon size={15} />,
      action: {
        label: (
          <span className="inline-flex items-center gap-1.5">
            Undo
            <UndoCountdown ms={UNDO_MS} />
          </span>
        ),
        onClick: () => settleDelete(id, false),
      },
    })
  }

  /** Hold a cancellation behind an Undo toast for UNDO_MS, then send it.
   *
   *  Both kinds of job come through here, and the running one is the reason the
   *  word "held" is accurate rather than hopeful: deferring the request does
   *  not pause anything. The job keeps generating on the GPU exactly as it was,
   *  so Undo has no state to restore -- it simply never sends. That is a
   *  different thing from pausing a render, which is still impossible and still
   *  the reason there is no pause control.
   *
   *  The cost is real and was accepted deliberately: confirming no longer frees
   *  the GPU immediately. A cancel already lands at the next chunk boundary
   *  (~1s); this adds the undo window on top, so someone cancelling to get a
   *  different script running waits longer. The trade is that the one
   *  irreversible control in this column stops being irreversible. */
  function holdCancel(jobId: string, running: boolean) {
    // The row remains visible during the hold, so guard a second click from
    // creating another timer and toast for the same job.
    if (cancelTimers.current.has(jobId)) return
    setPendingCancels((prev) => new Set(prev).add(jobId))
    const toastId = toast(running ? 'Generation canceled' : 'Queued generation canceled', {
      duration: UNDO_MS,
      icon: <StopIcon size={15} />,
      action: {
        label: (
          <span className="inline-flex items-center gap-1.5">
            Undo
            <UndoCountdown ms={UNDO_MS} />
          </span>
        ),
        onClick: () => void settleCancel(jobId, false),
      },
    })
    cancelTimers.current.set(jobId, {
      timer: window.setTimeout(() => void settleCancel(jobId, true), UNDO_MS),
      flush: () => void settleCancel(jobId, true, true),
      toastId,
    })
  }

  /** Reorders only the caller's queued jobs. The API preserves every other
   * user's slots, so this array must contain every queued id owned by this
   * view, in its intended order. */
  async function moveQueuedJob(jobId: string, direction: -1 | 1) {
    if (reordering) return
    const ids = queue.filter((job) => job.status === 'queued').map((job) => job.job_id)
    const from = ids.indexOf(jobId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= ids.length) return

    const moved = ids[from]
    ids[from] = ids[to]
    ids[to] = moved
    setReordering(true)
    try {
      await reorderQueue(ids)
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'Failed to reorder queued generations')
    } finally {
      setReordering(false)
      refresh()
    }
  }

  /** True while a job can still be cancelled at all. Read from queueRef, so it
   *  answers about the job as it is NOW rather than as it was when the hold
   *  started. */
  function stillCancellable(jobId: string): boolean {
    const live = queueRef.current.find((e) => e.job_id === jobId)
    return (
      live !== undefined &&
      (live.status === 'running' || live.status === 'queued' || live.status === 'canceling')
    )
  }

  // A job can FINISH inside its own undo window -- that is the whole risk of
  // holding a running cancel, and it is not hypothetical on short scripts.
  // Committing then would post a cancel at a job that is already in history and
  // earn a rejection for something the user cannot act on, while the Undo
  // button goes on offering to undo an event that can no longer happen. So the
  // hold is released the moment the job stops being cancellable, as if Undo had
  // been pressed, and its toast is dismissed with it.
  useEffect(() => {
    if (pendingCancels.size === 0) return
    for (const jobId of pendingCancels) {
      if (stillCancellable(jobId)) continue
      const held = cancelTimers.current.get(jobId)
      if (held?.toastId !== undefined) toast.dismiss(held.toastId)
      void settleCancel(jobId, false)
    }
    // settleCancel and stillCancellable are fresh closures every render; the
    // queue and the held set are what this actually watches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCancels, queue])

  /** Settle a held cancel. Idempotent: the timer is the token, so whichever of
   *  the timer, the Undo and the unload flush gets here first wins and the rest
   *  return. */
  async function settleCancel(jobId: string, commit: boolean, unloading = false) {
    const held = cancelTimers.current.get(jobId)
    if (held === undefined) return
    window.clearTimeout(held.timer)
    cancelTimers.current.delete(jobId)
    if (!commit) {
      setPendingCancels((prev) => {
        const next = new Set(prev)
        next.delete(jobId)
        return next
      })
      refresh()
      return
    }
    // Nothing left to cancel -- the job landed, or failed, inside the window.
    // Checked on BOTH paths: an unload flush has no way to report a rejection,
    // so posting one blind is the version of this that fails silently.
    if (!stillCancellable(jobId)) {
      setPendingCancels((prev) => {
        const next = new Set(prev)
        next.delete(jobId)
        return next
      })
      return
    }
    if (unloading) {
      void cancelQueuedJob(jobId, { keepalive: true }).catch(() => {})
      return
    }
    try {
      await cancelQueuedJob(jobId)
    } catch (e) {
      // The job is still running, so put the row back rather than leaving a
      // generation the user cannot see or stop.
      setPendingCancels((prev) => {
        const next = new Set(prev)
        next.delete(jobId)
        return next
      })
      onError(e instanceof ApiError ? e.message : 'Failed to cancel')
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
  // was missing, and it is now the ONLY thing sizing the list: .result-list has
  // no max-height any more, so `flex: 1 1 auto; min-height: 0` both grows it
  // into a tall viewport and shrinks it on a short one. A flex child can only
  // do either against a parent with a constrained height, and this section was
  // height:auto -- so the list took its full (then-capped) height at every
  // viewport and the overflow was CLIPPED by the shell's wide:overflow-hidden
  // rather than scrolling. Measured before this: 716px list at 1100/900/768/700
  // with the root overflowing by 101/233/301px at the last three. Measured now,
  // at 1440 wide: 471 / 539 / 671 / 871 / 1171px of list at viewport heights
  // 700 / 768 / 900 / 1100 / 1400, root overflow 0 at all five.
  return (
    <div className="mb-6 flex flex-col gap-1 wide:mb-0 wide:h-full wide:min-h-0">
      <h2 className="section-rule">
        <span>Voiceovers</span>
        {/* Select-all, in the heading rather than as a new row -- the heading
            already occupies this space, so nothing shifts. It acts on what is
            ON SCREEN: with a search running it selects the matches, and rows
            selected earlier but now filtered out stay selected rather than
            being silently dropped. `indeterminate` is a DOM property with no
            HTML attribute, so it can only be set through a ref. */}
        {pageRows.length > 0 && (
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
        {/* Keep the count aligned with the rows while a delete is held behind
            its Undo toast. Once the timer commits and the server refreshes,
            both update together without renumbering the remaining entries. */}
        {visibleTotal > 0 && <span className="mono order-3 text-[11px]">{visibleTotal}</span>}
      </h2>
      <p className="sr-only" role="status">{filters.status === 'active' || filters.status === 'failed' ? `Showing ${filters.status === 'active' ? 'generating and queued' : 'failed'} live voiceovers.` : `Showing ${total} completed voiceover${total === 1 ? '' : 's'}${filters.status === 'completed' ? '.' : ' with live jobs above.'}`}</p>

      {/* Keep the controls mounted even for an empty history. This is important
          when a persisted filter or search hides every row: the user must
          still have a visible way to clear it and recover the list.

          type="search", not "text": it gets the native clear affordance and
          the right on-screen keyboard, and Escape clears it for free. The
          onKeyDown stops propagation for the same reason InlineName does --
          the app binds "/" globally (useHotkeys), so without it
          typing a search would fire shortcuts. isTyping() already covers
          INPUT, but Escape is NOT gated by it and would clear the composer's
          error banner behind the column. */}
      {(
        <div
          // shrink-0 is the whole reason the height works. .results is a flex
          // column with a CONSTRAINED height above 1025px (wide:h-full), and a
          // flex item's default flex-shrink: 1 treats `height` as a starting
          // size, not a commitment -- so this box was squashed to its content
          // height, measured at ~19px while the class said 40, and three
          // separate increases to the h-* utility changed the emitted CSS and
          // nothing on screen. .result-list is flex: 1 1 auto and takes the
          // space instead.
          className="mb-2 flex shrink-0 gap-2"
        >
          <div className="relative min-w-0 flex-1">
          <input
            ref={searchRef}
            type="search"
            aria-keyshortcuts={`${MOD_ARIA}+F`}
            title={`Search voiceovers (${MOD_KEY}+F)`}
            className={`voiceover-search peer h-10 w-full rounded-sm border border-control bg-surface-raised ${draft === '' ? 'pr-16' : 'pr-3'} pl-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-audio-line coarse:pr-3`}
            placeholder="Search by name or voice…"
            aria-label="Search voiceovers by name or voice"
            value={draft}
            maxLength={MAX_SEARCH_CHARS}
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
          <VoiceoverFilters presets={presets} history={history} value={filters} onChange={onFiltersChange} />
        </div>
      )}
      {filtering && (
        <div className="-mt-1 mb-2 flex shrink-0 items-center gap-2 text-[11px] text-muted" role="status">
          <span>{shown.length + active.length} result{shown.length + active.length === 1 ? '' : 's'}</span>
          <button type="button" className="ghost-btn h-6 px-2 text-[11px]" onClick={() => { setDraft(''); onFiltersChange({ status: 'all' }) }}>
            Clear
          </button>
        </div>
      )}

      {/* The controls intentionally live outside this panel. The list remains
          in the same flex slot, but the glass starts with voiceover content
          rather than tinting the heading, select-all checkbox, or search. */}
      <section className="results flex min-h-0 flex-1 flex-col gap-1">
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
      {/* x: '-50%' rather than the -translate-x-1/2 utility this used to carry.
          framer writes `transform` inline, which wins over the class outright --
          keeping the utility means the bar animates its way off centre by half
          its own width. The centering has to travel with the animation, so it
          is repeated on initial/animate/exit. */}
      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 8, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={reducedMotion ? undefined : { opacity: 0, y: 8, x: '-50%' }}
            transition={{ duration: reducedMotion ? 0 : 0.16, ease: [0.2, 0, 0, 1] }}
            style={{ x: '-50%' }}
            className="fixed bottom-4 left-1/2 z-100"
          >
            <Dock
              aria-label="Actions for selected voiceovers"
              items={[
                {
                  icon: <DownloadIcon size={19} />,
                  label: zipping ? 'Zipping…' : 'Download',
                  disabled: zipping,
                  onClick: handleZipSelected,
                },
                {
                  icon: <TrashIcon size={19} />,
                  label: 'Delete',
                  className: 'dock-item-danger',
                  onClick: handleDeleteSelected,
                },
                {
                  icon: <CheckIcon size={19} />,
                  label: 'Clear selection',
                  onClick: () => setSelected(new Set()),
                },
              ] satisfies DockItemData[]}
            >
              {selectedCount} selected
            </Dock>
          </motion.div>
        )}
      </AnimatePresence>

      {shown.length === 0 && active.length === 0 ? (
        <p className="m-0 max-w-full break-all py-5 text-[13px] text-faint wide:min-h-0 wide:flex-1 wide:overflow-y-auto">
          {loading
            ? // The whole server-filtered history is fetched in one batched
              // pass, so `loading` alone is the honest condition here: while it
              // is true there may well be voiceovers on the server, and telling
              // someone to go and generate their first one would be false.
              'Loading your voiceovers…'
            : searching
              ? // Distinct from the never-generated-anything copy below. Telling
                // someone with 40 voiceovers to "pick a voice and press
                // Generate" because their search missed reads as the app having
                // lost their work.
                `No voiceovers match “${draft.trim()}”.`
              : filters.status === 'active'
                ? 'No generating or queued voiceovers.'
                : filters.status === 'failed'
                  ? 'No failed voiceovers.'
                  : 'No voiceovers yet. Pick a voice, write a script, and press Generate.'}
        </p>
      ) : (
        <>
          <ul className="result-list" ref={listRef}>
            {/* initial={false} is load-bearing on both of these: without it
                every row already on screen animates on mount, so a reload with
                jobs running replays an entrance for work that started minutes
                ago. It suppresses the first commit only -- rows arriving later
                still animate. */}
            <AnimatePresence initial={false}>
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
                const queuedIndex = job.status === 'queued' ? queuedJobIds.indexOf(job.job_id) : -1
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
                    onCancel={() =>
                      failed
                        ? handleDismiss(job.job_id)
                        : holdCancel(job.job_id, job.status === 'running')
                    }
                    cancelPending={pendingCancels.has(job.job_id)}
                    canMoveUp={queuedIndex > 0}
                    canMoveDown={queuedIndex >= 0 && queuedIndex < queuedJobIds.length - 1}
                    onMoveUp={() => void moveQueuedJob(job.job_id, -1)}
                    onMoveDown={() => void moveQueuedJob(job.job_id, 1)}
                    reordering={reordering}
                    onRetry={failed && !gpuFault ? () => handleRetry(job.job_id) : undefined}
                    onReuseScript={!failed ? () => onReusePendingScript(job.job_id) : undefined}
                  />
                )
              })}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {pageRows.map(({ entry, number, name }, i) => {
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
                    // Not while searching. A keystroke can filter out a dozen
                    // rows at once, and a dozen simultaneous height collapses is
                    // the one place in this column that would feel slow -- the
                    // filter has to narrow the list on the keystroke.
                    animateExit={!searching}
                    menuPlacement={i === 0 ? 'down' : 'up'}
                  />
                )
              })}
            </AnimatePresence>

          </ul>
          {/* The footer. Both halves are ALWAYS rendered once there is a
              completed row, and that is the fix for a layout shift rather than
              a preference.

              The page links used to be gated on `pageCount > 1` -- "one page of
              links is a control that cannot do anything" -- which meant picking
              100 per page on a 53-voiceover history unmounted the whole nav.
              Measured before: footer 34.1px with links and 32px without, and
              the label box growing 96.9 -> 244px as the link row shrank, which
              dragged the select across the column. So the nav stays mounted and
              goes INERT instead; `inert` (not just a class) is what stops a
              control that looks disabled still taking a Tab and a click.

              .voiceover-pager is `flex: none` with a FIXED height, so a page of
              any size scrolls inside .result-list rather than moving this row
              or being pushed off a viewport the shell has pinned to 100svh. Its
              8px side padding mirrors .result-list's, which is what puts the
              label's left edge on the same pixel as the rows above it. */}
          {shown.length > 0 && (
          <div className="voiceover-pager">
            {/* A native <select>, not the @utility select used by VoicePicker:
                that one draws its caret with ::after, which a form control does
                not render. color-scheme is per-theme (tokens.css), so the
                browser's own caret and option popup already follow the theme.

                The keydown guard is the same one the search field carries.
                useHotkeys' isTyping() already covers SELECT, so "/" is safe --
                but Escape is NOT gated by it, and without this an Escape aimed
                at closing the native option popup would also clear the
                composer's state behind this column. */}
            {/* Deliberately the smaller half of the footer: this is a setting
                you touch once, next to the page buttons you touch constantly. */}
            <label className="flex items-center gap-1.5 text-[10px] text-faint">
              <span className="mono uppercase tracking-[0.08em]">Per page</span>
              <select
                className="h-7 rounded-sm border border-control bg-surface-raised px-1.5 text-[11px] text-ink outline-none focus:border-audio-line"
                value={pageSize}
                aria-label="Voiceovers per page"
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const next = Number(e.target.value) as HistoryPageSize
                  const size = (PAGE_SIZE_OPTIONS as readonly number[]).includes(next) ? next : DEFAULT_PAGE_SIZE
                  setPageSize(size)
                  writeHistoryPageSize(size)
                  listRef.current?.scrollTo({ top: 0 })
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
            <nav
              aria-label="Voiceover pages"
              // Mounted at every page count. `inert` rather than a class alone:
              // a control that only LOOKS disabled still takes a Tab and a
              // click, and this one is right next to the control that put it
              // in that state.
              className={pageCount > 1 ? undefined : 'is-disabled'}
              aria-disabled={pageCount > 1 ? undefined : true}
              inert={pageCount <= 1}
            >
              {/* Buttons, not links: these go nowhere, and a <button disabled>
                  is removed from the tab order by the platform rather than by
                  a class. The window is a fixed size (see PAGE_WINDOW), so the
                  row holds its shape as the selection moves. */}
              <ul className="voiceover-pager-list">
                <li className="voiceover-pager-prev">
                  <button
                    type="button"
                    aria-label="Previous page"
                    disabled={page === 0}
                    onClick={() => goToPage(page - 1)}
                  >
                    ‹
                  </button>
                </li>
                {pageWindow(page, pageCount).map((index) => (
                  <li key={index} className={['voiceover-pager-page', index === page ? 'is-active' : ''].filter(Boolean).join(' ')}>
                    <button
                      type="button"
                      aria-label={`Page ${index + 1}`}
                      aria-current={index === page ? 'page' : undefined}
                      onClick={() => goToPage(index)}
                    >
                      {index + 1}
                    </button>
                  </li>
                ))}
                <li className="voiceover-pager-next">
                  <button
                    type="button"
                    aria-label="Next page"
                    disabled={page >= pageCount - 1}
                    onClick={() => goToPage(page + 1)}
                  >
                    ›
                  </button>
                </li>
              </ul>
            </nav>
          </div>
          )}
        </>
      )}
      </section>
    </div>
  )
}
