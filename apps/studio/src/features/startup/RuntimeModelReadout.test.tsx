// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { HealthResponse } from '../../lib/api'
import RuntimeModelReadout from './RuntimeModelReadout'

const readyHealth: HealthResponse = {
  model_loaded: true,
  sample_rate: 24000,
  voice_model: 'Qwen/Qwen3-TTS-12Hz-0.6B-Base',
  device: 'cuda',
  device_reason: 'NVIDIA GeForce GTX 970 (sm_52)',
}

afterEach(cleanup)

describe('RuntimeModelReadout', () => {
  it('shows the loaded voice model and active graphics card without CUDA details', () => {
    render(<RuntimeModelReadout health={readyHealth} loading={false} />)

    expect(screen.getByText('Qwen/Qwen3-TTS-12Hz-0.6B-Base')).toBeInTheDocument()
    expect(screen.getByText('NVIDIA GeForce GTX 970')).toBeInTheDocument()
    expect(screen.queryByText(/sm_52/)).not.toBeInTheDocument()
  })

  it('shows the CPU when the backend selected its CPU fallback', () => {
    render(<RuntimeModelReadout health={{ ...readyHealth, device: 'cpu', device_reason: 'No usable GPU' }} loading={false} />)

    expect(screen.getByText('CPU')).toBeInTheDocument()
  })

  it('shows the custom voice model only when the health response reports one', () => {
    const { rerender } = render(<RuntimeModelReadout health={readyHealth} loading={false} />)
    expect(screen.queryByText('Custom voice model')).not.toBeInTheDocument()

    rerender(<RuntimeModelReadout health={{ ...readyHealth, custom_voice_model: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice' }} loading={false} />)
    expect(screen.getByText('Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice')).toBeInTheDocument()
  })

  it('uses loading and unavailable labels instead of stale runtime details', () => {
    const { rerender } = render(<RuntimeModelReadout health={null} loading />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.getByText('Detecting…')).toBeInTheDocument()

    rerender(<RuntimeModelReadout health={{
      ...readyHealth,
      model_loaded: false,
      custom_voice_model: 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice',
    }} loading={false} />)
    expect(screen.getAllByText('Unavailable')).toHaveLength(2)
    expect(screen.queryByText('Qwen/Qwen3-TTS-12Hz-0.6B-Base')).not.toBeInTheDocument()
    expect(screen.queryByText('Custom voice model')).not.toBeInTheDocument()
  })
})
