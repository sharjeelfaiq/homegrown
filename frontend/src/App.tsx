import { Route, Routes } from 'react-router-dom'
import StudioShell from './components/StudioShell'

// The app opens straight into the tool. There is no in-app landing page any
// more -- the launcher points the browser here and the user expects the studio,
// not a marketing page they have to click through. `/studio` is kept as an
// alias so older bookmarks and the previous launcher's URL still resolve.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StudioShell />} />
      <Route path="/studio" element={<StudioShell />} />
    </Routes>
  )
}
