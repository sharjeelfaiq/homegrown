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
  const rows: [string, string][] = []
  if (props.kind === 'voice' && props.record !== null) {
    const voice = props.record
    rows.push(
      ['Name', voice.name],
      ['Created', formatTimestampFull(voice.created_at)],
      ['Language', voice.language || 'Not recorded'],
      ['Reference duration', seconds(voice.ref_seconds)],
      ['Cloning time', seconds(voice.cloning_s)],
      ['Completed voiceovers', voice.completed_voiceovers?.toLocaleString() ?? 'Not recorded'],
    )
    if (voice.tag) rows.push(['Tag', voice.tag])
  } else if (props.kind === 'voiceover' && props.record !== null) {
    const voiceover = props.record
    rows.push(
      ['Name', props.name],
      ['Created', formatTimestampFull(voiceover.created_at)],
      ['Language', voiceover.language || 'Not recorded'],
      ['Voice', voiceover.preset_name || 'Not recorded'],
      ['Audio duration', seconds(voiceover.duration_s)],
      ['Generation time', seconds(voiceover.generation_s)],
      ['Script', voiceover.text.length > 100 ? `${voiceover.text.slice(0, 100)}\u2026` : voiceover.text],
    )
  }
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
