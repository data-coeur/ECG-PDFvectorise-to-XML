// main — point d'entrée du bundle. Crée la root React, empile StrictMode et
// LanguageProvider (i18n FR/EN), et monte <App /> sur #root. Importe aussi
// index.css (Tailwind + classe utilitaire .glass-card).
// Appelé par : Vite/index.html. Pas de logique métier ici.

import React from 'react'
import ReactDOM from 'react-dom/client'
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
