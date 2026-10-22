import { describe, expect, it } from 'vitest'
import {
  formatToastDescription,
  formatToastMessage,
  formatToastTitle,
  formatTutorialMessage,
  TOAST_MESSAGE_MAX_CHARS,
  TUTORIAL_MESSAGE_MAX_CHARS,
} from './messageFormatting'

describe('Studio message formatting', () => {
  it('normalizes spacing and clips long tutorial messages without cutting a word', () => {
    const formatted = formatTutorialMessage(`  ${'Explain the workflow clearly. '.repeat(12)}  `)
    expect(formatted.length).toBeLessThanOrEqual(TUTORIAL_MESSAGE_MAX_CHARS)
    expect(formatted.endsWith('…')).toBe(true)
    expect(formatted).toMatch(/workflow…$/)
    expect(formatted).not.toContain('  ')
  })

  it('keeps useful error details and ordinary filenames within toast limits', () => {
    const filename = 'customer-reference-voice-2026.wav'
    const detail = `Could not process ${filename}: The audio stream contains no readable samples.`
    expect(formatToastDescription(detail)).toBe(detail)
    const longError = formatToastDescription(`${detail} ${'Retry after checking the source file. '.repeat(8)}`)
    expect(longError.length).toBeLessThanOrEqual(TOAST_MESSAGE_MAX_CHARS)
    expect(longError).toContain(filename)
    expect(longError.endsWith('…')).toBe(true)
  })

  it('caps toast titles and keeps action labels such as Undo unchanged', () => {
    expect(formatToastTitle('voiceover ready.')).toBe('Voiceover ready')
    expect(formatToastMessage('A '.repeat(100)).length).toBeLessThanOrEqual(TOAST_MESSAGE_MAX_CHARS)
    expect('Undo').toBe('Undo')
  })
})
