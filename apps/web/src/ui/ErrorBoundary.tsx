import { Component, type ReactNode } from 'react';
import { reportClientError } from '../platform/clientErrors';
import { messagesFor } from '../i18n/messages';
import { m } from './messages';

interface State {
  failed: boolean;
}

/** Последняя страховка: падение при рендере показывает экран с перезагрузкой, а не белый лист. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    reportClientError('render', error);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const t = messagesFor(m);
    return (
      <main className="app-shell error-boundary-screen" role="alert">
        <div className="error-boundary-card">
          <h1 className="error-boundary-title">{t.errorTitle}</h1>
          <p className="error-boundary-text">{t.errorText}</p>
          <button type="button" className="cta-btn" onClick={() => window.location.reload()}>{t.reload}</button>
        </div>
      </main>
    );
  }
}
