import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PrescriptionViewer from './components/PrescriptionViewer.jsx'

// A prescription QR code opens  https://<app>/#rx=...
// That page must work for anyone (no login), so it replaces the normal app.
function Root() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return hash.startsWith('#rx=') ? <PrescriptionViewer key={hash} hash={hash} /> : <App />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
