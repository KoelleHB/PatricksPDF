import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register service worker immediately for PWA offline capabilities and Web Share Target
registerSW({
  immediate: true,
  onRegisteredSW(swUrl, r) {
    console.log('[PWA] Service worker registered:', swUrl, r);
  },
  onRegisterError(error) {
    console.warn('[PWA] Service worker registration error:', error);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
