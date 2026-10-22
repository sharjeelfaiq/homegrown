import type { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { AudioActivityProvider } from '../lib/audio/AudioActivityContext.tsx'
import { GenerationActivityProvider } from '../features/generation/GenerationActivityContext.tsx'
import { ThemeProvider } from '../lib/theme/ThemeContext.tsx'
import { QueryClientProvider } from '@tanstack/react-query'
import { historyQueryClient } from '../features/history/historyQuery.ts'
import { TooltipProvider } from '../components/ui/Tooltip.tsx'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delay={500} closeDelay={100}>
      <ThemeProvider>
        <QueryClientProvider client={historyQueryClient}>
          <BrowserRouter>
            <AudioActivityProvider>
              <GenerationActivityProvider>
                {children}
              </GenerationActivityProvider>
            </AudioActivityProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </TooltipProvider>
  )
}
