import { useState } from 'react'
import { createPortal } from 'react-dom'
import { cancelQueuedJob, deleteQueueJob, downloadUrl, mediaUrl, reorderQueue } from '../api'
import { useGenerationActivity } from '../GenerationActivityContext'
import { downloadName, formatDuration } from '../format'
import { usePersistedRecord } from '../hooks/usePersistedRecord'
import ClipPlayer from './ClipPlayer'
import { PencilIcon, TrashIcon } from './Icons'

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Processing',
  canceling: 'Canceling...',
  done: 'Done',
  error: 'Failed',
  canceled: 'Canceled',
}

/** Inline "Now generating" section fed by the shared queue poller.
 * Renders nothing while the queue is empty -- pending work sits directly
 * above the Generations list. */
export default function QueuePanel() {
  const { queue, refresh } = useGenerationActivity()
  const [entryFileNames, setFileName] = usePersistedRecord('queueFileNames')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(null)

  async function handleCancel(jobId: string) {
    try {
      await cancelQueuedJob(jobId)
    } finally {
      refresh()
    }
  }

  async function handleDelete(jobId: string) {
    try {
      await deleteQueueJob(jobId)
    } finally {
      refresh()
    }
  }

  async function moveQueued(queuedIds: string[], jobId: string, direction: -1 | 1) {
    const idx = queuedIds.indexOf(jobId)
    const swapWith = idx + direction
    if (idx < 0 || swapWith < 0 || swapWith >= queuedIds.length) return
    const reordered = [...queuedIds]
    ;[reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]]
    try {
      await reorderQueue(reordered)
    } finally {
      refresh()
    }
  }

  if (queue.length === 0) return null

  const running = queue.filter((e) => e.status === 'running')
  const queued = queue.filter((e) => e.status === 'queued')
  const finished = queue.filter((e) => e.status !== 'running' && e.status !== 'queued')
  const queuedIds = queued.map((e) => e.job_id)
  const ordered = [...running, ...queued, ...finished]

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Now generating</h2>
        <span className="count-badge mono">{queue.length}</span>
      </div>

      <ul className="queue-list">
        {ordered.map((entry) => {
          const queuedIdx = queuedIds.indexOf(entry.job_id)
          return (
            <li key={entry.job_id} className="queue-row">
              <div className="queue-row-top">
                <div className="queue-row-title">
                  <strong>{entryFileNames[entry.job_id]?.trim() || entry.preset_name}</strong>
                  <span className={`badge-pill queue-status-${entry.status}`}>
                    {STATUS_LABELS[entry.status] ?? entry.status}
                  </span>
                </div>
                <div className="row-top-right">
                  <span className="list-meta mono">
                    {entry.status === 'queued' &&
                      entry.eta_s != null &&
                      `~${formatDuration(entry.eta_s)} until start`}
                    {entry.status === 'running' &&
                      `${entry.chunks_done}/${entry.total_chunks} chunks -- ~${formatDuration(entry.eta_s)} left`}
                    {entry.status === 'canceling' &&
                      `stopping after chunk ${entry.chunks_done}/${entry.total_chunks}...`}
                    {entry.status === 'done' && `done in ${formatDuration(entry.elapsed_s)}`}
                    {entry.status === 'error' && 'failed'}
                    {entry.status === 'canceled' && 'canceled'}
                  </span>
                  {entry.audio_url && (
                    <div className="rename-group">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Rename download"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation()
                          setRenamingId((prev) => (prev === entry.job_id ? null : entry.job_id))
                        }}
                      >
                        <PencilIcon size={14} />
                      </button>
                      {renamingId === entry.job_id && (
                        <input
                          type="text"
                          autoFocus
                          className="rename-input"
                          placeholder="File name (leave blank to auto-name)"
                          value={entryFileNames[entry.job_id] ?? ''}
                          onChange={(e) => setFileName(entry.job_id, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={() => setRenamingId(null)}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter' || e.key === 'Escape') setRenamingId(null)
                          }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
              <p className="queue-text">{entry.text_preview}</p>
              {entry.error && <p className="error">{entry.error}</p>}
              {entry.audio_url && (
                <div className="list-actions">
                  <ClipPlayer
                    src={mediaUrl(entry.audio_url)}
                    durationS={null}
                    entryKey={entry.job_id}
                    label={`${entry.preset_name} clip`}
                  />
                  <a
                    href={downloadUrl(
                      entry.audio_url,
                      entryFileNames[entry.job_id]?.trim() || downloadName(entry.preset_name, entry.submitted_at),
                    )}
                    download
                    className="download-link"
                  >
                    Download
                  </a>
                </div>
              )}
              {entry.status === 'queued' && (
                <div className="queue-row-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Move up in queue"
                    disabled={queuedIdx <= 0}
                    onClick={() => moveQueued(queuedIds, entry.job_id, -1)}
                  >
                    ^
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Move down in queue"
                    disabled={queuedIdx < 0 || queuedIdx >= queuedIds.length - 1}
                    onClick={() => moveQueued(queuedIds, entry.job_id, 1)}
                  >
                    v
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    aria-label="Cancel queued job"
                    onClick={() => handleCancel(entry.job_id)}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              )}
              {entry.status === 'running' && (
                <div className="queue-row-actions">
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    aria-label="Cancel generation"
                    onClick={() => setConfirmingCancelId(entry.job_id)}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              )}
              {(entry.status === 'canceled' || entry.status === 'error') && (
                <div className="queue-row-actions">
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    aria-label="Delete job"
                    onClick={() => handleDelete(entry.job_id)}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/* Confirmation for canceling an in-progress generation -- unlike a
          queued job, this loses whatever chunk work is currently running. */}
      {confirmingCancelId && createPortal(
        <div className="modal-backdrop" onClick={() => setConfirmingCancelId(null)}>
          <div className="panel modal-confirm" onClick={(e) => e.stopPropagation()}>
            <p>Cancel this generation? Progress on the current chunk will be lost.</p>
            <div className="modal-actions">
              <button className="modal-btn-cancel" onClick={() => setConfirmingCancelId(null)}>
                Keep going
              </button>
              <button
                className="modal-btn-delete"
                onClick={() => {
                  handleCancel(confirmingCancelId)
                  setConfirmingCancelId(null)
                }}
              >
                Cancel generation
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}
