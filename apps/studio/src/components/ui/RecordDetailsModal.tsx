import Modal from './Modal'
import type { HistoryEntry, Preset } from '../../lib/api'
import { formatTimestampFull } from '../../lib/format'

function seconds(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} seconds`
    : 'Not recorded'
}

type Props = { onClose: () => void } & (
  | { kind: 'voice'; record: Preset | null }
  | { kind: 'voiceover'; record: HistoryEntry | null; name: string }
)

/** Shared record presentation; processing times are measured server-side. */
export default function RecordDetailsModal(props: Props) {
  const record = props.record
  const rows: [string, string][] = record ? [
    ['Name', props.kind === 'voice' ? props.record!.name : props.name],
    ['Created', formatTimestampFull(record.created_at)],
    ['Language', record.language || 'Not recorded'],
    ...(props.kind === 'voice' ? [
      ['Reference duration', seconds(props.record!.ref_seconds)],
      ['Cloning time', seconds(props.record!.cloning_s)],
      ['Completed voiceovers', props.record!.completed_voiceovers?.toLocaleString() ?? 'Not recorded'],
      ...(props.record!.tag ? [['Tag', props.record!.tag]] : []),
    ] as [string, string][] : [
      ['Voice', props.record!.preset_name || 'Not recorded'],
      ['Audio duration', seconds(props.record!.duration_s)],
      ['Generation time', seconds(props.record!.generation_s)],
      ['Script', props.record!.text.length > 100 ? `${props.record!.text.slice(0, 100)}?` : props.record!.text],
    ] as [string, string][]),
  ] : []
  return (
    <Modal size="details" open={record !== null} title={props.kind === 'voice' ? 'Voice details' : 'Voiceover details'} onClose={props.onClose}>
      <dl className="m-0 divide-y divide-hairline text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 py-3 first:pt-0 last:pb-0">
            <dt className="text-muted">{label}</dt>
            <dd className="m-0 min-w-0 whitespace-pre-wrap break-words text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}
