import { toast } from 'sonner'
import { UNDO_MS } from '../../lib/constants'
import UndoCountdown from './UndoCountdown'

/** Defer deletion behind Undo; keep one toast through countdown, request and success. */
export function showUndoDeleteToast({ label, onDelete, onUndo, onError, onSettled }: {
  label: string
  onDelete: () => Promise<void>
  onUndo?: () => void
  onError: (error: unknown) => void
  onSettled: () => void
}): () => void {
  const deadline = Date.now() + UNDO_MS
  let phase: 'waiting' | 'deleting' | 'done' | 'cancelled' = 'waiting'

  const toastId = toast(`${label} deleted`, {
    duration: Infinity,
    icon: <UndoCountdown deadline={deadline} />,
    action: {
      label: 'Undo',
      onClick: (event) => {
        if (phase !== 'waiting' || Date.now() >= deadline) {
          event.preventDefault()
          return
        }
        cancel()
        onUndo?.()
      },
    },
  })

  const timer = window.setTimeout(async () => {
    if (phase !== 'waiting') return
    phase = 'deleting'
    toast(`Deleting ${label}…`, {
      id: toastId, duration: Infinity, action: null,
      icon: <UndoCountdown />,
    })
    try {
      await onDelete()
      if (isCancelled()) return
      phase = 'done'
      toast(`${label} deleted`, {
        id: toastId, duration: 1000, action: null,
        icon: <UndoCountdown status="done" />,
      })
    } catch (error) {
      if (isCancelled()) return
      toast.dismiss(toastId)
      onError(error)
    } finally {
      if (!isCancelled()) onSettled()
    }
  }, UNDO_MS)

  function isCancelled() { return phase === 'cancelled' }

  function cancel() {
    if (phase === 'cancelled' || phase === 'done') return
    phase = 'cancelled'
    window.clearTimeout(timer)
    toast.dismiss(toastId)
    onSettled()
  }

  return cancel
}
