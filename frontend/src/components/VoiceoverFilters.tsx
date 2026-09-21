import { useEffect, useMemo, useRef, useState } from 'react'
import type { HistoryEntry, Preset } from '../api'

export type VoiceoverStatus = 'all' | 'completed' | 'active' | 'failed'
export interface VoiceoverFilterState {
  status: VoiceoverStatus
  presetId?: string
  createdFrom?: number
  createdTo?: number
  durationMin?: number
  durationMax?: number
}

export const EMPTY_VOICEOVER_FILTERS: VoiceoverFilterState = { status: 'all' }

export function restoreVoiceoverFilters(): VoiceoverFilterState {
  try {
    const value = JSON.parse(localStorage.getItem('voiceoverFilters.v1') ?? '{}') as VoiceoverFilterState
    const finite = (n: unknown) => n === undefined || (typeof n === 'number' && Number.isFinite(n))
    if (!['all', 'completed', 'active', 'failed'].includes(value.status) || !finite(value.createdFrom) || !finite(value.createdTo) || !finite(value.durationMin) || !finite(value.durationMax)) return EMPTY_VOICEOVER_FILTERS
    if ((value.createdFrom ?? -Infinity) > (value.createdTo ?? Infinity) || (value.durationMin ?? -Infinity) > (value.durationMax ?? Infinity)) return EMPTY_VOICEOVER_FILTERS
    return value
  } catch { return EMPTY_VOICEOVER_FILTERS }
}

function localBounds(start: string, end: string) {
  const from = new Date(`${start}T00:00:00`).getTime() / 1000
  const to = new Date(`${end}T23:59:59.999`).getTime() / 1000
  return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null
}

export default function VoiceoverFilters({ presets, history, value, onChange }: { presets: Preset[]; history: HistoryEntry[]; value: VoiceoverFilterState; onChange: (value: VoiceoverFilterState) => void }) {
  const [open, setOpen] = useState(false)
  const [dateMode, setDateMode] = useState('all')
  const [durationMode, setDurationMode] = useState('all')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [min, setMin] = useState('')
  const [max, setMax] = useState('')
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const voices = useMemo(() => {
    const ids = new Map(presets.map((p) => [p.id, p.name]))
    history.forEach((h) => { if (!ids.has(h.preset_id)) ids.set(h.preset_id, h.preset_name) })
    return [...ids].sort((a, b) => a[1].localeCompare(b[1]))
  }, [presets, history])
  const count = Number(Boolean(value.presetId)) + Number(value.createdFrom !== undefined || value.createdTo !== undefined) + Number(value.durationMin !== undefined || value.durationMax !== undefined) + Number(value.status !== 'all')

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])

  // The reserved toolbar can clear filters while this popover is closed. Keep
  // the next open in sync with the externally reset filter state.
  useEffect(() => {
    if (value.createdFrom === undefined && value.createdTo === undefined) setDateMode('all')
    if (value.durationMin === undefined && value.durationMax === undefined) setDurationMode('all')
  }, [value.createdFrom, value.createdTo, value.durationMin, value.durationMax])

  const dateChange = (mode: string) => {
    setDateMode(mode); setError('')
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0)
    const next: VoiceoverFilterState = { ...value, createdFrom: undefined, createdTo: undefined }
    if (mode === 'today') { next.createdFrom = midnight.getTime() / 1000; next.createdTo = Date.now() / 1000 }
    if (mode === '7d') { midnight.setDate(midnight.getDate() - 6); next.createdFrom = midnight.getTime() / 1000; next.createdTo = Date.now() / 1000 }
    if (mode === '30d') { midnight.setDate(midnight.getDate() - 29); next.createdFrom = midnight.getTime() / 1000; next.createdTo = Date.now() / 1000 }
    if (mode !== 'custom') onChange(next)
  }
  const durationChange = (mode: string) => {
    setDurationMode(mode); setError('')
    const next: VoiceoverFilterState = { ...value, durationMin: undefined, durationMax: undefined }
    if (mode === 'short') next.durationMax = 29.999999
    if (mode === 'medium') { next.durationMin = 30; next.durationMax = 120 }
    if (mode === 'long') next.durationMin = 120.000001
    if (mode !== 'custom') onChange(next)
  }
  return <div className="relative shrink-0" ref={ref}>
    <button type="button" className="ghost-btn h-10 border border-control bg-control-fill px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-audio" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>Filters{count ? ` (${count})` : ''}</button>
    {open && <div className="absolute right-0 z-150 mt-1 w-[min(22rem,calc(100vw-2rem))] rounded-md border border-control bg-surface-card p-3 shadow-(--shadow-menu)" role="dialog" aria-label="Voiceover filters">
      <div className="mb-3 flex justify-between"><span className="mono text-[11px] text-muted">Filters</span><button type="button" className="ghost-btn" disabled={count === 0} onClick={() => { onChange(EMPTY_VOICEOVER_FILTERS); setDateMode('all'); setDurationMode('all'); setError('') }}>Clear filters</button></div>
      <label className="mb-3 block text-[12px] text-muted">Voice<select className="history-filter-select mt-1 h-9 w-full rounded-sm border border-control px-2" value={value.presetId ?? ''} onChange={(e) => onChange({ ...value, presetId: e.target.value || undefined })}><option value="">All voices</option>{voices.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="mb-3 block text-[12px] text-muted">Date range<select className="history-filter-select mt-1 h-9 w-full rounded-sm border border-control px-2" value={dateMode} onChange={(e) => dateChange(e.target.value)}><option value="all">Any time</option><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom range</option></select></label>
      {dateMode === 'custom' && <div className="mb-3 grid grid-cols-2 gap-2"><label className="text-[12px] text-muted">Start<input type="date" className="mt-1 h-9 w-full rounded-sm border border-control bg-control-fill px-1 text-ink" value={start} onChange={(e) => setStart(e.target.value)} /></label><label className="text-[12px] text-muted">End<input type="date" className="mt-1 h-9 w-full rounded-sm border border-control bg-control-fill px-1 text-ink" value={end} onChange={(e) => setEnd(e.target.value)} /></label><button type="button" className="ghost-btn col-span-2" onClick={() => { const bounds = localBounds(start, end); if (!bounds || bounds.from > bounds.to) setError('End date must not be before start date.'); else { setError(''); onChange({ ...value, createdFrom: bounds.from, createdTo: bounds.to }) } }}>Apply dates</button></div>}
      <label className="mb-3 block text-[12px] text-muted">Duration<select className="history-filter-select mt-1 h-9 w-full rounded-sm border border-control px-2" value={durationMode} onChange={(e) => durationChange(e.target.value)}><option value="all">Any duration</option><option value="short">Short (under 30s)</option><option value="medium">Medium (30–120s)</option><option value="long">Long (over 120s)</option><option value="custom">Custom range</option></select></label>
      {durationMode === 'custom' && <div className="mb-3 grid grid-cols-2 gap-2"><label className="text-[12px] text-muted">Min seconds<input type="number" min="0" step="any" className="mt-1 h-9 w-full rounded-sm border border-control bg-control-fill px-1 text-ink" value={min} onChange={(e) => setMin(e.target.value)} /></label><label className="text-[12px] text-muted">Max seconds<input type="number" min="0" step="any" className="mt-1 h-9 w-full rounded-sm border border-control bg-control-fill px-1 text-ink" value={max} onChange={(e) => setMax(e.target.value)} /></label><button type="button" className="ghost-btn col-span-2" onClick={() => { const lo = min === '' ? undefined : Number(min); const hi = max === '' ? undefined : Number(max); if ((lo !== undefined && (!Number.isFinite(lo) || lo < 0)) || (hi !== undefined && (!Number.isFinite(hi) || hi < 0)) || (lo !== undefined && hi !== undefined && lo > hi)) setError('Use non-negative durations with minimum no greater than maximum.'); else { setError(''); onChange({ ...value, durationMin: lo, durationMax: hi }) } }}>Apply duration</button></div>}
      <label className="block text-[12px] text-muted">Generation status<select className="history-filter-select mt-1 h-9 w-full rounded-sm border border-control px-2" value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value as VoiceoverStatus })}><option value="all">All</option><option value="completed">Completed</option><option value="active">Generating / Queued</option><option value="failed">Failed</option></select></label>
      {error && <p className="mt-2 mb-0 text-[12px] text-danger" role="alert">{error}</p>}
    </div>}
  </div>
}
