import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import DocumentApp from './documents/DocumentApp.tsx';
import { ErrorBoundary } from './components/ErrorBoundary';
// Unified EN+AR font, bundled locally — no CDN request (offline / zero-telemetry).
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import { installApiAuth } from './apiAuth';
import { wireFlushOnExit } from './lib/flushOnExit';
import './index.css';

// Same choice as the vault window, applied before the first paint so a light
// vault does not flash a dark file window.
const savedTheme = localStorage.getItem("indexarc-theme") === "light" ? "light" : "dark";
document.documentElement.setAttribute("data-theme", savedTheme);

installApiAuth();
// Quit handshake: flush unsaved notes to the server before the app exits.
wireFlushOnExit();

const Root = new URLSearchParams(window.location.search).get("surface") === "docs" ? DocumentApp : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
