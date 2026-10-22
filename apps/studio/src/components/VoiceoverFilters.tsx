import { useEffect, useMemo, useRef, useState } from 'react'
import { Filter as FilterIcon } from 'lucide-react'
import type { HistoryEntry, Preset } from '../api'
import DropdownSelect from './DropdownSelect'
import { AppTooltip } from './Tooltip'

type VoiceoverStatus = 'all' | 'completed' | 'active' | 'failed'

export interface VoiceoverFilterState {
  status: VoiceoverStatus
  presetId?: string
  createdFrom?: number
  createdTo?: number
  durationMin?: number
  durationMax?: number
}

const EMPTY_VOICEOVER_FILTERS: VoiceoverFilterState = { status: 'all' }

export function restoreVoiceoverFilters(): VoiceoverFilterState {
  try {
    const value = JSON.parse(localStorage.getItem('voiceoverFilters.v1') ?? '{}') as VoiceoverFilterState
    const finite = (number: unknown) => number === undefined || (typeof number === 'number' && Number.isFinite(number))
    if (!['all', 'completed', 'active', 'failed'].includes(value.status) || !finite(value.createdFrom) || !finite(value.createdTo) || !finite(value.durationMin) || !finite(value.durationMax)) return EMPTY_VOICEOVER_FILTERS
    if ((value.createdFrom ?? -Infinity) > (value.createdTo ?? Infinity) || (value.durationMin ?? -Infinity) > (value.durationMax ?? Infinity)) return EMPTY_VOICEOVER_FILTERS
    return value
  } catch {
    return EMPTY_VOICEOVER_FILTERS
  }
}

function localBounds(start: string, end: string) {
  const from = new Date(start + 'T00:00:00').getTime() / 1000
  const to = new Date(end + 'T23:59:59.999').getTime() / 1000
  return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null
}

export default function VoiceoverFilters({ presets, history, value, onChange }: {
  presets: Preset[]
  history: HistoryEntry[]
  value: VoiceoverFilterState
  onChange: (value: VoiceoverFilterState) => void
}) {
  const [open, setOpen] = useState(false)
  const [dateMode, setDateMode] = useState('all')
  const [durationMode, setDurationMode] = useState('all')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [error, setError] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const voices = useMemo(() => {
    const ids = new Map(presets.map((preset) => [preset.id, preset.name]))
    history.forEach((entry) => { if (!ids.has(entry.preset_id)) ids.set(entry.preset_id, entry.preset_name) })
    return [...ids].sort((a, b) => a[1].localeCompare(b[1]))
  }, [presets, history])
  const count = Number(Boolean(value.presetId)) + Number(value.createdFrom !== undefined || value.createdTo !== undefined) + Number(value.durationMin !== undefined || value.durationMax !== undefined) + Number(value.status !== 'all')

  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  useEffect(() => {
    if (value.createdFrom === undefined && value.createdTo === undefined) setDateMode('all')
    if (value.durationMin === undefined && value.durationMax === undefined) setDurationMode('all')
  }, [value.createdFrom, value.createdTo, value.durationMin, value.durationMax])

  function changeDate(mode: string) {
    setDateMode(mode)
    setError('')
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const next: VoiceoverFilterState = { ...value, createdFrom: undefined, createdTo: undefined }
    if (mode === 'today') { next.createdFrom = midnight.getTime() / 1000; next.createdTo = Date.now() / 1000 }
    if (mode === '7d') { midnight.setDate(midnight.getDate() - 6); next.createdFrom = midnight.getTime() / 1000; next.createdTo = Date.now() / 1000 }
    if (mode === '30d') { midnight.setDate(midnight.getDate() - 29); next.createdFrom = midnight.getTime() / 1000; next.createdTo = Date.now() / 1000 }
    if (mode !== 'custom') onChange(next)
  }

  function changeDuration(mode: string) {
    setDurationMode(mode)
    setError('')
    const next: VoiceoverFilterState = { ...value, durationMin: undefined, durationMax: undefined }
    if (mode === 'short') next.durationMax = 29.999999
    if (mode === 'medium') { next.durationMin = 30; next.durationMax = 120 }
    if (mode === 'long') next.durationMin = 120.000001
    if (mode !== 'custom') onChange(next)
  }

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <AppTooltip content={count ? `Filters (${count} active)` : 'Filters'}>
        <button type="button" className="voiceover-filter-trigger icon-btn size-9 border border-control bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-audio" aria-label={count ? `Filters (${count} active)` : 'Filters'} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <FilterIcon size={16} />
        </button>
      </AppTooltip>
      {open && (
        <div className="absolute right-0 z-150 mt-1 w-[min(20rem,calc(100vw-1.5rem))] rounded-md border border-control bg-surface-card p-2.5 shadow-(--shadow-menu)" role="dialog" aria-label="Voiceover filters">
          <div className="mb-2 flex items-center justify-between">
            <span className="mono text-[10px] uppercase tracking-[0.08em] text-muted">Filters</span>
            <button type="button" className="ghost-btn h-7 px-2 text-[11px]" disabled={count === 0} onClick={() => { onChange(EMPTY_VOICEOVER_FILTERS); setDateMode('all'); setDurationMode('all'); setError('') }}>Clear</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="col-span-2 flex min-w-0 flex-col gap-1 text-[11px] text-muted">Voice
              <DropdownSelect className="w-full" contentClassName="standard-options-popup" value={value.presetId ?? ''} ariaLabel="Filter by voice" placeholder="Select voice" options={[{ value: '', label: 'Select voice' }, ...voices.map(([id, name]) => ({ value: id, label: name }))]} onValueChange={(presetId) => onChange({ ...value, presetId: presetId || undefined })} />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted">Date range
              <DropdownSelect className="w-full" contentClassName="standard-options-popup" value={dateMode} ariaLabel="Filter by date range" placeholder="Select date range" options={[{ value: 'all', label: 'Any date' }, { value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'custom', label: 'Custom…' }]} onValueChange={changeDate} />
            </label>
            <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted">Duration
              <DropdownSelect className="w-full" contentClassName="standard-options-popup" value={durationMode} ariaLabel="Filter by duration" placeholder="Select duration" options={[{ value: 'all', label: 'Any length' }, { value: 'short', label: 'Under 30s' }, { value: 'medium', label: '30–120s' }, { value: 'long', label: 'Over 120s' }, { value: 'custom', label: 'Custom…' }]} onValueChange={changeDuration} />
            </label>
            {dateMode === 'custom' && (
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted">Start<input type="date" className="h-8 w-full rounded-sm border border-control bg-control-fill px-1 text-[11px] text-ink" value={start} onChange={(event) => setStart(event.target.value)} /></label>
                <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted">End<input type="date" className="h-8 w-full rounded-sm border border-control bg-control-fill px-1 text-[11px] text-ink" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
                <button type="button" className="ghost-btn col-span-2 h-8 text-[11px]" onClick={() => { const bounds = localBounds(start, end); if (!bounds || bounds.from > bounds.to) setError('End date must not be before start date.'); else { setError(''); onChange({ ...value, createdFrom: bounds.from, createdTo: bounds.to }) } }}>Apply dates</button>
              </div>
            )}
            {durationMode === 'custom' && (
              <div className="col-span-2 grid grid-cols-2 gap-2">
                <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted">Min seconds<input type="number" min="0" step="any" className="h-8 w-full rounded-sm border border-control bg-control-fill px-1 text-[11px] text-ink" value={min} onChange={(event) => setMin(event.target.value)} /></label>
                <label className="flex min-w-0 flex-col gap-1 text-[11px] text-muted">Max seconds<input type="number" min="0" step="any" className="h-8 w-full rounded-sm border border-control bg-control-fill px-1 text-[11px] text-ink" value={max} onChange={(event) => setMax(event.target.value)} /></label>
                <button type="button" className="ghost-btn col-span-2 h-8 text-[11px]" onClick={() => { const low = min === '' ? undefined : Number(min); const high = max === '' ? undefined : Number(max); if ((low !== undefined && (!Number.isFinite(low) || low < 0)) || (high !== undefined && (!Number.isFinite(high) || high < 0)) || (low !== undefined && high !== undefined && low > high)) setError('Use non-negative durations with minimum no greater than maximum.'); else { setError(''); onChange({ ...value, durationMin: low, durationMax: high }) } }}>Apply duration</button>
              </div>
            )}
            <label className="col-span-2 flex min-w-0 flex-col gap-1 text-[11px] text-muted">Generation status
              <DropdownSelect className="w-full" contentClassName="standard-options-popup" value={value.status} ariaLabel="Filter by generation status" placeholder="Select generation status" options={[{ value: 'all', label: 'Any status' }, { value: 'completed', label: 'Completed' }, { value: 'active', label: 'Generating / Queued' }, { value: 'failed', label: 'Failed' }]} onValueChange={(status) => onChange({ ...value, status: status as VoiceoverStatus })} />
            </label>
          </div>
          {error && <p className="mb-0 mt-2 text-[11px] text-danger" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
