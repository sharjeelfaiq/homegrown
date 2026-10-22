import type { RefObject } from 'react'
import { WandSparkles as WandIcon } from 'lucide-react'
import { AppTooltip } from '../../components/ui/Tooltip'
import PlaybackScript from '../../components/audio/PlaybackScript'

export default function HistoryScriptLine({
  text,
  fullText,
  label,
  audioRef,
  durationS,
  onReuse,
}: {
  text: string
  fullText: string
  label: string
  audioRef: RefObject<HTMLAudioElement | null>
  durationS: number | null
  onReuse: () => void
}) {
  return (
    <div className="flex min-h-6 min-w-0 items-center gap-2">
      <AppTooltip content={fullText}>
        <button
          type="button"
          className="result-text m-0 min-w-0 flex-1 overflow-hidden bg-transparent p-0 text-left text-[12px] text-faint hover:text-ink"
          aria-label={`Script preview. Reuse the script of ${label}`}
          onClick={onReuse}
        >
          <PlaybackScript text={text} fullText={fullText} audioRef={audioRef} durationS={durationS} />
        </button>
      </AppTooltip>
      <button
        type="button"
        className="flex flex-none items-center gap-1 bg-transparent p-0 text-[10px] text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
        aria-label={`Reuse ${label} script`}
        onClick={onReuse}
      >
        <WandIcon size={12} aria-hidden="true" />Reuse
      </button>
    </div>
  )
}
