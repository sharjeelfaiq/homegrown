// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScriptBlock from './ScriptBlock'
import { MAX_SCRIPT_CHARS } from './constants'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

function renderScriptBlock() {
  return render(
    <ScriptBlock
      text=""
      onTextChange={vi.fn()}
      presetId={null}
      languages={['English', 'German']}
      language={null}
      onLanguageChange={vi.fn()}
      generateAction={<button type="button">Generate</button>}
    />,
  )
}

afterEach(() => { cleanup(); toastError.mockClear() })

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

function renderControlledScript(initialText = '') {
  const onTextChange = vi.fn()
  const view = render(
    <ScriptBlock
      text={initialText}
      onTextChange={onTextChange}
      presetId={null}
      languages={['English']}
      language={null}
      onLanguageChange={vi.fn()}
      generateAction={<button type="button">Generate</button>}
    />,
  )
  return { ...view, onTextChange }
}

describe('ScriptBlock footer', () => {
  it('starts with the Script textarea focused', () => {
    renderScriptBlock()
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Type or paste a script…'))
  })

  it('clears a non-empty script and disables the clear button when empty', () => {
    const { onTextChange } = renderControlledScript('Draft script')
    const clearButton = screen.getByRole('button', { name: 'Clear script' })
    expect(clearButton).toBeEnabled()
    fireEvent.click(clearButton)
    expect(onTextChange).toHaveBeenCalledWith('')

    cleanup()
    renderControlledScript('')
    expect(screen.getByRole('button', { name: 'Clear script' })).toBeDisabled()
  })

  it('contains only the supplied Generate action', () => {
    const { container } = renderScriptBlock()
    const footer = container.querySelector<HTMLElement>('.script-editor-footer')!
    expect(footer).toContainElement(screen.getByRole('button', { name: 'Generate' }))
    expect(footer.querySelector('.script-language-control')).toBeTruthy()
    expect(footer).toHaveTextContent('Select language')
  })

  it('closes the language options after a language is selected', async () => {
    const onLanguageChange = vi.fn()
    render(
      <ScriptBlock
        text=""
        onTextChange={vi.fn()}
        presetId={null}
        languages={['English', 'German']}
        language={null}
        onLanguageChange={onLanguageChange}
        generateAction={<button type="button">Generate</button>}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Script language' }))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'English' }))

    expect(onLanguageChange).toHaveBeenCalledWith('English')
    await waitFor(() => expect(screen.queryByRole('menuitemradio', { name: 'English' })).not.toBeInTheDocument())
  })
})

describe('ScriptBlock clipboard paste', () => {
  function setClipboardText(value: string) {
    const readText = vi.fn().mockResolvedValue(value)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText },
    })
    return readText
  }

  it('appends clipboard text when the textarea is not focused', async () => {
    setClipboardText(' pasted')
    const { onTextChange } = renderControlledScript('Script')
    ;(screen.getByPlaceholderText('Type or paste a script…') as HTMLTextAreaElement).blur()
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }))
    await waitFor(() => expect(onTextChange).toHaveBeenCalledWith('Script pasted'))
  })

  it('inserts at the caret and replaces selected text', async () => {
    setClipboardText('new')
    const { onTextChange } = renderControlledScript('say this now')
    const textarea = screen.getByPlaceholderText('Type or paste a script…') as HTMLTextAreaElement
    textarea.focus()
    textarea.setSelectionRange(4, 8)
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }))
    await waitFor(() => expect(onTextChange).toHaveBeenCalledWith('say new now'))
  })

  it('limits inserted text to the remaining script capacity', async () => {
    setClipboardText('abcdef')
    const { onTextChange } = renderControlledScript('x'.repeat(MAX_SCRIPT_CHARS - 2))
    ;(screen.getByPlaceholderText('Type or paste a script…') as HTMLTextAreaElement).blur()
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }))
    await waitFor(() => expect(onTextChange).toHaveBeenCalledTimes(1))
    expect(onTextChange.mock.calls[0][0]).toHaveLength(MAX_SCRIPT_CHARS)
    expect(onTextChange.mock.calls[0][0].endsWith('ab')).toBe(true)
  })

  it('shows a toast when clipboard access is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    renderControlledScript('Script')
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Clipboard access is unavailable')))
    expect(screen.queryByRole('dialog', { name: 'Clipboard access' })).not.toBeInTheDocument()
  })

  it('triggers one browser clipboard read from the click and shows a toast if permission is denied', async () => {
    const readText = setClipboardText('')
    readText.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'))
    renderControlledScript('Script')
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }))
    await waitFor(() => expect(readText).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Allow Clipboard for this site')))
    expect(screen.queryByRole('dialog', { name: 'Clipboard access' })).not.toBeInTheDocument()
  })
})
