/**
 * The Homegrown mark: four waveform bars on a rounded tile. Geometry mirrors
 * scripts/build/build_brand.py (the source of the favicon, app icon and
 * landing-page marks), so change the bars there and here together. Colours come
 * from theme tokens, so the mark follows whichever theme is active, whereas the
 * favicon file is fixed to the default palette.
 */
const BARS = [
  [5, 12, 8],
  [12, 5, 22],
  [19, 9, 14],
  [26, 13, 6],
] as const

export default function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="var(--bg-nav)" />
      <g fill="var(--accent-2)">
        {BARS.map(([x, y, h]) => (
          <rect key={x} x={x} y={y} width="4" height={h} rx="2" />
        ))}
      </g>
    </svg>
  )
}
