import type { HealthResponse } from '../../lib/api'
import type { BootStatus } from './useBootStatus'

interface Props {
  health: HealthResponse | null
  loading: boolean
  progress?: BootStatus | null
}

function graphicsCardName(deviceReason?: string): string | null {
  const name = deviceReason?.replace(/\s+\(sm_\d+\)\s*$/i, '').trim()
  return name || null
}

export default function RuntimeModelReadout({ health, loading, progress }: Props) {
  const modelLoaded = health?.generation_ready === true
  const engineValue = modelLoaded
    ? 'Ready'
    : progress?.phase === 'downloading'
      ? `Downloading${progress.percent == null ? '…' : ` ${progress.percent}%`}`
      : progress?.phase === 'probing_gpu'
        ? 'Checking device…'
        : progress?.phase === 'importing'
          ? 'Preparing…'
          : loading || progress?.phase === 'starting' || progress?.phase === 'loading_model'
            ? 'Loading…'
            : 'Unavailable'
  const deviceValue = health?.device === 'cpu'
    ? 'CPU'
    : /^cuda(?::|$)/i.test(health?.device ?? '')
      ? graphicsCardName(health?.device_reason) ?? 'Graphics card unavailable'
      : health?.device_ready === false || (!health && loading)
        ? 'Detecting…'
        : 'Compute device unavailable'

  return (
    <aside className="runtime-model-readout" aria-label="Voice engine and compute device">
      <div className="runtime-model-readout-item">
        <span className="runtime-model-readout-label">Voice engine</span>
        <span className="runtime-model-readout-value">{engineValue}</span>
      </div>
      <div className="runtime-model-readout-item">
        <span className="runtime-model-readout-label">Compute device</span>
        <span className="runtime-model-readout-value">{deviceValue}</span>
      </div>
    </aside>
  )
}
