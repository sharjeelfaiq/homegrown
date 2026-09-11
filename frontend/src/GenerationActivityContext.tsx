import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { listQueue, type QueueEntry } from './api'
import { usePageVisible } from './hooks/usePageVisible'

interface GenerationActivityValue {
  queue: QueueEntry[]
  anyRunning: boolean
  /** Ids of voices with a job in flight. Ids, not names: two voices can share
   *  a name, and the old name-keyed set marked both of them busy. */
  runningPresetIds: Set<string>
  /** Force an immediate re-poll (after cancel/reorder/submit). */
  refresh: () => void
  /** False once the poller has missed several polls in a row.
   *
   *  A failed poll used to be indistinguishable from no news -- the error was
   *  swallowed and `queue` kept its last value -- so a backend that died
   *  mid-session left an in-flight row on screen with a clock still counting
   *  up. Nothing else notices: health is checked at boot and when a job FAILS,
   *  never on an interval.
   *
   *  Consecutive, not cumulative. One dropped request while the GPU is busy is
   *  normal; several in a row is not. */
  reachable: boolean
}

/** Missed polls before the backend is declared unreachable. Three at the 1s
 *  active cadence is ~3s of silence -- long enough not to fire on a single
 *  blip, short enough to beat the user wondering why nothing is moving. */
const MISSES_BEFORE_UNREACHABLE = 3

const GenerationActivityContext = createContext<GenerationActivityValue | null>(null)

/** The one queue poller for the whole app: 1s while work is active,
 * backed off to 4s when idle, fully paused in background tabs. */
export function GenerationActivityProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [nonce, setNonce] = useState(0)
  const [reachable, setReachable] = useState(true)
  const visible = usePageVisible()
  const queueRef = useRef(queue)
  queueRef.current = queue
  // Counted in a ref, not state: only crossing the threshold is worth a
  // re-render, and every miss in between would cause one.
  const misses = useRef(0)

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let timer: number | undefined

    // A tab that was hidden has not been failing -- it has not been asking.
    // Resetting here stops the gap being counted as misses on return.
    misses.current = 0

    const tick = () => {
      listQueue()
        .then((r) => {
          if (cancelled) return
          setQueue(r.queue)
          misses.current = 0
          setReachable(true)
        })
        .catch(() => {
          if (cancelled) return
          misses.current += 1
          if (misses.current >= MISSES_BEFORE_UNREACHABLE) setReachable(false)
        })
        .finally(() => {
          if (cancelled) return
          const active = queueRef.current.some(
            (e) => e.status === 'running' || e.status === 'canceling' || e.status === 'queued',
          )
          timer = window.setTimeout(tick, active ? 1000 : 4000)
        })
    }
    tick()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [visible, nonce])

  const value = useMemo<GenerationActivityValue>(() => {
    const runningPresetIds = new Set(
      queue.filter((e) => e.status === 'running').map((e) => e.preset_id),
    )
    return {
      queue,
      anyRunning: runningPresetIds.size > 0,
      runningPresetIds,
      refresh: () => setNonce((n) => n + 1),
      reachable,
    }
  }, [queue, reachable])

  return (
    <GenerationActivityContext.Provider value={value}>
      {children}
    </GenerationActivityContext.Provider>
  )
}

export function useGenerationActivity(): GenerationActivityValue {
  const ctx = useContext(GenerationActivityContext)
  if (!ctx) {
    throw new Error('useGenerationActivity must be used within a GenerationActivityProvider')
  }
  return ctx
}
