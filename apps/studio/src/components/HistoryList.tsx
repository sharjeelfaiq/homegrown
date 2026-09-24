import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  verifyAdminPassword,
  type HistoryEntry,
  type QueueEntry,
} from '../api'
import { downloadName, formatClock, formatTimeOfDay, formatTimestampFull, timeAgo } from '../format'
import { useGenerationActivity } from '../GenerationActivityContext'
import { useOptimisticProgress } from '../hooks/useOptimisticProgress'
import { toast } from 'sonner'
import { usePersistedDraft } from '../hooks/usePersistedDraft'
import { usePersistedRecord } from '../hooks/usePersistedRecord'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { UNDO_MS } from '../constants'
import InlineName from './InlineName'
import VoiceoverPlayer from './VoiceoverPlayer'
import FuseButton from './FuseButton'
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CrossIcon, DownloadIcon, MoreIcon, PlayIcon, TrashIcon, WandIcon } from './Icons'
import { MOD_ARIA, MOD_KEY } from '../keys'
import Kbd from './Kbd'
import VoiceoverFilters, { type VoiceoverFilterState } from './VoiceoverFilters'
import AdminPasswordModal from './AdminPasswordModal'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS, readHistoryPageSize, writeHistoryPageSize, type HistoryPageSize } from '../historyPageSize'
import { fetchHistoryPage, historyQueryKey, normalizeHistoryRequest } from '../historyQuery'
import { pageControls } from '../historyPager'
import { Skeleton } from 'boneyard-js/react'
import { VoiceoverHistoryFixture } from './BoneyardFixtures'

interface Props {
  presets: import('../api').Preset[]
  filters: VoiceoverFilterState
  onFiltersChange: (filters: VoiceoverFilterState) => void
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
  onDelete: (id: string, adminPassword: string) => Promise<void>
  onRequeue: (entry: HistoryEntry) => void
  /** Reuses a pending job's full script. The queue poll only carries its
   * preview, so the parent fetches the source on this explicit action. */
  onReuseQueue: (job: QueueEntry) => void
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
}

/** Past this many chunks the boundary ticks fall below ~4px apart and read as
 * noise rather than structure, so they are dropped and the bar stands alone.
 * A voice with a long reference clip chunks at ~80 characters, which turns the
 * 60,000-character limit into ~750 chunks, so this end of the range is real. */
const MAX_TICKS = 60

/** Search terms stay intentionally short: unlike scripts, this is a quick
 * client-side filter that is persisted and restored with the workspace. */
const MAX_SEARCH_CHARS = 100

const PREVIEW_CHARS = 80

function truncate(text: string, max = PREVIEW_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** A single selected row should behave exactly like its row-level Download
 * action. ZIP creation is reserved for an actual batch. */
export function selectedDownloadKind(selectedCount: number): 'mp3' | 'zip' {
  return selectedCount === 1 ? 'mp3' : 'zip'
}

export interface RowSelectionModifiers {
  additive: boolean
  range: boolean
}

/** Standard desktop-list selection: plain click replaces, Ctrl/Cmd toggles,
 * and Shift adds the visible range from its anchor. */
export function selectionAfterRowClick(
  selected: ReadonlySet<string>,
  rowIds: readonly string[],
  index: number,
  anchor: number | null,
  { additive, range }: RowSelectionModifiers,
): Set<string> {
  const id = rowIds[index]
  if (!id) return new Set(selected)
  const resolvedAnchor = anchor ?? rowIds.findIndex((rowId) => selected.has(rowId))
  if (range && resolvedAnchor >= 0 && rowIds[resolvedAnchor]) {
    const next = new Set(selected)
    const [from, to] = resolvedAnchor < index ? [resolvedAnchor, index] : [index, resolvedAnchor]
    for (let i = from; i <= to; i++) next.add(rowIds[i])
    return next
  }
  if (additive) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }
  return new Set([id])
}

/** Apply a contiguous drag range against the selection that existed before the
 * gesture. Recomputing from that base makes Ctrl/Cmd-drag stable while the
 * pointer crosses rows instead of toggling the same row repeatedly. */
export function selectionAfterRowDrag(
  selected: ReadonlySet<string>,
  rowIds: readonly string[],
  start: number,
  end: number,
  mode: 'replace' | 'add' | 'toggle',
): Set<string> {
  const next = mode === 'replace' ? new Set<string>() : new Set(selected)
  const [from, to] = start < end ? [start, end] : [end, start]
  for (let i = from; i <= to; i++) {
    const id = rowIds[i]
    if (!id) continue
    if (mode === 'toggle' && selected.has(id)) next.delete(id)
    else next.add(id)
  }
  return next
}

/* The two-column layout, and with it the fixed-height scrolling Voiceovers
 * block. Mirrors the `@media (min-width: 1025px)` / `(max-width: 1024px)` pair
 * in index.css -- above it the list scrolls, below it the page does, and the two
 * effects below have to pick their scroll root accordingly. Change all three
 * together; nothing enforces it. */

const TWO_COLUMN_QUERY = '(min-width: 1025px)'

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
  timestamp,
  timestampTitle,
  nameTitle,
}: NameControl & { voiceName: string; nameTitle: string; timestamp?: number; timestampTitle?: string }) {
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

      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-3">
        <span className="mono min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-right text-[11px] text-faint" title={`Voice: ${voiceName}`}>
          {voiceName}
        </span>
        {timestamp !== undefined && (
          <time
            className="result-stamp mono"
            dateTime={new Date(timestamp * 1000).toISOString()}
            title={timestampTitle}
          >
            {formatTimeOfDay(timestamp)}
          </time>
        )}
      </div>
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
 * Download is absent because there is nothing to download yet. The complete
 * script remains reusable, though, through the queue's on-demand script route. */
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
  onReuse,
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
  onReuse: () => void
}) {
  const running = job.status === 'running'
  const canceling = job.status === 'canceling'
  // A running render cannot be paused and resumed, so ask before stopping it.
  // Confirmed cancellation is sent immediately; backend work then stops at
  // the next chunk boundary.
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
  // after the request is sent and the backend accepts it. Both kinds of row
  // get it: is-canceling is written after is-queued, so the queued row's purple
  // state hands over to red while cancellation is in progress.
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
        // px-2 -mx-2 is padding that COSTS NOTHING, and the pair is the whole
        // trick. This row is tinted (amber running, purple queued, red
        // cancelling) while VoiceoverRow is not, so its content sits against a
        // coloured edge and reads as cramped -- but padding it inward moves the
        // progress track, and the track is aligned to a finished row's waveform
        // on both edges. That was measured going wrong once: a bare px-2 here
        // put the bar 8px inside the waveform at dL +8.0 / dR -8.1 in the real
        // app, while a synthetic harness (which gave both row kinds px-2)
        // reported 0.0 and hid it for an iteration.
        //
        // The negative margin cancels the padding for layout, so the CONTENT
        // does not move at all -- only the tint, the hairline and the
        // is-canceling stripe grow 8px outward into .result-list's own 12px of
        // side padding. Content stays on the finished row's pixel (dL 0.0 /
        // dR -0.1 re-measured after this), and the band gains its breathing
        // room. Keep the two numbers equal.
        'group/row -mx-2 flex overflow-hidden border-b border-hairline px-2 py-[7px] last:border-b-0',
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
      <RowHead
        {...nameControl}
        voiceName={job.preset_name}
        nameTitle="Click to rename"
      />

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

        {/* This slot keeps the progress track aligned with a finished row's
            waveform. It also gives a running voiceover its elapsed clock;
            queued work deliberately has no elapsed time because it has not
            begun generating yet. */}
        <span className="mono result-time" aria-label={running ? `Generating for ${formatClock(job.elapsed_s)}` : undefined}>
          {running ? formatClock(job.elapsed_s) : failed ? (attempt > 1 ? `Failed · try ${attempt}` : 'Failed') : ''}
        </span>

        {/* The span STAYS at the same reserved width when there is no clock.
            It is
            14ch of reserved width, and it is the only reason the track beside
            it ends on the same pixel as a finished row's waveform -- the
            alignment remains stable across narrow and wide columns. */}

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

      {!failed && (
        <div className="flex min-h-7 min-w-0 items-center gap-3">
          <button
            type="button"
            className="result-text m-0 flex min-w-0 flex-1 items-center gap-1.5 bg-transparent p-0 text-left text-[12px] text-faint hover:text-ink"
            title={job.text_preview}
            aria-label={`Reuse the script queued for ${nameControl.name || nameControl.placeholder || 'this voiceover'}`}
            onClick={onReuse}
          >
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {truncate(job.text_preview)}
            </span>
            <span className="flex flex-none items-center gap-1 text-[10px] text-muted"><WandIcon size={12} />Reuse</span>
          </button>
          <time
            className="result-stamp mono"
            dateTime={new Date(job.submitted_at * 1000).toISOString()}
            title={`Sent to generate ${formatTimestampFull(job.submitted_at)}`}
          >
            {formatTimeOfDay(job.submitted_at)}
          </time>
        </div>
      )}

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
  onDelete,
  onRequeue,
  selected,
  onSelect,
  rowIndex,
  animateExit,
  menuPlacement = 'up',
}: {
  entry: HistoryEntry
  nameControl: NameControl
  name: string
  downloadHref: string
  onDelete: () => void
  onRequeue: () => void
  selected: boolean
  onSelect: (modifiers: RowSelectionModifiers) => void
  rowIndex: number
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

  function isInteractiveTarget(event: ReactMouseEvent | ReactKeyboardEvent) {
    const target = event.target as HTMLElement
    return target.closest('a, button, input, [role="menu"], [role="slider"]') !== null
  }

  function selectFromRow(event: ReactMouseEvent | ReactKeyboardEvent) {
    if (isInteractiveTarget(event)) return
    const nativeEvent = event.nativeEvent
    onSelect({
      additive: 'ctrlKey' in nativeEvent && (nativeEvent.ctrlKey || nativeEvent.metaKey),
      range: 'shiftKey' in nativeEvent && nativeEvent.shiftKey,
    })
  }

  return (
    // EXIT ONLY -- no initial/animate. The three ways a row appears here are a
    // job completing (which is a handoff from a PendingRow in the same slot, so
    // an entrance reads as a flicker), a load-more append, and the first paint.
    // None of those is an event the user caused at that row, so animating them
    // would be decoration. Leaving is different: it is always a confirmed
    // delete, and the collapse acknowledges it as the rows below move up.
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
      className={`group/row ${selected ? 'is-selected' : ''} -mx-2 flex cursor-default ${menuOpen ? 'overflow-visible' : 'overflow-hidden'} border-b border-hairline px-2 py-[7px] last:border-b-0`}
      tabIndex={0}
      aria-label={`Select ${name}`}
      aria-selected={selected}
      data-voiceover-row-index={rowIndex}
      onClick={selectFromRow}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        if (isInteractiveTarget(event)) return
        event.preventDefault()
        selectFromRow(event)
      }}>
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
          <a href={downloadHref} download className="icon-btn" aria-label={`Download ${name}`} title="Download voiceover" onClick={() => toast('Download started')}>
            <DownloadIcon size={14} />
          </a>
          <div className="row-overflow-action relative flex flex-none opacity-70 transition-opacity duration-(--fast) ease-(--ease) group-hover/row:opacity-100 group-focus-within/row:opacity-100">
            <button type="button" className="icon-btn" aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={menuOpen} title="More actions" onClick={() => setMenuOpen((open) => !open)}>
              <MoreIcon size={15} />
            </button>
          {menuOpen && (
              <div className={`voiceover-actions-menu absolute right-0 z-150 min-w-40 rounded-md border border-control bg-surface-card p-1 shadow-(--shadow-menu) ${menuPlacement === 'down' ? 'top-full mt-1' : 'bottom-full mb-1'}`} role="menu">
                <button type="button" className="voiceover-action-item voiceover-action-danger" role="menuitem" onClick={() => { setMenuOpen(false); onDelete() }}><TrashIcon size={14} />Delete</button>
              </div>
          )}
          </div>
        </div>
      </div>

      <div className="flex min-h-7 min-w-0 items-center gap-3">
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
 * Finished rows use a header, transport/actions line, and reusable transcript
 * preview line. The header constrains and truncates its reference facts so the
 * layout stays readable at narrow widths.
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
 * Delete any of them and the thing it hooks stops happening, silently. */
export default function HistoryList({
  presets,
  filters,
  onFiltersChange,
  searchRef,
  pendingNew,
  onShowNew,
  onAtTopChange,
  onDelete,
  onRequeue,
  onReuseQueue,
  onError,
  gpuFault = false,
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

  // Deletion requires the admin password modal before the server removes the
  // history record and audio files.
  //
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

  const [deleteRequest, setDeleteRequest] = useState<{ ids: string[]; label: string } | null>(null)
  const deleteTimers = useRef(new Map<number, string | number>())

  useEffect(() => () => {
    for (const [timer, toastId] of deleteTimers.current) {
      window.clearTimeout(timer)
      toast.dismiss(toastId)
    }
    deleteTimers.current.clear()
  }, [])

  /** Jobs with an in-flight cancellation request. */
  const [pendingCancels, setPendingCancels] = useState<Set<string>>(() => new Set())

  const listRef = useRef<HTMLUListElement>(null)
  const selectionScopeRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{
    start: number
    pointerId: number
    startX: number
    startY: number
    mode: 'replace' | 'add' | 'toggle'
    base: Set<string>
    active: boolean
  } | null>(null)
  const suppressNextClick = useRef(false)

  // Row selection belongs to this panel. A click in the composer, elsewhere on
  // the page, or another panel is the conventional desktop-list deselect.
  useEffect(() => {
    if (selected.size === 0) return
    const clearWhenLeavingPanel = (event: PointerEvent) => {
      if (selectionScopeRef.current?.contains(event.target as Node)) return
      setSelected(new Set())
      lastClickedIndex.current = null
    }
    document.addEventListener('pointerdown', clearWhenLeavingPanel)
    return () => document.removeEventListener('pointerdown', clearWhenLeavingPanel)
  }, [selected])

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
  const searching = draft.trim() !== ''
  const filtersApplied = filters.status !== 'all' || filters.presetId !== undefined || filters.createdFrom !== undefined || filters.createdTo !== undefined || filters.durationMin !== undefined || filters.durationMax !== undefined
  const showingHistory = filters.status === 'all' || filters.status === 'completed'

  // Completed rows are a single bounded server page. Canonical voice-name
  // search happens on the backend; browser-only display names can only narrow
  // pages that this browser has already loaded.
  const request = useMemo(() => normalizeHistoryRequest({
    presetId: filters.presetId, createdFrom: filters.createdFrom, createdTo: filters.createdTo,
    durationMin: filters.durationMin, durationMax: filters.durationMax,
    query: draft, limit: pageSize, offset: page * pageSize,
  }), [filters, draft, page, pageSize])
  const queryClient = useQueryClient()
  const historyQuery = useQuery({
    queryKey: historyQueryKey(request), queryFn: () => fetchHistoryPage(request),
    // Automated history work is disabled while offline; cached data remains
    // visible until the next online query succeeds.
    enabled: showingHistory && navigator.onLine,
    networkMode: 'always',
    placeholderData: (previous) => previous,
  })
  const history = showingHistory ? historyQuery.data?.history ?? [] : []
  const total = showingHistory ? historyQuery.data?.total ?? 0 : 0
  const loading = historyQuery.isLoading && !historyQuery.data
  useEffect(() => {
    if (!historyQuery.data || history.length >= total || !navigator.onLine) return
    const next = normalizeHistoryRequest({ ...request, offset: request.offset + request.limit })
    void queryClient.prefetchQuery({ queryKey: historyQueryKey(next), queryFn: () => fetchHistoryPage(next) })
  }, [historyQuery.data, history.length, queryClient, request, total])

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
    // Unfiltered API pages omit history_number to keep their payload stable;
    // their display position still has to include this server page's offset.
    // Without it every page was labelled like page one even when its entries
    // were different.
    const number = entry.history_number ?? total - request.offset - i
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

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  // `shown` is already the active server page. A local display-name match can
  // narrow it, but must never trigger an unbounded client scan.
  const pageRows = shown
  // Clamped rather than trusted: the pager hands back real indices, but a
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
  // Filters, the server search, and page size reset pagination. Do not depend
  // on the returned row ids here: a server-page transition necessarily changes
  // those ids, and that would immediately snap every navigation back to page 1.
  useEffect(() => {
    setPage(0)
    lastClickedIndex.current = null
  }, [pageSize, draft, filters])

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


  /** Select one row, Ctrl/Cmd-toggle it, or Shift-click to add the range.
   *
   * `index` is the row's position in `pageRows` -- what is on screen after the
   * search filter -- so a range drawn across a filtered list selects the span
   * the user actually drew, not whatever sits between those two rows in the
   * unfiltered history. */
  function selectRow(index: number, modifiers: RowSelectionModifiers) {
    if (suppressNextClick.current) {
      suppressNextClick.current = false
      return
    }
    const ids = pageRows.map(({ entry }) => entry.id)
    setSelected((prev) => {
      const fallbackAnchor = lastClickedIndex.current ?? ids.findIndex((id) => prev.has(id))
      return selectionAfterRowClick(prev, ids, index, fallbackAnchor < 0 ? null : fallbackAnchor, modifiers)
    })
    lastClickedIndex.current = null
    if (!modifiers.range) lastClickedIndex.current = index
  }

  function beginRowDrag(event: ReactPointerEvent<HTMLUListElement>) {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('a, button, input, [role="menu"], [role="slider"]')) return
    const row = target.closest<HTMLElement>('[data-voiceover-row-index]')
    if (!row || !listRef.current?.contains(row)) return
    const start = Number(row.dataset.voiceoverRowIndex)
    if (!Number.isInteger(start)) return
    dragRef.current = {
      start,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      mode: event.shiftKey ? 'add' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace',
      base: new Set(selected),
      active: false,
    }
  }

  useEffect(() => {
    const rowAtPoint = (x: number, y: number) => {
      const target = document.elementFromPoint(x, y)
      const row = target?.closest<HTMLElement>('[data-voiceover-row-index]')
      if (!row || !listRef.current?.contains(row)) return null
      const index = Number(row.dataset.voiceoverRowIndex)
      return Number.isInteger(index) ? index : null
    }
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY)
      if (!drag.active && distance < 5) return
      const index = rowAtPoint(event.clientX, event.clientY)
      if (index === null) return
      // Let a normal click (including a slightly shaky Shift-click) reach the
      // row's click handler. Drag selection only starts once the pointer has
      // crossed into another voiceover row.
      if (!drag.active && index === drag.start) return
      drag.active = true
      event.preventDefault()
      document.body.style.userSelect = 'none'
      const ids = pageRows.map(({ entry }) => entry.id)
      setSelected(selectionAfterRowDrag(drag.base, ids, drag.start, index, drag.mode))
    }
    const finish = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || event.pointerId !== drag.pointerId) return
      if (drag.active) {
        const index = rowAtPoint(event.clientX, event.clientY)
        lastClickedIndex.current = index ?? drag.start
        // A click is only synthesized when the pointer ends over the list;
        // avoid leaving a stale suppression flag when a drag ends elsewhere.
        suppressNextClick.current = index !== null
        document.body.style.userSelect = ''
      }
      dragRef.current = null
    }
    document.addEventListener('pointermove', onMove, { passive: false })
    document.addEventListener('pointerup', finish)
    document.addEventListener('pointercancel', finish)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', finish)
      document.removeEventListener('pointercancel', finish)
      document.body.style.userSelect = ''
    }
  }, [pageRows])

  async function handleDownloadSelected() {
    if (selectedCount === 0 || zipping) return
    if (selectedDownloadKind(selectedCount) === 'mp3') {
      const selectedId = selectedIds[0]
      const item = visible.find(({ entry }) => entry.id === selectedId)
      if (!item) return
      const a = document.createElement('a')
      a.href = downloadUrl(item.entry.audio_url, downloadName(item.name, item.entry.created_at))
      a.setAttribute('download', '')
      a.click()
      toast('Download started')
      return
    }
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
    const ids = [...selectedIds]
    const label = ids.length === 1 ? '1 voiceover' : `${ids.length} voiceovers`
    setDeleteRequest({ ids, label })
  }

  function handleDelete(id: string, label: string) {
    setDeleteRequest({ ids: [id], label })
  }

  async function confirmDelete(adminPassword: string) {
    if (!deleteRequest) return
    try {
      await verifyAdminPassword(adminPassword)
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'Admin password could not be verified')
      throw e
    }

    const { ids, label } = deleteRequest
    const timer = window.setTimeout(() => {
      const toastId = deleteTimers.current.get(timer)
      deleteTimers.current.delete(timer)
      if (toastId !== undefined) toast.dismiss(toastId)
      void (async () => {
        for (const id of ids) {
          try {
            await onDelete(id, adminPassword)
            removeFileName(id)
            setSelected((prev) => {
              const next = new Set(prev)
              next.delete(id)
              return next
            })
          } catch (e) {
            onError(e instanceof ApiError ? e.message : `Failed to delete ${label}`)
          }
        }
      })()
    }, UNDO_MS)
    let toastId: string | number
    const undo = () => {
      window.clearTimeout(timer)
      deleteTimers.current.delete(timer)
      toast.dismiss(toastId)
    }
    toastId = toast.custom(() => (
      <div className="undo-toast" role="status">
        <TrashIcon size={15} />
        <span>{label} deleted</span>
        <FuseButton ms={UNDO_MS} onUndo={undo} />
      </div>
    ), { duration: UNDO_MS })
    deleteTimers.current.set(timer, toastId)
  }

  async function handleCancel(jobId: string) {
    if (pendingCancels.has(jobId)) return
    setPendingCancels((prev) => new Set(prev).add(jobId))
    try {
      if (stillCancellable(jobId)) await cancelQueuedJob(jobId)
    } catch (e) {
      onError(e instanceof ApiError ? e.message : 'Failed to cancel')
    } finally {
      setPendingCancels((prev) => {
        const next = new Set(prev)
        next.delete(jobId)
        return next
      })
      refresh()
    }
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
      <p className="sr-only" role="status">{filters.status === 'active' || filters.status === 'failed' ? `Showing ${filters.status === 'active' ? 'generating and queued' : 'failed'} live voiceovers.` : `Showing ${total} completed voiceover${total === 1 ? '' : 's'}${filters.status === 'completed' ? '.' : ' with live jobs above.'}`}</p>
      {historyQuery.isError && historyQuery.data && (
        <p className="m-0 text-[11px] text-muted" role="status">Showing saved voiceovers; the latest refresh failed.</p>
      )}

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
      <section ref={selectionScopeRef} className="results flex min-h-0 flex-1 flex-col">
        <div className="voiceovers-card-header shrink-0">
          {/* Keep the controls mounted even for an empty history. This is important
              when a persisted filter or search hides every row: the user must
              still have a visible way to clear it and recover the list.

              type=\"search\", not \"text\": it gets the native clear affordance and
              the right on-screen keyboard, and Escape clears it for free. */}
          <div
          // shrink-0 is the whole reason the height works. .results is a flex
          // column with a CONSTRAINED height above 1025px (wide:h-full), and a
          // flex item's default flex-shrink: 1 treats `height` as a starting
          // size, not a commitment -- so this box was squashed to its content
          // height, measured at ~19px while the class said 40, and three
          // separate increases to the h-* utility changed the emitted CSS and
          // nothing on screen. .result-list is flex: 1 1 auto and takes the
          // space instead.
          className="mt-2 flex gap-2"
          data-tour="voiceover-search-filters"
        >
          <div className="relative min-w-0 flex-1">
          <input
            ref={searchRef}
            type="search"
            aria-keyshortcuts={`${MOD_ARIA}+F`}
            title={`Search voiceovers (${MOD_KEY}+F)`}
            className={`voiceover-search peer h-10 w-full rounded-sm border border-control bg-surface-raised ${draft === '' ? 'pr-16' : 'pr-3'} pl-3 text-[13px] text-ink outline-none placeholder:text-faint focus:border-audio-line coarse:pr-3`}
            placeholder="Search by the name of voiceover or voice..."
            aria-label="Search by the name of voiceover or voice"
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
        </div>
      {/* Always reserve this neutral action band so selection never moves rows. */}
      <div className="history-context-toolbar flex shrink-0 items-center gap-2 overflow-x-auto text-[11px] text-muted" role={selectedCount > 0 ? 'toolbar' : undefined} aria-label={selectedCount > 0 ? 'Actions for selected voiceovers' : undefined}>
        {selectedCount > 0 && (
          <>
            <span className="shrink-0" role="status">{selectedCount} selected</span>
            <button type="button" className="icon-btn shrink-0" disabled={zipping} onClick={handleDownloadSelected} aria-label={zipping ? 'Preparing download' : 'Download selected voiceovers'} title={zipping ? 'Preparing download' : 'Download selected voiceovers'}><DownloadIcon size={15} /></button>
            <button type="button" className="icon-btn icon-btn-danger shrink-0" onClick={handleDeleteSelected} aria-label="Delete selected voiceovers" title="Delete selected voiceovers"><TrashIcon size={15} /></button>
          </>
        )}
        {selectedCount === 0 && (
          <span className="shrink-0" role="status" aria-label={`${visibleTotal} voiceovers`}>All voiceovers · {visibleTotal}</span>
        )}
        {filtersApplied && (
          <button
            type="button"
            className="ghost-btn ml-auto h-7 shrink-0 px-2 text-[11px]"
            onClick={() => onFiltersChange({ status: 'all' })}
            aria-label="Clear voiceover filters"
          >
            Clear filters
          </button>
        )}
      </div>
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

      {shown.length === 0 && active.length === 0 ? (
        loading ? (
          <Skeleton
            name="voiceover-history"
            loading
            fixture={<VoiceoverHistoryFixture />}
            select="viewport"
            className="wide:min-h-0 wide:flex-1"
            snapshotConfig={{ excludeTags: ['svg', 'canvas'], excludeSelectors: ['[data-boneyard-decorative]'] }}
          >
            <VoiceoverHistoryFixture />
          </Skeleton>
        ) : (
          <p className="m-0 max-w-full break-all py-5 text-[13px] text-faint wide:min-h-0 wide:flex-1 wide:overflow-y-auto">
            {searching
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
        )
      ) : (
        <>
          <ul className="result-list" ref={listRef} onPointerDown={beginRowDrag}>
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
                        : handleCancel(job.job_id)
                    }
                    cancelPending={pendingCancels.has(job.job_id)}
                    canMoveUp={queuedIndex > 0}
                    canMoveDown={queuedIndex >= 0 && queuedIndex < queuedJobIds.length - 1}
                    onMoveUp={() => void moveQueuedJob(job.job_id, -1)}
                    onMoveDown={() => void moveQueuedJob(job.job_id, 1)}
                    reordering={reordering}
                    onRetry={failed && !gpuFault ? () => handleRetry(job.job_id) : undefined}
                    onReuse={() => onReuseQueue(job)}
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
                    onDelete={() => handleDelete(entry.id, name)}
                    onRequeue={() => onRequeue(entry)}
                    selected={selected.has(entry.id)}
                    onSelect={(modifiers) => selectRow(i, modifiers)}
                    rowIndex={i}
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
              12px side padding mirrors .result-list's -- the two numbers move
              together -- which is what puts the label's left edge on the same
              pixel as the rows above it. */}
          {(history.length > 0 || total > 0) && (
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
                  a class. The five-button window keeps the row's shape as it
                  slides with the selected page. */}
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
                {pageControls(page, pageCount).map((control) => (
                    <li key={control} className={['voiceover-pager-page', control === page ? 'is-active' : ''].filter(Boolean).join(' ')}>
                      <button
                        type="button"
                        aria-label={`Page ${control + 1}`}
                        aria-current={control === page ? 'page' : undefined}
                        onClick={() => goToPage(control)}
                      >
                        {control + 1}
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
      <AdminPasswordModal
        open={deleteRequest !== null}
        title="Confirm deletion"
        description={deleteRequest ? `Permanently delete ${deleteRequest.label}?` : ''}
        onClose={() => setDeleteRequest(null)}
        onSubmit={confirmDelete}
      />
    </div>
  )
}
