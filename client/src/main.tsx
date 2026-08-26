import { render } from 'preact';
import { App } from './ui/App.js';
import './ui/styles.css';

/**
 * Registers the Sendforge Service Worker for offline PWA caching.
 * Only attempts registration on HTTPS, localhost, or 127.0.0.1.
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    (window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1')
  ) {
    return navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        return reg;
      })
      .catch(() => {
        // Graceful non-blocking fallback in unsupported/restricted environments
        return null;
      });
  }
  return Promise.resolve(null);
}

const container = document.getElementById('app');
if (container) {
  render(<App />, container);
  void registerServiceWorker();
}
