import { useMemo } from 'react'
import type { HistoryEntry, Preset } from '../api'
import DropdownSelect from './DropdownSelect'
import { CalendarDays, Check as CheckIcon } from 'lucide-react'
import { DropdownMenu } from './DropdownMenu'
import { AppTooltip } from './Tooltip'
import type { VoiceoverFilterState, VoiceoverStatus } from './VoiceoverFilters'

function quickDateMode(value: VoiceoverFilterState) {
  if (value.createdFrom === undefined && value.createdTo === undefined) return 'all'
  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)
  const from = value.createdFrom ?? 0
  const to = value.createdTo ?? 0
  if (Math.abs(from - midnight.getTime() / 1000) < 120 && to >= Date.now() / 1000 - 120) return 'today'
  midnight.setDate(midnight.getDate() - 6)
  if (Math.abs(from - midnight.getTime() / 1000) < 120 && to >= Date.now() / 1000 - 120) return '7d'
  midnight.setDate(midnight.getDate() - 23)
  if (Math.abs(from - midnight.getTime() / 1000) < 120 && to >= Date.now() / 1000 - 120) return '30d'
  return 'custom'
}

function quickDurationMode(value: VoiceoverFilterState) {
  if (value.durationMin === undefined && value.durationMax === undefined) return 'all'
  if (value.durationMin === undefined && value.durationMax !== undefined && value.durationMax < 30) return 'short'
  if (value.durationMin === 30 && value.durationMax === 120) return 'medium'
  if (value.durationMin !== undefined && value.durationMin > 120 && value.durationMax === undefined) return 'long'
  return 'custom'
}

export default function VoiceoverQuickFilters({ presets, history, value, onChange, className = '' }: {
  presets: Preset[]
  history: HistoryEntry[]
  value: VoiceoverFilterState
  onChange: (value: VoiceoverFilterState) => void
  className?: string
}) {
  const voices = useMemo(() => {
    const ids = new Map(presets.map((preset) => [preset.id, preset.name]))
    history.forEach((entry) => { if (!ids.has(entry.preset_id)) ids.set(entry.preset_id, entry.preset_name) })
    return [...ids].sort((a, b) => a[1].localeCompare(b[1]))
  }, [presets, history])

  function changeDate(mode: string) {
    const now = Date.now()
    const midnight = new Date(now)
    midnight.setHours(0, 0, 0, 0)
    const next: VoiceoverFilterState = { ...value, createdFrom: undefined, createdTo: undefined }
    if (mode === 'today') { next.createdFrom = midnight.getTime() / 1000; next.createdTo = now / 1000 }
    if (mode === '7d') { midnight.setDate(midnight.getDate() - 6); next.createdFrom = midnight.getTime() / 1000; next.createdTo = now / 1000 }
    if (mode === '30d') { midnight.setDate(midnight.getDate() - 29); next.createdFrom = midnight.getTime() / 1000; next.createdTo = now / 1000 }
    if (mode !== 'custom') onChange(next)
  }

  function changeDuration(mode: string) {
    const next: VoiceoverFilterState = { ...value, durationMin: undefined, durationMax: undefined }
    if (mode === 'short') next.durationMax = 29.999999
    if (mode === 'medium') { next.durationMin = 30; next.durationMax = 120 }
    if (mode === 'long') next.durationMin = 120.000001
    if (mode !== 'custom') onChange(next)
  }

  return (
    <div className={`flex w-[284px] max-w-full min-w-0 flex-none items-center gap-1 ${className}`} aria-label="Quick voiceover filters">
      <DropdownSelect className="h-7 w-[80px] min-w-0 flex-[0_1_80px] rounded-sm border border-control bg-control-fill px-1 text-[10px] text-muted" value={value.presetId ?? ''} ariaLabel="Filter by voice" options={[{ value: '', label: 'Voice' }, ...voices.map(([id, label]) => ({ value: id, label }))]} onValueChange={(presetId) => onChange({ ...value, presetId: presetId || undefined })} />
      <DropdownSelect className="h-7 w-[80px] min-w-0 flex-[0_1_80px] rounded-sm border border-control bg-control-fill px-1 text-[10px] text-muted" value={quickDurationMode(value)} ariaLabel="Filter by duration" options={[{ value: 'all', label: 'Duration' }, { value: 'short', label: 'Short (<30s)' }, { value: 'medium', label: 'Medium (30–120s)' }, { value: 'long', label: 'Long (>120s)' }, { value: 'custom', label: 'Custom range…' }]} onValueChange={changeDuration} />
      <DropdownSelect className="h-7 w-[80px] min-w-0 flex-[0_1_80px] rounded-sm border border-control bg-control-fill px-1 text-[10px] text-muted" value={value.status} ariaLabel="Filter by generation status" options={[{ value: 'all', label: 'Status' }, { value: 'completed', label: 'Completed' }, { value: 'active', label: 'Generating / Queued' }, { value: 'failed', label: 'Failed' }]} onValueChange={(status) => onChange({ ...value, status: status as VoiceoverStatus })} />
      <DropdownMenu.Root>
        <AppTooltip content={`Date: ${{ all: 'Any time', today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', custom: 'Custom range' }[quickDateMode(value)]}`}>
          <DropdownMenu.Trigger className="icon-btn ml-auto size-7 shrink-0" aria-label="Filter by date range">
            <CalendarDays size={15} aria-hidden="true" />
          </DropdownMenu.Trigger>
        </AppTooltip>
        <DropdownMenu.Portal>
          <DropdownMenu.Positioner side="bottom" align="end" sideOffset={4} className="dropdown-menu-positioner">
            <DropdownMenu.Popup className="dropdown-menu-content">
              <DropdownMenu.RadioGroup value={quickDateMode(value)} onValueChange={changeDate}>
                {[['all', 'Any time'], ['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']].map(([mode, label]) => (
                  <DropdownMenu.RadioItem key={mode} value={mode} className="dropdown-menu-radio-item dropdown-select-item">
                    <DropdownMenu.RadioItemIndicator className="dropdown-menu-indicator"><CheckIcon size={12} /></DropdownMenu.RadioItemIndicator>
                    {label}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Popup>
          </DropdownMenu.Positioner>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
