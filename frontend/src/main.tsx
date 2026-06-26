import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { WizardProvider } from './contexts/WizardContext'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <WizardProvider>
        <App />
      </WizardProvider>
    </BrowserRouter>
  </StrictMode>,
)
