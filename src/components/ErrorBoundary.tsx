import { Component, type ReactNode, type ErrorInfo } from 'react';

/**
 * Catches render/runtime errors from the R3F scene or HUD so a crash shows a
 * readable message instead of a black screen (an uncaught error inside the
 * always-mounted <Canvas> otherwise unmounts the whole app → black).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[MathQuake crash]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 9999,
            background: '#0a0012', color: '#ff5fa8',
            font: '13px/1.5 monospace', padding: 24, overflow: 'auto', whiteSpace: 'pre-wrap',
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12, color: '#fff' }}>
            💥 Рендер упал — вот ошибка (сфоткай мне):
          </div>
          {String(error.message || error)}
          {'\n\n'}
          {String(error.stack || '')}
          <div style={{ marginTop: 16 }}>
            <button
              onClick={() => this.setState({ error: null })}
              style={{ padding: '8px 16px', background: '#f72585', color: '#fff', border: 0, cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
