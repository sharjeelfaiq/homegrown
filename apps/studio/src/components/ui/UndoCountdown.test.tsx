// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UNDO_MS } from '../../lib/constants'
import UndoCountdown from './UndoCountdown'

vi.mock('./StatusMark', () => ({ default: ({ status, progress }: { status: string; progress?: number }) => (
  <span data-testid="mark" data-status={status} data-progress={progress} />
) }))

afterEach(() => { cleanup(); vi.useRealTimers() })

it('depletes the shared status ring against the actual Undo deadline and morphs to success', () => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  const { rerender, unmount } = render(<UndoCountdown deadline={UNDO_MS} />)
  expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Undo available for 7 seconds')
  expect(screen.getByTestId('mark')).toHaveAttribute('data-progress', '1')
  act(() => vi.advanceTimersByTime(3500))
  expect(screen.getByTestId('mark')).toHaveAttribute('data-progress', '0.5')
  // A throttled tab resumes from wall-clock time rather than its missed ticks.
  vi.setSystemTime(6000)
  act(() => vi.advanceTimersByTime(100))
  expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Undo available for 1 second')
  rerender(<UndoCountdown />)
  expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Deleting')
  expect(screen.getByTestId('mark')).not.toHaveAttribute('data-progress')
  rerender(<UndoCountdown status="done" />)
  expect(screen.getByTestId('mark')).toHaveAttribute('data-status', 'done')
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
