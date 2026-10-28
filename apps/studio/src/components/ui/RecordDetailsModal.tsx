import Modal from './Modal'
import type { HistoryEntry, Preset } from '../../lib/api'
import { formatTimestampFull } from '../../lib/format'

function seconds(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Not recorded'

  const formatUnit = (amount: number, unit: string) => `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}${amount === 1 ? '' : 's'}`
  if (value < 60) return formatUnit(value, 'second')

  // Round to hundredths before splitting units so a value such as 59:59.999
  // carries cleanly into the next minute rather than displaying 60 seconds.
  const rounded = Math.round(value * 100) / 100
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const remainder = Math.round((rounded % 60) * 100) / 100

  if (hours > 0) {
    return [
      formatUnit(hours, 'hour'),
      ...(minutes > 0 ? [formatUnit(minutes, 'minute')] : []),
      ...(remainder > 0 ? [formatUnit(remainder, 'second')] : []),
    ].join(' ')
  }

  return `${formatUnit(minutes, 'minute')} ${formatUnit(remainder, 'second')}`
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
