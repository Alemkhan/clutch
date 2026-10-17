import React from 'react';
import ReactDOM from 'react-dom/client';
import AppBootstrap from './AppBootstrap';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { installClientErrorHandlers } from './platform/clientErrors';
import './index.css';

installClientErrorHandlers();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppBootstrap />
    </ErrorBoundary>
  </React.StrictMode>,
);
