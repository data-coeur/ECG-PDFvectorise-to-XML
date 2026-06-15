// main — point d'entrée du bundle. Crée la root React, empile StrictMode et
// LanguageProvider (i18n FR/EN), et monte <App /> sur #root. Importe aussi
// index.css (Tailwind + classe utilitaire .glass-card).
// Appelé par : Vite/index.html. Pas de logique métier ici.

import React from 'react'
import ReactDOM from 'react-dom/client'
// Self-hosted fonts (bundled, no external Google Fonts dependency → fast even on
// firewalled/slow networks). Weights match the former Google Fonts request.
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/jetbrains-mono/300.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import { LanguageProvider } from './i18n'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
)
