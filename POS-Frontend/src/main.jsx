import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { AppQueryProvider } from './app/queryClient.jsx'
import { ThemeProvider } from './theme/ThemeProvider.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <AppQueryProvider>
    <ThemeProvider><App /></ThemeProvider>
  </AppQueryProvider>,
)
