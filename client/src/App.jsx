import { useEffect, useLayoutEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { LanguageProvider, useLanguage } from './i18n';
import { AuthProvider, useAuth } from './auth';
import { ThemeProvider } from './theme';
import { setHolding, useHolding } from './motion';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import LetterDetail from './pages/LetterDetail';
import Accounts from './pages/Accounts';
import Templates from './pages/Templates';
import Referees from './pages/Referees';
import Activity from './pages/Activity';
import Courrier from './pages/Courrier';
import CourriersRejetes from './pages/CourriersRejetes';
import ToSend from './pages/ToSend';
import Registre from './pages/Registre';
import Gmail from './pages/Gmail';
import Splash from './components/Splash';
import Portal from './components/Portal';
import Finance from './pages/Finance';

const BOOT_MIN_MS = 1500;
const WELCOME_MS = 1800;
const LEAVE_MS = 800;

function Splashes({ onComplete }) {
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
  // Boot + welcome terminés → on peut afficher la page de sélection
  useEffect(() => {
    if (bootPhase === 'done' && !greeted && !welcome) onComplete?.();
  }, [bootPhase, greeted, welcome, onComplete]);

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
  return user?.role === 'admin' || user?.role === 'supervisor' || user?.role === 'daf' ? children : <Navigate to="/" replace />;
}

function RegistreRoute({ children }) {
  const { user } = useAuth();
  const ok = Boolean(user) && (user.role === 'admin' || user.role === 'supervisor' || user.role === 'daf' || Boolean(user?.commission));
  return ok ? children : <Navigate to="/" replace />;
}

// Routes the admin can delegate: the page opens for the bureau or for any
// account granted the matching permission.
function PermRoute({ perm, children }) {
  const { user } = useAuth();
  const ok = Boolean(user) && (user.role === 'admin' || user.role === 'supervisor' || user.role === 'daf' || user?.permissions?.[perm]);
  return ok ? children : <Navigate to="/" replace />;
}

function AppRoutes({ splashDone, department, chooseDepartment }) {
  const { user } = useAuth();
  // Portal uniquement après connexion (jamais sur la page de login).
  if (splashDone && user && !department) return <Portal onChoose={chooseDepartment} />;
  if (splashDone && user && department === 'finance') return <Finance />;
  return (
            <Routes>
              <Route path="/login" element={<ErrorBoundary label="login"><Login /></ErrorBoundary>} />
              <Route path="/" element={<Protected><Layout /></Protected>}>
                <Route index element={<ErrorBoundary label="dashboard"><Dashboard /></ErrorBoundary>} />
                <Route path="comptes" element={<PermRoute perm="users"><ErrorBoundary label="accounts"><Accounts /></ErrorBoundary></PermRoute>} />
                <Route path="modeles" element={<PermRoute perm="users"><ErrorBoundary label="templates"><Templates /></ErrorBoundary></PermRoute>} />
                <Route path="arbitres" element={<ErrorBoundary label="referees"><Referees /></ErrorBoundary>} />
                <Route path="activite" element={<PermRoute perm="journal"><ErrorBoundary label="activity"><Activity /></ErrorBoundary></PermRoute>} />
                <Route path="courrier" element={<ErrorBoundary label="courrier"><Courrier /></ErrorBoundary>} />
                <Route path="registres" element={<RegistreRoute><ErrorBoundary label="registre"><Registre /></ErrorBoundary></RegistreRoute>} />
                <Route path="registres/:committeeId" element={<RegistreRoute><ErrorBoundary label="registre"><Registre /></ErrorBoundary></RegistreRoute>} />
                <Route path="gmail" element={<AdminOnly><ErrorBoundary label="gmail"><Gmail /></ErrorBoundary></AdminOnly>} />
                <Route path="lettres" element={<Navigate to="/courrier" replace />} />
                <Route path="lettres/nouveau" element={<Navigate to="/?newLetter=1" replace />} />
                <Route path="lettres/:id" element={<ErrorBoundary label="letterdetail"><LetterDetail /></ErrorBoundary>} />
                <Route path="reception" element={<Navigate to="/courrier?direction=entrant" replace />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
  );
}

export default function App() {
  const navigate = useNavigate();
  const [splashDone, setSplashDone] = useState(false);
  // Le Portal s'affiche à chaque ouverture : le choix n'est pas mémorisé.
  const [department, setDepartment] = useState(null);
  const chooseDepartment = (id) => {
    setDepartment(id);
    // Registre → retour explicite au dashboard (évite de rester sur /login)
    if (id === 'registre') navigate('/', { replace: true });
  };

  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <ErrorBoundary>
            <Splashes onComplete={() => setSplashDone(true)} />
            <Stage>
              <AppRoutes splashDone={splashDone} department={department} chooseDepartment={chooseDepartment} />
            </Stage>
          </ErrorBoundary>
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
