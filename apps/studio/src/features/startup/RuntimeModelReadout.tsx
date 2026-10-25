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
  const modelValue = loading ? 'Loading…' : unavailable ? 'Unavailable' : health?.voice_model || 'Unavailable'
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
    <aside className="runtime-model-readout" aria-label="Runtime model and device">
      <div className="runtime-model-readout-item">
        <span className="runtime-model-readout-label">Voice model</span>
        <span className="runtime-model-readout-value">{modelValue}</span>
      </div>
      {modelLoaded && health?.custom_voice_model && (
        <div className="runtime-model-readout-item">
          <span className="runtime-model-readout-label">Custom voice model</span>
          <span className="runtime-model-readout-value">{health?.custom_voice_model}</span>
        </div>
      )}
      <div className="runtime-model-readout-item">
        <span className="runtime-model-readout-label">Compute device</span>
        <span className="runtime-model-readout-value">{deviceValue}</span>
      </div>
    </aside>
  )
}
