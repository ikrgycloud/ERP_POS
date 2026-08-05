import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const ToastCtx = createContext(null);
let seq = 0;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const dismiss = useCallback((id) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const push = useCallback((tone, message, ttl = 4000) => {
    const id = ++seq;
    setItems((xs) => [...xs, { id, tone, message }]);
    if (ttl) setTimeout(() => dismiss(id), ttl);
    return id;
  }, [dismiss]);

  const toast = {
    ok: (m) => push('ok', m),
    error: (m) => push('danger', m, 6000),
    info: (m) => push('info', m),
  };

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[360px] flex-col gap-2">
        {items.map((t) => (
          <Toast key={t.id} {...t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

const TONE = {
  ok: 'border-ok/40 bg-ok/10 text-ok',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-info/40 bg-info/10 text-info',
};

function Toast({ tone, message, onClose }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, []);
  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-card border px-4 py-3 backdrop-blur transition-all duration-200 ${TONE[tone]} ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
    >
      <p className="flex-1 text-[13px] leading-snug">{message}</p>
      <button
        onClick={onClose}
        className="shrink-0 text-current/60 hover:text-current"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error('useToast must be used inside <ToastProvider>');
  return v;
}
