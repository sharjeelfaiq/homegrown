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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AudioActivityProvider>
        <GenerationActivityProvider>
          <App />
        </GenerationActivityProvider>
      </AudioActivityProvider>
    </BrowserRouter>
  </StrictMode>,
)
