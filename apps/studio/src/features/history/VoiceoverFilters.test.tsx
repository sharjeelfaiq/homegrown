// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import VoiceoverFilters, { type VoiceoverFilterState } from './VoiceoverFilters'
import type { HistoryEntry, Preset } from '../../lib/api'

afterEach(cleanup)

function ControlledFilters() {
  const [filters, setFilters] = useState<VoiceoverFilterState>({ status: 'all' })
  const presets: Preset[] = [
    { id: 'clone-1', name: 'Cloned narrator', language: 'English', ref_text: '', audio_path: '', tag: '', preview_url: '', created_at: 1 },
    { id: 'old-builtin', name: 'Legacy speaker', language: 'English', ref_text: '', audio_path: '', tag: '', preview_url: '', created_at: 0, is_builtin: true },
  ]
  const history: HistoryEntry[] = [
    { id: 'old-history', preset_id: 'old-builtin', preset_name: 'Legacy speaker', preset_is_builtin: true, text: '', language: 'English', style: '', stability: '', audio_url: '', duration_s: 0, generation_s: null, created_at: 0 },
    { id: 'current-history', preset_id: 'old-clone', preset_name: 'Previous clone', text: '', language: 'English', style: '', stability: '', audio_url: '', duration_s: 0, generation_s: null, created_at: 0 },
  ]
  return <VoiceoverFilters presets={presets} history={history} value={filters} onChange={setFilters} />
}

describe('VoiceoverFilters', () => {
  it('keeps legacy built-ins out of voice choices while retaining historical cloned voices', () => {
    render(<ControlledFilters />)
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Filter by voice' }))
    expect(screen.queryByRole('menuitemradio', { name: 'Legacy speaker' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'Cloned narrator' })).toBeInTheDocument()
    expect(screen.getByRole('menuitemradio', { name: 'Previous clone' })).toBeInTheDocument()
  })

  it('lays the four standard filters out as two equal columns in reading order', () => {
    render(<ControlledFilters />)
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))

    const dialog = screen.getByRole('dialog', { name: 'Voiceover filters' })
    expect(dialog.querySelector('.grid.grid-cols-2')).not.toBeNull()
    for (const label of ['Voice', 'Date range', 'Duration', 'Generation status']) {
      expect(screen.getByText(label).closest('label')?.className).not.toContain('col-span-2')
    }
  })

  it('applies a portal menu selection and keeps the filter popover open until clicked away', () => {
    render(<ControlledFilters />)

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Filter by generation status' }))
    fireEvent.mouseDown(screen.getByRole('menuitemradio', { name: 'Failed' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Failed' }))

    expect(screen.getByRole('dialog', { name: 'Voiceover filters' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters (1 active)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Voiceover filters' })).not.toBeInTheDocument()
  })
})
