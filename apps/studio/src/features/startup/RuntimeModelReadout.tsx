import type { HealthResponse } from '../../lib/api'

interface Props {
  health: HealthResponse | null
  loading: boolean
}

function graphicsCardName(deviceReason?: string): string | null {
  const name = deviceReason?.replace(/\s+\(sm_\d+\)\s*$/i, '').trim()
  return name || null
}

export default function RuntimeModelReadout({ health, loading }: Props) {
  const modelLoaded = health?.model_loaded === true
  const unavailable = !loading && !modelLoaded
  const engineValue = loading ? 'Loading…' : unavailable ? 'Unavailable' : 'Ready'
  const deviceValue = loading
    ? 'Detecting…'
    : unavailable
      ? 'Unavailable'
      : health?.device === 'cpu'
        ? 'CPU'
        : /^cuda(?::|$)/i.test(health?.device ?? '')
          ? graphicsCardName(health?.device_reason) ?? 'Graphics card unavailable'
          : 'Unavailable'

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
