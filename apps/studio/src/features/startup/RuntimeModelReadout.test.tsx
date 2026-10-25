// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { HealthResponse } from '../../lib/api'
import RuntimeModelReadout from './RuntimeModelReadout'

const readyHealth: HealthResponse = {
  model_loaded: true,
  generation_ready: true,
  sample_rate: 24000,
  device: 'cuda',
  device_reason: 'NVIDIA GeForce GTX 970 (sm_52)',
}

afterEach(cleanup)

describe('RuntimeModelReadout', () => {
  it('shows a generic ready state and the active graphics card without model details', () => {
    render(<RuntimeModelReadout health={readyHealth} loading={false} />)

    expect(screen.getByText('Voice engine')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('NVIDIA GeForce GTX 970')).toBeInTheDocument()
    expect(screen.queryByText(/sm_52/)).not.toBeInTheDocument()
  })

  it('shows the CPU when the backend selected its CPU fallback', () => {
    render(<RuntimeModelReadout health={{ ...readyHealth, model_loaded: false, generation_ready: false, device: 'cpu', device_reason: 'No usable GPU' }} loading={false} />)

    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })

  it('never displays model names or model-type clues', () => {
    const { container } = render(<RuntimeModelReadout health={readyHealth} loading={false} />)
    expect(container).not.toHaveTextContent(/Qwen|custom voice model/i)
  })

  it('uses loading and unavailable labels instead of stale runtime details', () => {
    const { rerender } = render(<RuntimeModelReadout health={null} loading />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.getByText('Detecting…')).toBeInTheDocument()

    rerender(<RuntimeModelReadout health={{
      ...readyHealth,
      model_loaded: false,
      generation_ready: false,
    }} loading={false} />)
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByText('NVIDIA GeForce GTX 970')).toBeInTheDocument()
  })

  it('reports model download progress while the engine is initializing', () => {
    render(<RuntimeModelReadout
      health={null}
      loading
      progress={{ phase: 'downloading', detail: '1.0 GB of 2.5 GB', percent: 42 }}
    />)

    expect(screen.getByText('Downloading 42%')).toBeInTheDocument()
    expect(screen.getByText('Detecting…')).toBeInTheDocument()
  })
})
