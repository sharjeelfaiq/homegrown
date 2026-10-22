// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useTypeToScript } from './useTypeToScript'

function Harness({ overlay }: { overlay?: 'dialog' | 'menu' }) {
  const [script, setScript] = useState('hello world')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useTypeToScript(textareaRef, script, setScript)
  return (
    <>
      <textarea aria-label="Script" ref={textareaRef} value={script} onChange={(event) => setScript(event.target.value)} />
      <input type="search" aria-label="Voice search" />
      <input type="search" aria-label="Voiceover search" />
      <input type="text" aria-label="Editable name" />
      <div contentEditable suppressContentEditableWarning aria-label="Editable text">Editable text</div>
      <button type="button">Action</button>
      <div data-testid="surface" tabIndex={-1}>Studio surface <svg data-testid="surface-icon" /></div>
      {overlay && <div role={overlay} aria-label="Open overlay" tabIndex={0}>Overlay</div>}
    </>
  )
}

afterEach(cleanup)

describe('useTypeToScript', () => {
  it('focuses Script and inserts at its saved selection, replacing selected text', () => {
    render(<Harness />)
    const textarea = screen.getByRole('textbox', { name: 'Script' }) as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(6, 11)
    const surface = screen.getByTestId('surface')
    surface.focus()
    fireEvent.keyDown(surface, { key: 'H', code: 'KeyH', shiftKey: true })

    expect(document.activeElement).toBe(textarea)
    expect(textarea.value).toBe('hello H')
    expect(textarea.selectionStart).toBe(7)
    expect(textarea.selectionEnd).toBe(7)
  })

  it('leaves native typing untouched once Script already has focus', () => {
    render(<Harness />)
    const textarea = screen.getByRole('textbox', { name: 'Script' }) as HTMLTextAreaElement
    textarea.focus()
    const event = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true })
    textarea.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(textarea)
  })

  it('handles typing when the event target is an SVG icon on a neutral surface', () => {
    render(<Harness />)
    fireEvent.keyDown(screen.getByTestId('surface-icon'), { key: 'x', code: 'KeyX' })

    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Script' }))
    expect((screen.getByRole('textbox', { name: 'Script' }) as HTMLTextAreaElement).value).toBe('xhello world')
  })

  it.each(['Voice search', 'Voiceover search', 'Editable name'])('does not steal focus from %s', (label) => {
    render(<Harness />)
    const input = screen.getByLabelText(label)
    input.focus()
    fireEvent.keyDown(input, { key: 'x', code: 'KeyX' })
    expect(document.activeElement).toBe(input)
    expect((screen.getByRole('textbox', { name: 'Script' }) as HTMLTextAreaElement).value).toBe('hello world')
  })

  it('preserves editing in contenteditable fields', () => {
    render(<Harness />)
    const editable = screen.getByLabelText('Editable text')
    editable.focus()
    fireEvent.keyDown(editable, { key: 'x', code: 'KeyX' })
    expect(document.activeElement).toBe(editable)

  })

  it('returns printable typing from a focused action button to Script', () => {
    render(<Harness />)
    const button = screen.getByRole('button', { name: 'Action' })
    button.focus()
    fireEvent.keyDown(button, { key: 'x', code: 'KeyX' })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Script' }))
    expect((screen.getByRole('textbox', { name: 'Script' }) as HTMLTextAreaElement).value).toBe('xhello world')
  })

  it.each([
    { key: 'x', ctrlKey: true },
    { key: 'x', metaKey: true },
    { key: 'x', altKey: true },
    { key: 'Shift' },
    { key: 'ArrowLeft' },
    { key: 'Enter' },
    { key: 'x', isComposing: true },
  ])('ignores non-text or modified keystrokes: %o', (init) => {
    render(<Harness />)
    const surface = screen.getByTestId('surface')
    surface.focus()
    fireEvent.keyDown(surface, init)
    expect(document.activeElement).toBe(surface)
    expect((screen.getByRole('textbox', { name: 'Script' }) as HTMLTextAreaElement).value).toBe('hello world')
  })

  it.each(['dialog', 'menu'] as const)('does not activate while a %s is open, even from the background', (overlay) => {
    render(<Harness overlay={overlay} />)
    const surface = screen.getByTestId('surface')
    surface.focus()
    fireEvent.keyDown(surface, { key: 'x', code: 'KeyX' })
    expect(document.activeElement).toBe(surface)
    expect((screen.getByRole('textbox', { name: 'Script' }) as HTMLTextAreaElement).value).toBe('hello world')
  })
})
