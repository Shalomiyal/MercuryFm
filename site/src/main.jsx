import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { DataRefreshProvider } from './contexts/DataRefreshContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ConfirmProvider } from './components/ui/ConfirmProvider'
import DialogA11y from './components/ui/DialogA11y'
import ErrorBoundary from './components/ErrorBoundary'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <DataRefreshProvider>
            <ConfirmProvider>
              <DialogA11y />
              <ErrorBoundary>
                <App />
              </ErrorBoundary>
            </ConfirmProvider>
          </DataRefreshProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
