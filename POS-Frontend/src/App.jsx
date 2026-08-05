import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AuthProvider, useAuth, homeFor, ROLES, ROLE_LABEL } from './lib/auth';
import { ToastProvider } from './components/Toast';
import { Shell } from './components/Shell';
import { Loading, Panel, Empty, Button } from './components/ui';
import { ERROR_MESSAGES, STATUS_MESSAGES } from './constants/messages';

import Login from './pages/Login';
import BillingPage from './pages/Billing';
import ReturnsPage from './pages/Returns';
import StaffPage from './pages/StaffPage';
import DashboardPage from './pages/Dashboard';
import InvoicesPage from './pages/InvoicesPage';
import ProductsPage from './pages/ProductsPage';
import ReturnReportsPage from './pages/ReturnReports';
import SettingsPage from './pages/SettingsPage';
import PublicInvoicePage from './pages/PublicInvoicePage';
import PublicReturnEvidencePage from './pages/PublicReturnEvidencePage';

/** Requires a session; optionally restricts to a set of roles. */
function Protected({ roles, children }) {
  const { user, booting, bootMessage } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();

  if (booting) return <Loading label={bootMessage} />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;

  if (roles && !roles.includes(user.role)) {
    return (
      <Shell>
        <div className="px-8 py-16">
          <Panel>
            <Empty
              icon="⛔"
              title="Not permitted"
              sub={`Your role (${ROLE_LABEL[user.role] ?? user.role}) cannot access this page.`}
              action={
                <Button onClick={() => nav(homeFor(user.role), { replace: true })}>
                  Go to my home
                </Button>
              }
            />
          </Panel>
        </div>
      </Shell>
    );
  }
  return <Shell>{children}</Shell>;
}

function RootRedirect() {
  const { user, booting, bootMessage } = useAuth();
  if (booting) return <Loading label={bootMessage} />;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

function ConnectionBanner() {
  const [status, setStatus] = useState(() => (navigator.onLine === false ? 'offline' : 'online'));
  const [message, setMessage] = useState('');

  useEffect(() => {
    const offline = () => {
      setStatus('offline');
      setMessage(ERROR_MESSAGES.OFFLINE);
    };
    const online = () => {
      setStatus('online');
      setMessage(STATUS_MESSAGES.CONNECTION_RESTORED);
      window.setTimeout(() => setMessage(''), 2500);
      window.dispatchEvent(new CustomEvent('pos:network-restored'));
    };
    const api = (e) => {
      if (e.detail?.status === 'offline') {
        setStatus('offline');
        setMessage(e.detail?.detail?.message || ERROR_MESSAGES.NETWORK);
      } else {
        setStatus('online');
        setMessage(STATUS_MESSAGES.CONNECTION_RESTORED);
        window.setTimeout(() => setMessage(''), 2500);
      }
    };

    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    window.addEventListener('pos:connection', api);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      window.removeEventListener('pos:connection', api);
    };
  }, []);

  if (!message) return null;

  return (
    <div
      className={`fixed left-1/2 top-3 z-[60] -translate-x-1/2 rounded-ctl border px-4 py-2 text-[12px] shadow-lg backdrop-blur ${
        status === 'offline'
          ? 'border-amber/40 bg-amberdim text-amber'
          : 'border-ok/40 bg-ok/10 text-ok'
      }`}
    >
      {message}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <ConnectionBanner />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/invoice/view/:token" element={<PublicInvoicePage />} />
            <Route path="/return-evidence/:token" element={<PublicReturnEvidencePage />} />

            <Route
              path="/billing"
              element={
                <Protected roles={[ROLES.SP]}>
                  <BillingPage />
                </Protected>
              }
            />
            <Route
              path="/returns"
              element={
                <Protected>
                  <ReturnsPage />
                </Protected>
              }
            />
            <Route
              path="/dashboard"
              element={
                <Protected>
                  <DashboardPage />
                </Protected>
              }
            />
            <Route
              path="/return-reports"
              element={
                <Protected roles={[ROLES.BM, ROLES.SM]}>
                  <ReturnReportsPage />
                </Protected>
              }
            />
            <Route
              path="/team"
              element={
                <Protected roles={[ROLES.BM, ROLES.SM]}>
                  <StaffPage />
                </Protected>
              }
            />
            <Route
              path="/invoices"
              element={
                <Protected>
                  <InvoicesPage />
                </Protected>
              }
            />
            <Route
              path="/products"
              element={
                <Protected>
                  <ProductsPage />
                </Protected>
              }
            />
            <Route
              path="/settings"
              element={
              <Protected roles={[ROLES.BM, ROLES.SM, ROLES.SP]}>
                  <SettingsPage />
                </Protected>
              }
            />

            <Route path="/" element={<RootRedirect />} />
            <Route path="*" element={<RootRedirect />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
