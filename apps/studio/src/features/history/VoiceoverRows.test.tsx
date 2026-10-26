// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry, QueueEntry } from '../../lib/api'
import { PendingRow, VoiceoverRow } from './HistoryList'
import { VOICEOVER_ROW_GEOMETRY_CLASS } from './voiceoverRowLayout'
import type { NameControl } from './HistoryRowHead'

vi.mock('../../components/audio/VoiceoverPlayer', () => ({ default: () => <div className="completed-transport"><button aria-label="Play finished voiceover">Play</button><div className="result-bar" /></div> }))
vi.mock('../../components/ui/Tooltip', () => ({ AppTooltip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('../../hooks/usePrefersReducedMotion', () => ({ usePrefersReducedMotion: () => true }))

afterEach(cleanup)

const nameControl: NameControl = {
  number: 1,
  name: 'Voiceover 1',
  placeholder: 'Voiceover 1',
  onCommitRename: vi.fn(),
}

const queuedJob: QueueEntry = {
  job_id: 'job-1', preset_id: 'voice-1', preset_name: 'Narrator',
  text_preview: 'A sample script.', status: 'queued', chunks_done: 0,
  total_chunks: 3, elapsed_s: null, queue_position: 0, submitted_at: 1_700_000_000,
  audio_url: null, error: null,
}

const completedEntry: HistoryEntry = {
  id: 'entry-1', preset_id: 'voice-1', preset_name: 'Narrator',
  text: 'A sample script.', language: 'English', style: 'natural', stability: 'balanced',
  audio_url: '/audio/voiceover.mp3', duration_s: 10, generation_s: 2, created_at: 1_700_000_000,
}

function rowClasses() {
  return Array.from(document.querySelectorAll<HTMLLIElement>('li.group\\/row')).map((row) => row.className)
}

describe('voiceover row states', () => {
  it('keeps queued, generating, and completed rows at the same geometry while status changes', () => {
    const { rerender } = render(<PendingRow job={queuedJob} nameControl={nameControl} onCancel={vi.fn()} onMoveUp={vi.fn()} onMoveDown={vi.fn()} onReuse={vi.fn()} />)
    const queuedClass = rowClasses()[0]
    expect(queuedClass).toContain(VOICEOVER_ROW_GEOMETRY_CLASS)
    expect(queuedClass).toContain('is-queued')

    rerender(<PendingRow job={{ ...queuedJob, status: 'running', elapsed_s: 2 }} nameControl={nameControl} onCancel={vi.fn()} onReuse={vi.fn()} />)
    const runningClass = rowClasses()[0]
    expect(runningClass).toContain(VOICEOVER_ROW_GEOMETRY_CLASS)
    expect(runningClass).toContain('is-running')
    expect(runningClass.replace(' is-running', '')).toBe(queuedClass.replace(' is-queued', ''))

    rerender(<VoiceoverRow entry={completedEntry} nameControl={nameControl} name="Voiceover 1" downloadHref="/download" onDelete={vi.fn()} onRequeue={vi.fn()} animateExit={false} />)
    const completedClass = rowClasses()[0]
    expect(completedClass).toContain(VOICEOVER_ROW_GEOMETRY_CLASS)
    expect(completedClass.replace(' cursor-default', '')).toBe(runningClass.replace(' is-running', ''))
  })

  it('keeps each state’s playback/progress and state-appropriate actions', () => {
    const { rerender } = render(<PendingRow job={queuedJob} nameControl={nameControl} onCancel={vi.fn()} canMoveUp onMoveUp={vi.fn()} canMoveDown onMoveDown={vi.fn()} onReuse={vi.fn()} />)
    expect(screen.getByRole('progressbar', { name: 'Queued, not started' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move queued generation up' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    rerender(<PendingRow job={{ ...queuedJob, status: 'running', elapsed_s: 2 }} nameControl={nameControl} onCancel={vi.fn()} onReuse={vi.fn()} />)
    expect(screen.getByRole('progressbar', { name: 'Generating chunk 1 of 3' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move queued generation up' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    rerender(<VoiceoverRow entry={completedEntry} nameControl={nameControl} name="Voiceover 1" downloadHref="/download" onDelete={vi.fn()} onRequeue={vi.fn()} animateExit={false} />)
    expect(screen.getByRole('button', { name: 'Play finished voiceover' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download Voiceover 1' })).toHaveAttribute('href', '/download')
    expect(screen.getByRole('button', { name: 'More actions for Voiceover 1' })).toBeInTheDocument()
  })

  it('reuses transcripts from previews and only shows the overflow menu on completed rows', async () => {
    const reuse = vi.fn()
    const { rerender } = render(<PendingRow job={queuedJob} nameControl={nameControl} onCancel={vi.fn()} onReuse={reuse} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reuse transcript for Voiceover 1' }))
    expect(reuse).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'More actions for Voiceover 1' })).not.toBeInTheDocument()

    rerender(<PendingRow job={{ ...queuedJob, status: 'running', elapsed_s: 2 }} nameControl={nameControl} onCancel={vi.fn()} onReuse={reuse} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reuse transcript for Voiceover 1' }))
    expect(reuse).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'More actions for Voiceover 1' })).not.toBeInTheDocument()

    const onDelete = vi.fn()
    rerender(<VoiceoverRow entry={completedEntry} nameControl={nameControl} name="Voiceover 1" downloadHref="/download" onDelete={onDelete} onRequeue={reuse} animateExit={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reuse transcript for Voiceover 1' }))
    expect(reuse).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Voiceover 1' }))
    fireEvent.click(await screen.findByText('Delete'))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(reuse).toHaveBeenCalledTimes(3)
  })
})


it('opens completed voiceover details with generation time and full script', async () => {
  const reuse = vi.fn()
  render(<VoiceoverRow entry={completedEntry} nameControl={nameControl} name="My narration" downloadHref="/download" onDelete={vi.fn()} onRequeue={reuse} animateExit={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'More actions for My narration' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Details' }))
  const dialog = screen.getByRole('dialog', { name: 'Voiceover details' })
  expect(dialog).toHaveTextContent('My narration')
  expect(dialog).toHaveTextContent('Generation time2 seconds')
  expect(dialog).toHaveTextContent('A sample script.')
  expect(reuse).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
