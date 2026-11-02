import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('App error in ' + (this.props.label || 'unknown') + ': ' + JSON.stringify({ name: error && error.name, msg: error && error.message, stack: error && error.stack }) + ' :: ' + (info && info.componentStack));
  }

  render() {
    if (this.state.error) {
      const message = (this.state.error && this.state.error.message) || 'Erreur';
      return (
        <div className="splash">
          <div className="login-card">
            <div className="login-brand">
              <div className="brand-title big">Bureau Ordre</div>
              <div className="brand-sub">Erreur de chargement</div>
            </div>
            <div className="form-error">{String(message)}</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
