import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LanguageProvider } from './i18n';
import { AuthProvider, useAuth } from './auth';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Letters from './pages/Letters';
import LetterCreate from './pages/LetterCreate';
import LetterDetail from './pages/LetterDetail';
import Reception from './pages/Reception';

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="splash"><div className="brand-title big">Bureau Ordre</div></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <ErrorBoundary>
          <Routes>
            <Route path="/login" element={<ErrorBoundary label="login"><Login /></ErrorBoundary>} />
            <Route path="/" element={<Protected><Layout /></Protected>}>
              <Route index element={<ErrorBoundary label="dashboard"><Dashboard /></ErrorBoundary>} />
              <Route path="lettres" element={<ErrorBoundary label="letters"><Letters /></ErrorBoundary>} />
              <Route path="lettres/nouveau" element={<ErrorBoundary label="lettercreate"><LetterCreate /></ErrorBoundary>} />
              <Route path="lettres/:id" element={<ErrorBoundary label="letterdetail"><LetterDetail /></ErrorBoundary>} />
              <Route path="reception" element={<ErrorBoundary label="reception"><Reception /></ErrorBoundary>} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </AuthProvider>
    </LanguageProvider>
  );
}
