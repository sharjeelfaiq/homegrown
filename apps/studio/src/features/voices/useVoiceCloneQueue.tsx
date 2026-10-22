import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { toast } from 'sonner'
import StatusMark from '../../components/ui/StatusMark'
import { formatToastDescription, formatToastMessage, formatToastTitle } from '../../lib/messageFormatting'
import './VoiceCloneQueue.css'

interface QueueItem { file: File; toastId: string | number }

/** Browser-local FIFO: hold selected files until the previous clone request settles. */
export function useVoiceCloneQueue({ modelReady, onAddVoice, onBusyChange }: {
  modelReady: boolean
  onAddVoice: (file: File) => Promise<'done' | 'failed'>
  onBusyChange?: (busy: boolean) => void
}) {
  const latest = useRef({ modelReady, onAddVoice, onBusyChange })
  const queue = useRef<QueueItem[]>([])
  const running = useRef(false)
  const mounted = useRef(true)
  const toastIds = useRef(new Set<string | number>())

  useLayoutEffect(() => { latest.current = { modelReady, onAddVoice, onBusyChange } }, [modelReady, onAddVoice, onBusyChange])

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
        const { file, toastId } = queue.current.shift()!
        toast(formatToastTitle('Your uploaded voice is getting cloned.'), {
          id: toastId, duration: Infinity, description: formatToastMessage(file.name),
          icon: <StatusMark status="running" size={18} strokeWidth={2.2} color="var(--progress)" />,
        })
        try {
          const result = await latest.current.onAddVoice(file)
          if (!mounted.current) return
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
      if (mounted.current) latest.current.onBusyChange?.(queue.current.length > 0)
    }
  }, [])

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
      queue.current.push({ file, toastId })
      latest.current.onBusyChange?.(true)
    }
    void drain()
  }, [drain])
}
