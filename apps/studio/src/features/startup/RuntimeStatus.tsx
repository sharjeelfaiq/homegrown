import { useEffect, useState } from 'react'
import type { HealthResponse } from '../../lib/api'
import type { BootStatus } from './useBootStatus'
import './RuntimeStatus.css'

type ModelStatus = 'checking' | 'ready' | 'down'

interface Props {
  boot: BootStatus | null
  modelStatus: ModelStatus
  health: HealthResponse | null
  backendLost: boolean
}


export default function RuntimeStatus({ boot, modelStatus, health, backendLost }: Props) {
  const [cachedDeviceName, setCachedDeviceName] = useState(() => {
    try { return localStorage.getItem('homegrown.compute-device-name') } catch { return null }
  })
  const currentDeviceName = health?.device_name || (health?.device?.startsWith('cuda')
    ? health.device_reason?.replace(/\s*\(sm_\d+\)$/, '')
    : health?.device === 'cpu' ? 'CPU' : null)
  useEffect(() => {
    if (!currentDeviceName) return
    setCachedDeviceName(currentDeviceName)
    try { localStorage.setItem('homegrown.compute-device-name', currentDeviceName) } catch { /* Storage is optional. */ }
  }, [currentDeviceName])
  const phase = boot?.phase
  const unavailable = modelStatus === 'down' || phase === 'error' || backendLost
  const loaded = !unavailable && (modelStatus === 'ready' || health?.model_loaded === true)
  let modelState: string
  if (loaded) modelState = 'Active'
  else if (unavailable) modelState = 'Unavailable'
  else if (phase === 'downloading') modelState = `Downloading${boot?.percent == null ? '' : ` · ${boot.percent}%`}`
  else if (phase === 'starting' || !phase) modelState = 'Checking files'
  else if (phase === 'probing_gpu') modelState = 'Checking GPU'
  else if (phase === 'importing') modelState = 'Starting engine'
  else modelState = 'Loading model'

  const deviceName = health?.device?.startsWith('cuda')
    ? 'GPU'
    : health?.device === 'cpu'
      ? 'CPU'
      : null
  const deviceState = loaded
    ? 'Active'
    : unavailable
      ? 'Unavailable'
      : deviceName
        ? 'Initializing'
        : 'Detecting'
  const stateClass = loaded ? 'is-active' : unavailable ? 'is-unavailable' : 'is-loading'
  const progress = phase === 'downloading' ? boot?.percent : null

  return (
    <div className="runtime-status" aria-label="Voice model and compute status" aria-live="polite">
      <div className="runtime-status-item">
        <span className="runtime-status-label">Voice model</span>
        <span className={`runtime-status-value ${stateClass}`}>
          <i aria-hidden="true" />{modelState}
        </span>
        {progress != null && <div className="runtime-status-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>}
      </div>
      <div className="runtime-status-item">
        <span className="runtime-status-name">{currentDeviceName || cachedDeviceName || 'Detecting hardware'}</span>
        <span className={`runtime-status-value ${stateClass}`}>
          <i aria-hidden="true" />{deviceState}
        </span>
      </div>
    </div>
  )
}
