import { Component, type ReactNode } from 'react';
import { reportClientError } from '../platform/clientErrors';

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
    return (
      <main className="app-shell error-boundary-screen" role="alert">
        <div className="error-boundary-card">
          <h1 className="error-boundary-title">Что-то сломалось</h1>
          <p className="error-boundary-text">Мы уже знаем о проблеме. Перезагрузи игру: сохранённые забеги не пропадут.</p>
          <button type="button" className="cta-btn" onClick={() => window.location.reload()}>Перезагрузить</button>
        </div>
      </main>
    );
  }
}
