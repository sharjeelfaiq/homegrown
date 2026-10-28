// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HistoryRowHead from './HistoryRowHead'

afterEach(cleanup)

describe('completed voiceover row heading', () => {
  it('places the formatted timestamp beside the row name without showing the selected voice', () => {
    const timestamp = 1_782_000_000
    const { container } = render(
      <HistoryRowHead
        number={4}
        name="Voiceover 4"
        onCommitRename={vi.fn()}
        timestamp={timestamp}
        timestampTitle="Generated full date"
        nameTitle="Created recently"
      />,
    )

    const stamp = container.querySelector('time.result-stamp')
    const header = container.firstElementChild
    expect(stamp).not.toBeNull()
    expect(header?.contains(stamp)).toBe(true)
    expect(stamp?.getAttribute('datetime')).toBe(new Date(timestamp * 1000).toISOString())
    expect(header?.textContent).not.toContain('Selected voice')
    expect(header?.classList.contains('min-h-[26px]')).toBe(true)
    expect(header?.classList.contains('history-row-head')).toBe(true)
    expect(container.querySelector('.history-row-meta time.result-stamp')).toBe(stamp)
  })

  it('keeps the editable name in a fixed-width slot before the script preview', () => {
    const { container, getByText } = render(
      <HistoryRowHead
        number={4}
        name="A longer voiceover name"
        onCommitRename={vi.fn()}
        nameTitle="Created recently"
        scriptPreview={<span>Sample transcript</span>}
      />,
    )

    expect(container.querySelector('.history-name-script')).not.toBeNull()
    expect(container.querySelector('.history-row-head')).not.toBeNull()
    expect(container.querySelector('.history-row-script')).not.toBeNull()
    expect(container.querySelector('.history-row-meta')).not.toBeNull()
    expect(container.querySelector('.history-row-script')?.textContent).toContain('Sample transcript')
    expect(getByText('-')).toBeTruthy()
    expect(getByText('Sample transcript')).toBeTruthy()
  })
})
