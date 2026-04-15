import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import QueryProvider from './providers/QueryProvider'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryProvider>
      <App />
    </QueryProvider>
  </StrictMode>
)
