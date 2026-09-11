import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/archivo/index.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles/tokens.css'
import './index.css'
import App from './App.tsx'
import { AudioActivityProvider } from './AudioActivityContext.tsx'
import { GenerationActivityProvider } from './GenerationActivityContext.tsx'
import { ThemeProvider } from './ThemeContext.tsx'

// ThemeProvider is outermost, and outside BrowserRouter: the theme is
// route-independent, and it is consumed from the header (ThemeSwitch), from
// deep inside the history list (WaveRibbon, never reachable by prop) and by
// Modal, which portals to document.body outside #root entirely.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AudioActivityProvider>
          <GenerationActivityProvider>
            <App />
          </GenerationActivityProvider>
        </AudioActivityProvider>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
)
