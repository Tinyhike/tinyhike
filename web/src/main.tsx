import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App.js'
import { I18nProvider } from './lib/i18n.js'
import { detectLocale } from './lib/locale.js'
import 'mapbox-gl/dist/mapbox-gl.css'
import './index.css'

const qc = new QueryClient()

// index.html ships lang="nl"; correct it before first paint so screen readers and
// the browser's translation prompt agree with what's actually rendered.
document.documentElement.lang = detectLocale()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
