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
  runningPresetNames: Set<string>
  /** Force an immediate re-poll (after cancel/reorder/submit). */
  refresh: () => void
}

const GenerationActivityContext = createContext<GenerationActivityValue | null>(null)

/** The one queue poller for the whole app: 1s while work is active,
 * backed off to 4s when idle, fully paused in background tabs. */
export function GenerationActivityProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueueEntry[]>([])
  const [nonce, setNonce] = useState(0)
  const visible = usePageVisible()
  const queueRef = useRef(queue)
  queueRef.current = queue

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let timer: number | undefined

    const tick = () => {
      listQueue()
        .then((r) => {
          if (!cancelled) setQueue(r.queue)
        })
        .catch(() => {})
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
    const runningPresetNames = new Set(
      queue.filter((e) => e.status === 'running').map((e) => e.preset_name),
    )
    return {
      queue,
      anyRunning: runningPresetNames.size > 0,
      runningPresetNames,
      refresh: () => setNonce((n) => n + 1),
    }
  }, [queue])

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
