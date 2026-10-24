import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { toast } from 'sonner'
import { presetNameFromFile } from '../../lib/format'
import StatusMark from '../../components/ui/StatusMark'
import { formatToastDescription, formatToastMessage, formatToastTitle } from '../../lib/messageFormatting'
import './VoiceCloneQueue.css'

export interface CloneQueueDisplayItem { id: string; name: string; status: 'cloning' | 'queued' }
interface QueueItem extends CloneQueueDisplayItem { file: File; toastId: string | number }

/** Browser-local FIFO: hold selected files until the previous clone request settles. */
export function useVoiceCloneQueue({ modelReady, onAddVoice, onBusyChange, onQueueChange }: {
  modelReady: boolean
  onAddVoice: (file: File) => Promise<'done' | 'failed'>
  onBusyChange?: (busy: boolean) => void
  onQueueChange?: (items: CloneQueueDisplayItem[]) => void
}) {
  const latest = useRef({ modelReady, onAddVoice, onBusyChange, onQueueChange })
  const queue = useRef<QueueItem[]>([])
  const active = useRef<QueueItem | null>(null)
  const running = useRef(false)
  const mounted = useRef(true)
  const toastIds = useRef(new Set<string | number>())

  useLayoutEffect(() => { latest.current = { modelReady, onAddVoice, onBusyChange, onQueueChange } }, [modelReady, onAddVoice, onBusyChange, onQueueChange])

  const publishQueue = useCallback(() => {
    const items: CloneQueueDisplayItem[] = []
    if (active.current) items.push({ id: active.current.id, name: active.current.name, status: 'cloning' })
    items.push(...queue.current.map(({ id, name }) => ({ id, name, status: 'queued' as const })))
    latest.current.onQueueChange?.(items)
  }, [])

  useEffect(() => {
    mounted.current = true
    const ownedToasts = toastIds.current
    return () => {
      mounted.current = false
      queue.current = []
      for (const id of ownedToasts) toast.dismiss(id)
      ownedToasts.clear()
    }
  }, [])

  const drain = useCallback(async () => {
    if (running.current || !mounted.current) return
    running.current = true
    try {
      while (mounted.current && latest.current.modelReady && queue.current.length > 0) {
        const item = queue.current.shift()!
        active.current = item
        const { file, toastId } = item
        publishQueue()
        toast(formatToastTitle('Your uploaded voice is getting cloned.'), {
          id: toastId, duration: Infinity, description: formatToastMessage(file.name),
          icon: <StatusMark status="running" size={18} strokeWidth={2.2} color="var(--progress)" />,
        })
        try {
          const result = await latest.current.onAddVoice(file)
          if (!mounted.current) return
          active.current = null
          publishQueue()
          if (result === 'done') {
            toast(formatToastTitle('Your voice has been cloned.'), {
              id: toastId, duration: 1000, description: formatToastMessage(file.name),
              icon: <StatusMark status="done" size={18} strokeWidth={2.2} color="var(--progress)" doneColor="var(--green)" />,
              onAutoClose: () => { toastIds.current.delete(toastId) },
            })
          } else {
            // The request owner reports the server's actionable error.
            toast.dismiss(toastId)
            toastIds.current.delete(toastId)
          }
        } catch (error) {
          if (!mounted.current) return
          toast(formatToastTitle('Voice cloning failed'), {
            id: toastId, duration: 5000,
            description: formatToastDescription(`Could not clone ${file.name}: ${error instanceof Error ? error.message : 'Please try this file again'}`),
            icon: <StatusMark status="failed" size={18} strokeWidth={2.2} errorColor="var(--danger)" />,
            onAutoClose: () => { toastIds.current.delete(toastId) },
          })
        }
      }
    } finally {
      running.current = false
      if (mounted.current) {
        active.current = null
        publishQueue()
        latest.current.onBusyChange?.(queue.current.length > 0)
      }
    }
  }, [publishQueue])

  // Resume existing waiting files when a temporarily unavailable model recovers.
  useEffect(() => { if (modelReady) void drain() }, [modelReady, drain])

  return useCallback((files: readonly File[]) => {
    if (!mounted.current || !latest.current.modelReady) return
    for (const file of files) {
      if (!file.type.startsWith('audio/') && !/\.(wav|mp3|m4a|flac|ogg|opus|webm|aac)$/i.test(file.name)) continue
      const toastId = toast(formatToastTitle('Your uploaded voice is waiting to be cloned.'), {
        duration: Infinity, description: formatToastMessage(file.name),
        icon: <StatusMark status="pending" className="voice-clone-waiting" size={18} strokeWidth={2.2} color="var(--progress)" />,
      })
      toastIds.current.add(toastId)
      queue.current.push({ id: `${Date.now()}-${Math.random()}`, name: presetNameFromFile(file.name), file, toastId, status: 'queued' })
      latest.current.onBusyChange?.(true)
    }
    publishQueue()
    void drain()
  }, [drain, publishQueue])
}
