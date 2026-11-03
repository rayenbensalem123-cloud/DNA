import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LanguageProvider } from './i18n';
import { AuthProvider, useAuth } from './auth';
import { ThemeProvider } from './theme';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Archive from './pages/Archive';
import LetterDetail from './pages/LetterDetail';
import Accounts from './pages/Accounts';
import { getToken } from './api';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const hasSessionToken = Boolean(getToken());
  const [minimumLoadingTimePassed, setMinimumLoadingTimePassed] = useState(false);

  useEffect(() => {
    if (!hasSessionToken) { setMinimumLoadingTimePassed(true); return undefined; }
    const timer = window.setTimeout(() => setMinimumLoadingTimePassed(true), 2500);
    return () => window.clearTimeout(timer);
  }, [hasSessionToken]);

  if (hasSessionToken && (loading || !minimumLoadingTimePassed)) return (
    <main className="loading-screen" role="status" aria-live="polite">
      <section className="loading-center">
        <div className="loading-emblem-wrap">
          <div className="loading-ring" />
          <img className="loading-emblem" src="/federation-tunisienne-logo.webp" alt="" />
        </div>
        <h1 className="loading-brand-title">Direction Nationale d’Arbitrage</h1>
        <p className="loading-brand-sub">Fédération Tunisienne de Football</p>
        <div className="loading-dots" aria-hidden="true">
          <span /><span /><span />
        </div>
        <span className="loading-label">Chargement…</span>
      </section>
    </main>
  );
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  return user?.role === 'admin' ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <ErrorBoundary>
            <Routes>
              <Route path="/login" element={<ErrorBoundary label="login"><Login /></ErrorBoundary>} />
              <Route path="/" element={<Protected><Layout /></Protected>}>
                <Route index element={<ErrorBoundary label="dashboard"><Dashboard /></ErrorBoundary>} />
                <Route path="archive/comites/:committeeId" element={<ErrorBoundary label="archive"><Archive /></ErrorBoundary>} />
                <Route path="archive" element={<ErrorBoundary label="archive"><Archive /></ErrorBoundary>} />
                <Route path="comptes" element={<AdminOnly><ErrorBoundary label="accounts"><Accounts /></ErrorBoundary></AdminOnly>} />
                <Route path="lettres" element={<Navigate to="/archive" replace />} />
                <Route path="lettres/nouveau" element={<Navigate to="/?newLetter=1" replace />} />
                <Route path="lettres/:id" element={<ErrorBoundary label="letterdetail"><LetterDetail /></ErrorBoundary>} />
                <Route path="reception" element={<Navigate to="/archive?direction=entrant" replace />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

