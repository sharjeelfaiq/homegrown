// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import RecordDetailsModal from './RecordDetailsModal'
import type { HistoryEntry, Preset } from '../../lib/api'

vi.mock('../../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => true }))
afterEach(cleanup)

const voice: Preset = { id: 'voice', name: 'Narrator', language: 'English', ref_text: '', audio_path: '', tag: '', preview_url: '', created_at: 0 }
const voiceover: HistoryEntry = { id: 'entry', preset_id: 'voice', preset_name: 'Narrator', text: '', language: 'English', style: 'natural', stability: 'balanced', audio_url: '/audio/entry.mp3', duration_s: 10, generation_s: null, created_at: 0 }

it('shows missing legacy timing explicitly and preserves a measured zero', () => {
  const { rerender } = render(<RecordDetailsModal kind="voice" record={voice} onClose={vi.fn()} />)
  expect(screen.getByText('Cloning time').nextElementSibling).toHaveTextContent('Not recorded')
  rerender(<RecordDetailsModal kind="voice" record={{ ...voice, cloning_s: 0 }} onClose={vi.fn()} />)
  expect(screen.getByText('Cloning time').nextElementSibling).toHaveTextContent('0 seconds')
})

it.each([99, 100, 101])('shows the correct preview for a %i-character script without changing the record', (length) => {
  const text = 'a'.repeat(Math.min(length, 100)) + (length > 100 ? 'Z' : '')
  const record = { ...voiceover, text }
  render(<RecordDetailsModal kind="voiceover" record={record} name="Voiceover 1" onClose={vi.fn()} />)
  const preview = screen.getByText('Script').nextElementSibling
  expect(preview?.textContent).toBe(length > 100 ? `${'a'.repeat(100)}\u2026` : text)
  expect(preview?.textContent).not.toContain('Z')
  expect(record.text).toBe(text)
})

it('preserves missing and zero generation times', () => {
  const { rerender } = render(<RecordDetailsModal kind="voiceover" record={voiceover} name="Voiceover 1" onClose={vi.fn()} />)
  expect(screen.getByText('Generation time').nextElementSibling).toHaveTextContent('Not recorded')
  rerender(<RecordDetailsModal kind="voiceover" record={{ ...voiceover, generation_s: 0 }} name="Voiceover 1" onClose={vi.fn()} />)
  expect(screen.getByText('Generation time').nextElementSibling).toHaveTextContent('0 seconds')
})

it('renders no dialog for either missing record', () => {
  const { rerender } = render(<RecordDetailsModal kind="voice" record={null} onClose={vi.fn()} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  rerender(<RecordDetailsModal kind="voiceover" record={null} name="Voiceover 1" onClose={vi.fn()} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
