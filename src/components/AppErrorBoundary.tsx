import { Component, type ErrorInfo, type ReactNode } from 'react';
import { enableCloudOnlyRenderRecovery } from '../services/renderRecovery';

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
};

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: String(error?.message || 'Unknown rendering error'),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('The application encountered an unexpected rendering error.', error, info);
  }

  private reloadUsingCloudData = () => {
    enableCloudOnlyRenderRecovery();
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-error-boundary" role="alert">
          <section className="app-error-boundary__card">
            <p className="app-error-boundary__eyebrow">Submerge Proposal Builder</p>
            <h1>We couldn't finish loading this screen.</h1>
            <p>
              Your saved proposal data is safe. Reload using the cloud copy to bypass a damaged local cache.
            </p>
            <button type="button" onClick={this.reloadUsingCloudData}>
              Reload Using Cloud Data
            </button>
            <details className="app-error-boundary__details">
              <summary>Error details</summary>
              <code>{this.state.errorMessage}</code>
            </details>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

export default AppErrorBoundary;
