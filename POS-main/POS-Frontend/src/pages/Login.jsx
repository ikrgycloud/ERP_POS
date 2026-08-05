import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, homeFor } from '../lib/auth';
import { Button, Input, Field, Spinner } from '../components/ui';
import { APP_NAME, APP_CONFIG } from '../config/appConfig';
import { Logo, IconEye, IconEyeOff, IconUser, IconLock } from '../components/Icons';

function BrandPanel() {
  return (
    <div className="relative hidden flex-col justify-between border-r border-hair bg-login p-10 md:flex">
      <div>
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-amber text-on-primary">
          <Logo className="h-7 w-7" />
        </div>
        <h1 className="mt-6 text-2xl font-extrabold leading-tight text-bone">{APP_NAME}</h1>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-mute">
          Complete Retail Management Platform
        </p>

        <div className="mt-6 grid gap-3">
          <Feature>Fast Billing</Feature>
          <Feature>Inventory Control</Feature>
          <Feature>Secure Access</Feature>
          <Feature>Sales Analytics</Feature>
        </div>
      </div>

      <div className="mt-6 text-sm text-mute">
        <p className="font-semibold text-[10px] tracking-[0.12em]">Enterprise Grade</p>
        <p className="mt-2">Designed for high-throughput retail environments.</p>
      </div>
    </div>
  );
}

function Feature({ children }) {
  return (
    <div className="flex items-center gap-3 rounded border border-hair bg-raised px-3 py-2 text-[13px] text-bone">
      <span className="font-mono text-amber">●</span>
      <span>{children}</span>
    </div>
  );
}

function FullScreenBoot({ label = 'Preparing workspace...' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ground/60">
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-surface/80 p-8 shadow-2xl backdrop-blur-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-amber text-on-primary">
          <Logo className="h-8 w-8" />
        </div>
        <div className="flex items-center gap-3">
          <Spinner className="h-6 w-6" />
          <div className="text-sm text-mute">{label}</div>
        </div>
        <div className="text-xs text-mute">Restoring secure session…</div>
      </div>
    </div>
  );
}

export default function Login() {
  const { user, booting, bootMessage, login } = useAuth();
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);

  if (booting) return <FullScreenBoot label={bootMessage || 'Restoring secure session…'} />;
  if (user) return <Navigate to={homeFor(user.role)} replace />;

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const employeeCode = String(code || '').trim().toUpperCase();
      const me = await login(employeeCode, pw);
      nav(homeFor(me.role), { replace: true });
    } catch (e2) {
      setErr(e2);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ground px-4">
      <div className="w-full max-w-[1000px] overflow-hidden rounded-2xl border border-hair bg-surface md:grid md:grid-cols-[1.2fr_minmax(0,420px)]">
        <BrandPanel />

        <div className="flex items-center justify-center p-8 md:p-12">
          <div className="w-full max-w-[380px] animate-fade-in rounded-2xl bg-surface/60 p-8 shadow-2xl backdrop-blur-sm">
            <header className="mb-4">
              <h2 className="text-2xl font-semibold text-bone">Welcome Back</h2>
              <p className="mt-1 text-sm text-mute">Sign in to continue</p>
              <div className="mt-3 inline-flex items-center gap-2 rounded px-2 py-1 text-[12px] text-mute bg-raised border border-hair">
                <span>🔒</span>
                <span className="text-[12px]">Secure employee login</span>
              </div>
            </header>

            <form onSubmit={submit} className="space-y-4" aria-label="Login form">
              <Field label="EMPLOYEE CODE">
                <div className="relative">
                  <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute">
                    <IconUser className="h-4 w-4" />
                  </div>
                  <Input
                    className="pl-10"
                    mono
                    autoFocus
                    autoComplete="username"
                    placeholder="Enter employee code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    onBlur={(e) => setCode((v) => (v || '').trim().toUpperCase())}
                    aria-label="Employee code"
                    required
                  />
                </div>
              </Field>

              <Field label="PASSWORD">
                <div className="relative">
                  <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute">
                    <IconLock className="h-4 w-4" />
                  </div>
                  <Input
                    className="pl-10 pr-12"
                    type={showPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    aria-label="Password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-mute transition-colors hover:text-bone"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <IconEyeOff className="h-5 w-5" /> : <IconEye className="h-5 w-5" />}
                  </button>
                </div>
              </Field>

              {err ? (
                <div className="rounded-card border border-danger/40 bg-danger/10 px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="text-lg">⚠</div>
                    <div>
                      <div className="text-sm font-semibold text-danger">Unable to sign in</div>
                      <div className="mt-1 text-xs text-danger/80">{err.message || 'Please check your sign-in details'}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div>
                <Button type="submit" className="w-full py-3 h-12" loading={busy}>
                  {busy ? 'Signing in…' : 'Sign In'}
                </Button>
              </div>
              <div className="pt-2 text-center text-xs text-mute">
                <div className="text-sm text-mute">v{APP_CONFIG.version}</div>
              </div>
            </form>

            <footer className="mt-6 text-center text-xs text-mute">
              <div>Protected by secure authentication</div>
              <div className="mt-1">Version {APP_CONFIG.version}</div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
