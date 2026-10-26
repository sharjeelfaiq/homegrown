// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import RecordDetailsModal from './RecordDetailsModal'
import type { Preset } from '../../lib/api'

vi.mock('../../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => true }))
afterEach(cleanup)

const voice: Preset = { id: 'voice', name: 'Narrator', language: 'English', ref_text: '', audio_path: '', tag: '', preview_url: '', created_at: 0 }

it('shows missing legacy timing explicitly and preserves a measured zero', () => {
  const { rerender } = render(<RecordDetailsModal kind="voice" record={voice} onClose={vi.fn()} />)
  expect(screen.getByText('Cloning time').nextElementSibling).toHaveTextContent('Not recorded')
  rerender(<RecordDetailsModal kind="voice" record={{ ...voice, cloning_s: 0 }} onClose={vi.fn()} />)
  expect(screen.getByText('Cloning time').nextElementSibling).toHaveTextContent('0 seconds')
})
