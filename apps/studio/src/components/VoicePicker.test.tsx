// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VoicePicker from './VoicePicker'
import type { Preset } from '../api'

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: { ul: 'ul' },
}))

vi.mock('../hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => false,
}))

vi.mock('../AudioActivityContext', () => ({
  useAudioActivity: () => ({ setActiveAudio: vi.fn(), releaseAudio: vi.fn() }),
}))

vi.mock('../GenerationActivityContext', () => ({
  useGenerationActivity: () => ({ runningPresetIds: new Set<string>() }),
}))

vi.mock('./AdminPasswordModal', () => ({ default: () => null }))
vi.mock('./InlineName', () => ({
  default: ({ value }: { value: string }) => <span>{value}</span>,
}))

const presets: Preset[] = [
  { id: 'ada', name: 'Ada', language: 'English', ref_text: '', audio_path: '', tag: '', is_builtin: false, preview_url: '', created_at: 1 },
  { id: 'bruno', name: 'Bruno', language: 'English', ref_text: '', audio_path: '', tag: '', is_builtin: false, preview_url: '', created_at: 2 },
]

afterEach(cleanup)

function renderPicker(onSelect = vi.fn()) {
  return render(
    <VoicePicker
      presets={presets}
      selectedPresetId={null}
      onSelect={onSelect}
      onRename={vi.fn()}
      onDelete={vi.fn(async () => {})}
    />,
  )
}

describe('VoicePicker search', () => {
  it('shows the search input only while the menu is open', () => {
    renderPicker()
    expect(screen.queryByRole('searchbox', { name: 'Search cloned voices' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select voice' }))
    expect(screen.getByRole('searchbox', { name: 'Search cloned voices' })).toBeInTheDocument()
  })

  it('filters voices case-insensitively and keeps matching rows selectable', () => {
    const onSelect = vi.fn()
    renderPicker(onSelect)
    fireEvent.click(screen.getByRole('button', { name: 'Select voice' }))

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search cloned voices' }), { target: { value: 'BRU' } })
    expect(screen.getByRole('option', { name: /Bruno/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Ada/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('option', { name: /Bruno/ }))
    expect(onSelect).toHaveBeenCalledWith('bruno')
  })

  it('shows a no-results message and clears the query when reopened', () => {
    renderPicker()
    fireEvent.click(screen.getByRole('button', { name: 'Select voice' }))
    const search = screen.getByRole('searchbox', { name: 'Search cloned voices' })
    fireEvent.change(search, { target: { value: 'missing' } })
    expect(screen.getByText('No matching voices.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Select voice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select voice' }))
    expect(screen.getByRole('searchbox', { name: 'Search cloned voices' })).toHaveValue('')
    expect(screen.getByRole('option', { name: /Ada/ })).toBeInTheDocument()
  })
})
