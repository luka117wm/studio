import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppShell } from './app/AppShell'
import { Providers } from './app/providers'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <AppShell />
    </Providers>
  </StrictMode>,
)
