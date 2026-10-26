// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import RuntimeStatus from './RuntimeStatus'

beforeEach(() => localStorage.clear())
afterEach(cleanup)

it('remembers the hardware name across mounts without persisting readiness', () => {
  const view = render(<RuntimeStatus boot={null} modelStatus="ready" backendLost={false} health={{ model_loaded: true, sample_rate: 24000, device: 'cuda', device_name: 'NVIDIA GeForce GTX 970' }} />)
  expect(screen.getByText('NVIDIA GeForce GTX 970')).toBeInTheDocument()
  expect(screen.getAllByText('Active')).toHaveLength(2)
  expect(screen.queryByText('Compute device')).not.toBeInTheDocument()
  view.unmount()

  render(<RuntimeStatus boot={null} modelStatus="checking" backendLost={false} health={null} />)
  expect(screen.getByText('NVIDIA GeForce GTX 970')).toBeInTheDocument()
  expect(screen.queryByText('Active')).not.toBeInTheDocument()
})

it('shows unavailable after a disconnect even if the last health response was ready', () => {
  render(<RuntimeStatus boot={null} modelStatus="checking" backendLost health={{ model_loaded: true, sample_rate: 24000, device: 'cpu', device_name: 'Example CPU' }} />)
  expect(screen.getAllByText('Unavailable')).toHaveLength(2)
  expect(screen.queryByText('Active')).not.toBeInTheDocument()
})
