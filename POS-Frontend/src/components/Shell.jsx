import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth, ROLE_LABEL } from '../lib/auth';
import { DATE_FORMAT, APP_NAME } from '../config/appConfig';
import { NAV_CONFIG } from '../config/navConfig';
import { Avatar, ConfirmModal } from './ui';

function Sidebar() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const profileRef = useRef(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const items = NAV_CONFIG.filter((n) => n.roles.includes(user?.role));

  useEffect(() => {
    if (!profileOpen) return undefined;

    function onMouseDown(e) {
      if (!profileRef.current?.contains(e.target)) setProfileOpen(false);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') setProfileOpen(false);
    }

    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [profileOpen]);

  function signOut() {
    setProfileOpen(false);
    logout();
    nav('/login', { replace: true });
  }

  return (
    <aside className="theme-sidebar fixed inset-y-0 left-0 z-20 flex w-[84px] flex-col items-center border-r border-sidebar-border bg-sidebar">
      <div className="mt-6 flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-logo font-bold text-sidebar-logo-text">
        {APP_NAME.charAt(0).toUpperCase()}
      </div>

      <nav className="mt-8 flex flex-1 flex-col gap-2">
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            onClick={() => setProfileOpen(false)}
            className={({ isActive }) => `sidebar-item ${isActive ? 'is-active' : ''}`}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="sidebar-active-marker absolute -left-[14px] top-1/2 h-8 w-[3px] -translate-y-1/2 rounded" />
                )}
                <span className="sidebar-icon text-[19px] leading-none">{n.glyph}</span>
                <span className="sidebar-label mt-1 text-[7.4px] font-semibold tracking-wide">
                  {n.label.toUpperCase()}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div ref={profileRef} className="relative mb-6">
        <button
          onClick={() => setProfileOpen((v) => !v)}
          title="Profile"
          aria-label="Open profile menu"
          aria-expanded={profileOpen}
          aria-haspopup="menu"
          className={`rounded-full transition hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-logo/60 ${
            profileOpen ? 'ring-2 ring-sidebar-logo/50' : ''
          }`}
        >
          <Avatar name={user?.full_name || 'User'} size={32} />
        </button>

        <div
          role="menu"
          className={`absolute bottom-full left-0 z-50 mb-3 max-h-[calc(100vh-96px)] w-56 overflow-y-auto rounded-2xl border border-hair bg-surface p-4 shadow-2xl transition-all duration-200 ${
            profileOpen
              ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
              : 'pointer-events-none translate-y-2 scale-95 opacity-0'
          }`}
        >
          <div className="flex flex-col items-center text-center">
            <Avatar name={user?.full_name || 'User'} size={48} />
            <p className="profile-name mt-3 max-w-full truncate text-[14px] font-semibold">
              {user?.full_name || 'User'}
            </p>
            <p className="profile-role mt-1 text-[11px]">
              {ROLE_LABEL[user?.role] ?? 'POS User'}
            </p>

            <p className="mt-4 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-mute">
              Employee ID
            </p>
            <span className="profile-code mt-1 rounded-md border px-2.5 py-1 font-mono text-[11px] font-semibold">
              {user?.employee_code || '—'}
            </span>
          </div>

          <div className="mt-4 border-t border-hair pt-3">
            <button
              role="menuitem"
              onClick={() => {
                setProfileOpen(false);
                setConfirmLogout(true);
              }}
              className="flex h-[42px] w-full items-center justify-center rounded-xl bg-danger px-3 text-[13px] font-semibold text-inverse transition hover:bg-danger/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger/50"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmLogout}
        danger
        icon="!"
        title="Sign Out?"
        message="Your current session will end on this device."
        confirmLabel="Sign Out"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={signOut}
      />
    </aside>
  );
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <div className="rounded-md border border-hair bg-raised px-3 py-1.5">
        <span className="font-mono text-[11px] text-dim">
          {now.toLocaleDateString(DATE_FORMAT.locale, DATE_FORMAT.date)}
        </span>
      </div>
      <span className="font-mono text-[13px] font-semibold text-amber">
        {now.toLocaleTimeString(DATE_FORMAT.locale, DATE_FORMAT.time)}
      </span>
    </>
  );
}

export function Topbar({ title, subtitle, chip }) {
  const { user } = useAuth();
  return (
    <header className="theme-header sticky top-0 z-10 flex h-[66px] items-center gap-6 border-b border-hair bg-header px-8">
      <div className="min-w-0">
        <h1 className="truncate text-[17px] font-semibold text-header-text">{title}</h1>
        {subtitle && <p className="truncate text-[11.5px] text-header-muted">{subtitle}</p>}
      </div>

      {chip && (
        <div className="hidden shrink-0 rounded-md border border-hair bg-raised px-3 py-1.5 lg:block">
          <span className="font-mono text-[11.5px] text-dim">{chip}</span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-4">
        <div className="hidden text-right sm:block">
          <p className="text-[10.5px] tracking-wide text-mute">
            {ROLE_LABEL[user?.role] ?? ''}
          </p>
          <p className="text-[12.5px] font-medium text-bone">
            {user?.full_name} · {user?.employee_code}
          </p>
        </div>
        <Avatar name={user?.full_name || 'User'} size={32} />
        <div className="hidden items-center gap-4 md:flex">
          <Clock />
        </div>
      </div>
    </header>
  );
}

export function Shell({ children }) {
  return (
    <div className="app-shell min-h-screen bg-ground text-bone">
      <Sidebar />
      <div className="pl-[84px]">{children}</div>
    </div>
  );
}

export function Page({ title, subtitle, chip, children }) {
  return (
    <>
      <Topbar title={title} subtitle={subtitle} chip={chip} />
      <main className="px-8 py-6">{children}</main>
    </>
  );
}
