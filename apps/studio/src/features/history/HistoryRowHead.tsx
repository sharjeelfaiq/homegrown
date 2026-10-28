import type { ReactNode } from 'react'
import { AppTooltip } from '../../components/ui/Tooltip'
import InlineName from '../../components/ui/InlineName'
import { formatTimeOfDay, formatTimestampFull } from '../../lib/format'

export interface NameControl {
  number: number
  name: string
  placeholder?: string
  onCommitRename: (next: string) => void
}

export default function HistoryRowHead({
  number,
  name,
  placeholder,
  onCommitRename,
  voiceName,
  timestamp,
  timestampTitle,
  nameTitle,
  scriptPreview,
}: NameControl & {
  voiceName?: string
  scriptPreview?: ReactNode
  nameTitle: string
  timestamp?: number
  timestampTitle?: string
}) {
  return (
    <div className="history-row-head flex min-h-[26px] min-w-0 items-center justify-between gap-1.5">
      <div className={scriptPreview ? 'history-name-script' : 'contents'}>
        <InlineName
          value={name}
          placeholder={placeholder ?? `Voiceover ${number}`}
          ariaLabel={placeholder ?? `Name of voiceover ${number}`}
          title={nameTitle}
          onCommit={onCommitRename}
          className="result-name voiceover-name"
          editOnPencil
        />
      </div>

      {scriptPreview && <span className="flex-none text-[12px] text-muted" aria-hidden="true">-</span>}
      {scriptPreview && <div className="history-row-script min-w-0 flex-1 overflow-hidden">{scriptPreview}</div>}

      <div className={`history-row-meta ml-auto flex min-w-0 items-center justify-end gap-3 ${scriptPreview ? 'flex-none' : 'flex-1'}`}>
        {voiceName && (
          <AppTooltip content={`Voice: ${voiceName}`}>
            <span className="mono min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-right text-[11px] text-faint">
              {voiceName}
            </span>
          </AppTooltip>
        )}
        {timestamp !== undefined && (
          <AppTooltip content={timestampTitle ?? formatTimestampFull(timestamp)}>
            <time className="result-stamp mono" dateTime={new Date(timestamp * 1000).toISOString()}>
              {formatTimeOfDay(timestamp)}
            </time>
          </AppTooltip>
        )}
      </div>
    </div>
  )
}
