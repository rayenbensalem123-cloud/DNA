import { useEffect, useLayoutEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { LanguageProvider, useLanguage } from './i18n';
import { AuthProvider, useAuth } from './auth';
import { ThemeProvider } from './theme';
import { setHolding, useHolding } from './motion';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Archive from './pages/Archive';
import LetterDetail from './pages/LetterDetail';
import Accounts from './pages/Accounts';
import Activity from './pages/Activity';
import Courrier from './pages/Courrier';
import CourriersRejetes from './pages/CourriersRejetes';
import Splash from './components/Splash';

const BOOT_MIN_MS = 1500;
const WELCOME_MS = 1800;
const LEAVE_MS = 800;

function Splashes() {
  const { t } = useLanguage();
  const { loading, welcome, endWelcome } = useAuth();
  const [bootPhase, setBootPhase] = useState('show');
  const [bootMin, setBootMin] = useState(false);
  const [welcomePhase, setWelcomePhase] = useState('show');
  const [greeted, setGreeted] = useState(null);

  useEffect(() => { const id = setTimeout(() => setBootMin(true), BOOT_MIN_MS); return () => clearTimeout(id); }, []);
  useEffect(() => {
    if (bootPhase === 'show' && bootMin && !loading) setBootPhase('leaving');
    if (bootPhase === 'leaving') { const id = setTimeout(() => setBootPhase('done'), LEAVE_MS); return () => clearTimeout(id); }
    return undefined;
  }, [bootPhase, bootMin, loading]);

  useEffect(() => {
    if (!welcome) return undefined;
    setGreeted(welcome);
    setWelcomePhase('show');
    const a = setTimeout(() => setWelcomePhase('leaving'), WELCOME_MS);
    const b = setTimeout(() => { setGreeted(null); endWelcome(); }, WELCOME_MS + LEAVE_MS);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [welcome]);

  const holding = bootPhase === 'show' || (greeted && welcomePhase === 'show');
  useLayoutEffect(() => { setHolding(Boolean(holding)); }, [holding]);

  if (greeted) {
    return <Splash title={t('splash.welcome', { name: greeted.name })} subtitle={t('auth.role.' + greeted.role)} leaving={welcomePhase === 'leaving'} />;
  }
  if (bootPhase !== 'done') {
    return <Splash title="Direction Nationale d’Arbitrage" subtitle="Fédération Tunisienne de Football" label={t('common.loading')} leaving={bootPhase === 'leaving'} />;
  }
  return null;
}

function Stage({ children }) {
  const holding = useHolding();
  return <div className="stage" data-holding={holding ? 'true' : 'false'}>{children}</div>;
}

function Protected({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  return user?.role === 'admin' || user?.role === 'supervisor' ? children : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <ErrorBoundary>
            <Splashes />
            <Stage>
            <Routes>
              <Route path="/login" element={<ErrorBoundary label="login"><Login /></ErrorBoundary>} />
              <Route path="/" element={<Protected><Layout /></Protected>}>
                <Route index element={<ErrorBoundary label="dashboard"><Dashboard /></ErrorBoundary>} />
                <Route path="archive/comites/:committeeId" element={<ErrorBoundary label="archive"><Archive /></ErrorBoundary>} />
                <Route path="archive" element={<ErrorBoundary label="archive"><Archive /></ErrorBoundary>} />
                <Route path="comptes" element={<AdminOnly><ErrorBoundary label="accounts"><Accounts /></ErrorBoundary></AdminOnly>} />
                <Route path="activite" element={<AdminOnly><ErrorBoundary label="activity"><Activity /></ErrorBoundary></AdminOnly>} />
                <Route path="courrier" element={<ErrorBoundary label="courrier"><Courrier /></ErrorBoundary>} />
                <Route path="courriers-rejetes" element={<ErrorBoundary label="rejetes"><CourriersRejetes /></ErrorBoundary>} />
                <Route path="lettres" element={<Navigate to="/archive" replace />} />
                <Route path="lettres/nouveau" element={<Navigate to="/?newLetter=1" replace />} />
                <Route path="lettres/:id" element={<ErrorBoundary label="letterdetail"><LetterDetail /></ErrorBoundary>} />
                <Route path="reception" element={<Navigate to="/archive?direction=entrant" replace />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Stage>
          </ErrorBoundary>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
