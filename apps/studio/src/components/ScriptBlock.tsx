import { useEffect, useRef, type RefObject } from 'react'
import { getEstimate, type Estimate, type Preset } from '../api'
import { MAX_SCRIPT_CHARS } from '../constants'
import VoicePicker from './VoicePicker'
import { UploadIcon } from './Icons'

interface Props {
  text: string
  onTextChange: (text: string) => void
  /** Focused by the "/" shortcut. */
  textareaRef?: RefObject<HTMLTextAreaElement | null>
  /** Chunking depends on the voice, so the estimate has to be re-fetched when
   * it changes -- not only when the text does. */
  presetId: string | null
  onEstimate?: (estimate: Estimate | null) => void
  presets: Preset[]
  onSelectVoice: (presetId: string | null) => void
  onRenameVoice: (id: string, name: string, opts?: { unloading?: boolean }) => Promise<void>
  onDeleteVoice: (id: string, adminPassword: string) => Promise<void>
  voicesLoading: boolean
  creatingVoice: boolean
  onAddVoice: (file: File) => void
}

export default function ScriptBlock({
  text,
  onTextChange,
  textareaRef,
  presetId,
  onEstimate,
  presets,
  onSelectVoice,
  onRenameVoice,
  onDeleteVoice,
  voicesLoading,
  creatingVoice,
  onAddVoice,
}: Props) {
  const overLimit = text.length > MAX_SCRIPT_CHARS
  const voiceUploadRef = useRef<HTMLInputElement>(null)

  // The estimate is not displayed. onEstimate feeds StudioShell's
  // long-reference-clip warning; the backend calculation also keeps the
  // generated job's chunk count aligned with the pre-flight result. Deleting
  // this request removes the warning path.
  useEffect(() => {
    if (text.trim().length === 0 || overLimit) {
      onEstimate?.(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      getEstimate(text, presetId)
        .then((r) => {
          if (cancelled) return
          onEstimate?.(r)
        })
        .catch(() => {
          if (cancelled) return
          onEstimate?.(null)
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // onEstimate is intentionally excluded: it is a fresh closure each render
    // and would re-fire this request on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, overLimit, presetId])

  const trimmed = text.trim()
  const words = trimmed ? trimmed.split(/\s+/).length : 0

  return (
    // The card owns the focus treatment so the textarea and its footer read as
    // one editor; the theme-aware hairline is defined in index.css.
    <div className="script-editor grid h-[clamp(272px,36svh,372px)] min-h-[clamp(272px,36svh,372px)] max-h-[clamp(272px,36svh,372px)] grid-rows-[minmax(0,1fr)_auto] overflow-visible rounded-md border border-hairline bg-surface-card transition-[border-color] duration-(--base) ease-(--ease)" data-tour="script-editor">
      {/* The stable 272–372px editor range leaves a predictable writing area
          while the grid reserves a separate footer row for its controls. */}
      <textarea
        ref={textareaRef}
        className="block h-full min-h-0 w-full resize-none overflow-y-auto border-none bg-transparent px-[18px] pt-3.5 pb-3 text-[15px]/[1.7] outline-none placeholder:text-faint"
        placeholder="Write what the voice should say…"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        // The visible cap lives on the Script heading, not in here: a cap
        // inside the box overlapped the first line of text (measured: cap
        // 11-29px, line one 15-40.5px, and a long line reaches under it).
        aria-keyshortcuts="/"
      />


      <footer className="script-editor-footer">
        <span className={`mono text-[11px] whitespace-nowrap ${overLimit ? 'text-danger' : 'text-faint'}`}>
          {words.toLocaleString()} word{words === 1 ? '' : 's'}
        </span>
        <div className="script-voice-setting" data-tour="voice-controls">
          <span className="script-voice-label">Voice</span>
          <div data-tour="voice-picker">
            <VoicePicker
              presets={presets}
              selectedPresetId={presetId}
              onSelect={onSelectVoice}
              onRename={onRenameVoice}
              loading={voicesLoading}
              onDelete={onDeleteVoice}
            />
          </div>
          <input
            ref={voiceUploadRef}
            type="file"
            accept="audio/*"
            className="hidden"
            disabled={creatingVoice}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onAddVoice(file)
            }}
          />
          <button
            type="button"
            className="icon-btn size-8 flex-none border border-control bg-control-fill text-muted hover:border-audio-line hover:bg-control-fill-hover hover:text-audio"
            aria-label={creatingVoice ? 'Uploading voice' : 'Upload a voice'}
            aria-busy={creatingVoice}
            disabled={creatingVoice}
            data-tour="add-voice"
            title={creatingVoice ? 'Uploading voice' : 'Upload a voice'}
            onClick={() => voiceUploadRef.current?.click()}
          >
            {creatingVoice ? (
              <span className="size-3.5 rounded-full border-2 border-progress-line border-t-progress animate-boot-spin" aria-hidden="true" />
            ) : (
              <UploadIcon size={15} />
            )}
          </button>
        </div>
      </footer>
    </div>
  )
}
