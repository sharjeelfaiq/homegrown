import { Route, Routes, useNavigate } from 'react-router-dom'
import LandingPage from './components/LandingPage'
import StudioShell from './components/StudioShell'

export default function App() {
  const navigate = useNavigate()

  return (
    <Routes>
      <Route path="/" element={<LandingPage onEnter={() => navigate('/studio')} />} />
      <Route path="/studio" element={<StudioShell />} />
    </Routes>
  )
}
