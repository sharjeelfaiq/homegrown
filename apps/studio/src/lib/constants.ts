/** How long a destructive action is held behind its Undo toast.
 *
 * Shared rather than per-component: a voiceover delete in HistoryList, a voice
 * delete in StudioShell, and UndoCountdown drawing its depleting ring from the
 * same number. Copies of 7000 would drift the first time anyone retuned the
 * window.
 *
 * Deletes only. Queue cancellation is deliberately NOT held behind this window
 * -- a confirmed cancel is sent immediately (HistoryList.handleCancel), because
 * a job that keeps generating for seven more seconds has already spent the GPU
 * time the user asked to stop. */
export const UNDO_MS = 7000
