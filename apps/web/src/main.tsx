import React from 'react';
import ReactDOM from 'react-dom/client';
import AppBootstrap from './AppBootstrap';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { installClientErrorHandlers } from './platform/clientErrors';
import './index.css';
import { currentLocale } from './i18n/locale';

installClientErrorHandlers();
// Язык страницы для скринридеров и переносов - выбранный игроком.
document.documentElement.lang = currentLocale();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppBootstrap />
    </ErrorBoundary>
  </React.StrictMode>,
);
