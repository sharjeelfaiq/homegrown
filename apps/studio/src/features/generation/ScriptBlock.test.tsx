// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ScriptBlock from './ScriptBlock'

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

afterEach(cleanup)

describe('ScriptBlock footer', () => {
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
