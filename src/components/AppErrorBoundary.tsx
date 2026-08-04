import { Component, type ErrorInfo, type ReactNode } from 'react';

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
};

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The application encountered an unexpected rendering error.', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-error-boundary" role="alert">
          <section className="app-error-boundary__card">
            <p className="app-error-boundary__eyebrow">Submerge Proposal Builder</p>
            <h1>We couldn't finish loading this screen.</h1>
            <p>
              Your saved proposal data is safe. Reload the app to reconnect and try again.
            </p>
            <button type="button" onClick={() => window.location.reload()}>
              Reload App
            </button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

export default AppErrorBoundary;
