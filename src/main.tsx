import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
window.fetch = tauriFetch as unknown as typeof window.fetch;
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);


