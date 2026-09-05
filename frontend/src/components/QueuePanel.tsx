import { useState } from 'react'
import { createPortal } from 'react-dom'
import { cancelQueuedJob, deleteQueueJob, reorderQueue } from '../api'
import { useGenerationActivity } from '../GenerationActivityContext'
import { formatDuration } from '../format'
import { useOptimisticProgress } from '../hooks/useOptimisticProgress'
import { TrashIcon } from './Icons'

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Processing',
  canceling: 'Canceling...',
  error: 'Failed',
  canceled: 'Canceled',
}

/** "Currently Generating" -- the single job on the GPU right now, with anything
 * waiting behind it collapsed underneath.
 *
 * Only one job can generate at a time (one worker thread, one _gen_lock), so
 * this shows exactly one full row. Completed jobs are deliberately NOT shown:
 * they land in Generations, and rendering them here too listed every finished
 * voiceover twice. Failed and canceled jobs DO stay, because they never reach
 * history and would otherwise vanish without explanation.
 *
 * Renders nothing when there is no active, queued or failed work. */
export default function QueuePanel() {
  const { queue, refresh } = useGenerationActivity()
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

  const active = queue.find((e) => e.status === 'running' || e.status === 'canceling')
  const queued = queue.filter((e) => e.status === 'queued')
  const failed = queue.filter((e) => e.status === 'error' || e.status === 'canceled')

  // Before the early return below -- hooks cannot be called conditionally.
  // chunks_done only moves when a whole chunk lands, so the raw ratio sits
  // still and then jumps; this predicts the gap from elapsed time.
  const percent = useOptimisticProgress(active)

  if (!active && queued.length === 0 && failed.length === 0) return null

  const queuedIds = queued.map((e) => e.job_id)

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Currently Generating</h2>
        {queued.length > 0 && <span className="count-badge mono">{queued.length} waiting</span>}
      </div>

      {active ? (
        <div className="generating-row">
          <div className="queue-row-top">
            <div className="queue-row-title">
              <strong>{active.preset_name}</strong>
              <span className={`badge-pill queue-status-${active.status}`}>
                {STATUS_LABELS[active.status] ?? active.status}
              </span>
            </div>
            <div className="row-top-right">
              <span className="list-meta mono">
                {active.status === 'canceling'
                  ? `stopping after chunk ${active.chunks_done}/${active.total_chunks}...`
                  : `${active.chunks_done}/${active.total_chunks} chunks -- ~${formatDuration(active.eta_s)} left`}
              </span>
              <button
                type="button"
                className="icon-btn icon-btn-danger"
                aria-label="Cancel generation"
                disabled={active.status === 'canceling'}
                onClick={() => setConfirmingCancelId(active.job_id)}
              >
                <TrashIcon size={14} />
              </button>
            </div>
          </div>

          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Generating ${active.preset_name}`}
          >
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>

          <p className="queue-text">{active.text_preview}</p>
        </div>
      ) : (
        <p className="empty-hint">Waiting for the next job to start...</p>
      )}

      {queued.length > 0 && (
        <ul className="queue-compact">
          {queued.map((entry, idx) => (
            <li key={entry.job_id} className="queue-compact-row">
              <span className="queue-compact-pos mono">{idx + 1}</span>
              <span className="queue-compact-name">{entry.preset_name}</span>
              <span className="list-meta mono">
                {entry.eta_s != null && `~${formatDuration(entry.eta_s)} until start`}
              </span>
              <span className="queue-compact-actions">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Move up in queue"
                  disabled={idx <= 0}
                  onClick={() => moveQueued(queuedIds, entry.job_id, -1)}
                >
                  ^
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Move down in queue"
                  disabled={idx >= queuedIds.length - 1}
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
              </span>
            </li>
          ))}
        </ul>
      )}

      {failed.length > 0 && (
        <ul className="queue-compact">
          {failed.map((entry) => (
            <li key={entry.job_id} className="queue-compact-row">
              <span className={`badge-pill queue-status-${entry.status}`}>
                {STATUS_LABELS[entry.status] ?? entry.status}
              </span>
              <span className="queue-compact-name">{entry.preset_name}</span>
              <span className="list-meta">{entry.error ?? 'canceled'}</span>
              <span className="queue-compact-actions">
                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  aria-label="Dismiss job"
                  onClick={() => handleDelete(entry.job_id)}
                >
                  <TrashIcon size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

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
