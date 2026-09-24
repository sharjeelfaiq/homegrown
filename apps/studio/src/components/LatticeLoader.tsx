import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

/** Token-coloured loading lattice; BootOverlay keeps the authoritative text and elapsed time. */
export default function LatticeLoader() {
  const reduced = usePrefersReducedMotion()
  return <div className={`lattice-loader ${reduced ? 'lattice-loader-reduced' : ''}`} aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</div>
}
