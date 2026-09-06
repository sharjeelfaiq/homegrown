import { useEffect, useRef, useState } from 'react'

/** Window-wide audio-file drop target.
 *
 * Replaces a `.dropzone`-classed <label> that had no drop handler at all --
 * it looked droppable and silently wasn't, which is worse than not offering
 * it. Now the whole window accepts the file, so there is nothing to aim at.
 *
 * dragenter/dragleave fire constantly as the pointer crosses child elements,
 * so a naive boolean flickers. Counting enter/leave pairs is the standard
 * fix: depth only returns to zero when the cursor genuinely leaves the window.
 *
 * Returns whether a drag is currently over the window, for the overlay. */
export function useFileDrop(onFile: (file: File) => void): boolean {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const cb = useRef(onFile)
  cb.current = onFile

  useEffect(() => {
    function hasFiles(e: DragEvent): boolean {
      return Array.from(e.dataTransfer?.types ?? []).includes('Files')
    }

    function onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current += 1
      setOver(true)
    }

    function onDragOver(e: DragEvent) {
      if (!hasFiles(e)) return
      // Without preventDefault here the browser navigates to the dropped file
      // and the whole app unloads.
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }

    function onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    }

    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      // Accept by MIME type where the OS provides one, and fall back to the
      // extension -- Windows hands over an empty type for some formats.
      const named = /\.(wav|mp3|m4a|flac|ogg|opus|webm|aac)$/i.test(file.name)
      if (file.type.startsWith('audio/') || named) cb.current(file)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  return over
}
