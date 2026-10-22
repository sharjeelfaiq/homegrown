import { useEffect, useState } from 'react'
import { UNDO_MS } from '../../lib/constants'
import StatusMark from './StatusMark'

/** The shared toast status ring, depleted against the deletion's actual deadline. */
export default function UndoCountdown({ deadline, status = 'running' }: {
  deadline?: number
  status?: 'running' | 'done'
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, (deadline ?? 0) - Date.now()))

  useEffect(() => {
    if (deadline === undefined) return
    const update = () => setRemaining(Math.max(0, deadline - Date.now()))
    update()
    const timer = window.setInterval(update, 100)
    return () => window.clearInterval(timer)
  }, [deadline])

  const seconds = Math.ceil(remaining / 1000)

  return (
    <span className="flex items-center justify-center" role="img" aria-label={deadline === undefined
      ? status === 'done' ? 'Deleted' : 'Deleting'
      : `Undo available for ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}>
      <span className="flex" aria-hidden="true">
        <StatusMark
          status={status}
          progress={deadline === undefined ? undefined : Math.min(1, remaining / UNDO_MS)}
          size={18}
          strokeWidth={2.2}
          color="var(--progress)"
          doneColor="var(--green)"
        />
      </span>
    </span>
  )
}
