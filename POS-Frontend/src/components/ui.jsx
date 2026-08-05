import { forwardRef, useEffect, useRef } from 'react';
import { initials as ini } from '../lib/format';
import { ERROR_MESSAGES } from '../constants/messages';

export function Panel({ className = '', children, ...rest }) {
  return (
    <div
      className={`theme-card rounded-panel border border-hair bg-surface ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children, right }) {
  return (
    <div className="flex items-baseline justify-between">
      <h2 className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
        {children}
      </h2>
      {right ? <span className="text-[10px] text-mute">{right}</span> : null}
    </div>
  );
}

const PILL_TONE = {
  ok: 'text-ok border-ok/50 bg-ok/10',
  danger: 'text-danger border-danger/50 bg-danger/10',
  amber: 'text-amber border-amber/50 bg-amber/10',
  info: 'text-info border-info/50 bg-info/10',
  violet: 'text-violet border-violet/50 bg-violet/10',
  mute: 'text-mute border-mute/40 bg-mute/10',
};

export function Pill({ tone = 'mute', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide ${PILL_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export const Button = forwardRef(function Button({
  variant = 'primary',
  className = '',
  disabled,
  loading,
  children,
  ...rest
}, ref) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-ctl text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber/60';
  const styles = {
    primary: 'bg-amber text-on-primary font-semibold hover:bg-amber/90',
    secondary: 'border border-hair bg-raised text-bone hover:bg-hair/60',
    danger: 'border border-danger/50 bg-danger/10 text-danger hover:bg-danger/20',
    ghost: 'text-dim hover:text-bone hover:bg-raised',
  };
  return (
    <button
      ref={ref}
      className={`${base} ${styles[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : null}
      {children}
    </button>
  );
});

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[9px] font-semibold tracking-[0.09em] text-mute">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[10px] text-mute">{hint}</span> : null}
    </label>
  );
}

export function Input({ className = '', mono, ...rest }) {
  return (
    <input
      className={`w-full rounded-ctl border border-hair bg-raised px-3.5 py-2.5 text-[13px] text-bone placeholder:text-mute/60 focus:border-amber/60 focus:outline-none focus:ring-1 focus:ring-amber/40 disabled:opacity-50 ${
        mono ? 'font-mono' : ''
      } ${className}`}
      {...rest}
    />
  );
}

export function Avatar({ name, size = 34, tone = 'amber' }) {
  const tones = {
    amber: 'bg-avatar text-avatar-text',
    dim: 'bg-avatar text-avatar-text',
    info: 'bg-avatar text-avatar-text',
    ok: 'bg-avatar text-avatar-text',
  };
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full border border-avatar-border font-semibold leading-none tracking-tight ${tones[tone]}`}
      style={{ width: size, minWidth: size, height: size, minHeight: size, fontSize: Math.max(11, size * 0.38) }}
      title={name || 'User'}
      aria-label={name || 'User'}
    >
      {ini(name)}
    </span>
  );
}

export function Empty({ icon = '◌', title, sub, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 text-3xl text-mute/50">{icon}</div>
      <p className="text-sm font-medium text-dim">{title}</p>
      {sub ? <p className="mt-1 max-w-sm text-xs text-mute">{sub}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="rounded-card border border-danger/40 bg-danger/10 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-danger">
            {error.status ? `Error ${error.status}` : ERROR_MESSAGES.GENERIC}
          </p>
          <p className="mt-0.5 text-xs text-danger/80">{error.message}</p>
        </div>
        {onRetry ? (
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded bg-raised ${className}`} />;
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-mute">
      <Spinner className="h-5 w-5" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

const METHOD_TONE = {
  GET: 'info',
  POST: 'ok',
  PUT: 'amber',
  PATCH: 'amber',
  DELETE: 'danger',
};

export function EndpointBar({ tags }) {
  if (!tags?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-hair bg-surface p-3">
      {tags.map((tag, i) => (
        <div key={i} className="flex items-center gap-2">
          <Pill tone={METHOD_TONE[tag.method] || 'mute'}>{tag.method}</Pill>
          <span className="font-mono text-xs text-dim">{tag.path}</span>
        </div>
      ))}
    </div>
  );
}

export function Divider({ className = '', children }) {
  if (!children) {
    return <div className={`my-4 border-t border-hairsoft ${className}`} />;
  }

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="h-px flex-1 bg-hairsoft" />
      <span className="text-[10px] font-semibold tracking-[0.12em] text-mute">
        {children}
      </span>
      <div className="h-px flex-1 bg-hairsoft" />
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  message,
  icon = '!',
  danger = false,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  loading = false,
  onConfirm,
  onCancel,
}) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    window.setTimeout(() => cancelRef.current?.focus(), 0);

    function onKeyDown(event) {
      if (event.key === 'Escape' && !loading) onCancel?.();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [loading, onCancel, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ground/75 px-4 backdrop-blur-sm animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onCancel?.();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="theme-dialog w-full max-w-sm rounded-panel border border-hair bg-surface p-5 shadow-2xl"
      >
        <div className="flex gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-lg font-bold ${
              danger
                ? 'border-danger/50 bg-danger/10 text-danger'
                : 'border-amber/50 bg-amber/10 text-amber'
            }`}
            aria-hidden="true"
          >
            {icon}
          </div>
          <div className="min-w-0">
            <p id="confirm-title" className="text-[15px] font-semibold text-bone">
              {title}
            </p>
            <p id="confirm-message" className="mt-2 text-[12px] leading-relaxed text-mute">
              {message}
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={onCancel}
            className="h-9 px-4 text-[12px]"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? 'danger' : 'primary'}
            loading={loading}
            disabled={loading}
            onClick={onConfirm}
            className="h-9 px-4 text-[12px]"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
