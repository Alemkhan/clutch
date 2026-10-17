import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const reportClientError = vi.fn();
vi.mock('../platform/clientErrors', () => ({ reportClientError: (...args: unknown[]) => reportClientError(...args) }));

import { ErrorBoundary } from './ErrorBoundary';

describe('ErrorBoundary', () => {
  it('renders children while healthy', () => {
    expect(renderToStaticMarkup(<ErrorBoundary><p>ok</p></ErrorBoundary>)).toContain('<p>ok</p>');
  });

  it('shows the failure screen with a reload button after an error and reports it', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = { failed: true };
    const markup = renderToStaticMarkup(<>{boundary.render()}</>);
    expect(markup).toContain('Что-то сломалось');
    expect(markup).toContain('Перезагрузить');
    const error = new Error('render crash');
    boundary.componentDidCatch(error);
    expect(reportClientError).toHaveBeenCalledWith('render', error);
  });
});
