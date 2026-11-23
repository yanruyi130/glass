import { createRoot } from 'react-dom/client'
import { App } from './App'
import './style.css'

const host = document.getElementById('glass-lab')
if (!host) throw new Error('Missing liquid glass mount point')
createRoot(host).render(<App />)
