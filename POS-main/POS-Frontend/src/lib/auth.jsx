import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Auth, tokens, isNetworkError } from './api';
import { STATUS_MESSAGES } from '../constants/messages';

export const ROLES = {
  BM: 'branch_manager',
  SM: 'sales_manager',
  SP: 'sales_person',
};

export const ROLE_LABEL = {
  branch_manager: 'Branch Manager',
  sales_manager: 'Sales Manager',
  sales_person: 'Sales Person',
};

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [bootMessage, setBootMessage] = useState(STATUS_MESSAGES.RESTORING_SESSION);

  const logout = useCallback(() => {
    tokens.clear();
    setUser(null);
  }, []);

  // The api client fires this when a refresh fails.
  useEffect(() => {
    const h = () => {
      setUser(null);
      setBooting(false);
    };
    window.addEventListener('pos:logout', h);
    return () => window.removeEventListener('pos:logout', h);
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== 'pos.access' && e.key !== 'pos.refresh') return;
      if (!tokens.access) setUser(null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Restore session on hard refresh.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!tokens.access && !tokens.refresh) {
        setBooting(false);
        return;
      }
      try {
        setBootMessage(STATUS_MESSAGES.RESTORING_SESSION);
        const me = await Auth.me({ retries: 0 });
        if (alive) {
          setUser(me);
          setBooting(false);
        }
      } catch (err) {
        if (err?.status === 401 || !isNetworkError(err)) {
          tokens.clear();
        }
        if (alive) {
          setUser(null);
          setBootMessage(
            isNetworkError(err)
              ? STATUS_MESSAGES.POS_SERVER_UNAVAILABLE
              : STATUS_MESSAGES.RESTORING_SESSION,
          );
          setBooting(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (code, password) => {
    const t = await Auth.login(code, password);
    tokens.set(t);
    const me = await Auth.me();
    setUser(me);
    return me;
  }, []);

  const value = useMemo(
    () => ({
      user,
      booting,
      bootMessage,
      authReady: !booting && !!user && !!tokens.access,
      hasToken: !!tokens.access,
      login,
      logout,
      role: user?.role ?? null,
      is: (...roles) => (user ? roles.includes(user.role) : false),
    }),
    [user, booting, bootMessage, login, logout],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** Landing route per role — each role has a different home. */
export function homeFor(role) {
  if (role === ROLES.SP) return '/billing';
  return '/dashboard';
}
