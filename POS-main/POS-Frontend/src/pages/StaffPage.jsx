import { memo, useMemo, useState } from 'react';
import { useAuth, ROLES, ROLE_LABEL } from '../lib/auth';
import { employeesHooks } from '../features/employees';
import { useToast } from '../components/Toast';
import { Page } from '../components/Shell';
import { IconEye, IconEyeOff } from '../components/Icons';
import {
  Panel,
  Button,
  Input,
  Field,
  Pill,
  Avatar,
  Loading,
  ErrorBox,
  Empty,
  EndpointBar,
  ConfirmModal,
} from '../components/ui';

/** Mirrors CREATE_MATRIX in app/services/staff.py */
const CREATE_MATRIX = {
  [ROLES.BM]: [ROLES.SM],
  [ROLES.SM]: [ROLES.SP],
  [ROLES.SP]: [],
};

const ROLE_TONE = {
  [ROLES.BM]: 'amber',
  [ROLES.SM]: 'info',
  [ROLES.SP]: 'ok',
};

function passwordStrength(value) {
  const checks = [
    value.length >= 8,
    /[A-Z]/.test(value),
    /[a-z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value),
    value.length >= 12,
  ].filter(Boolean).length;
  if (!value) return { label: 'Weak', tone: 'danger', score: 0 };
  if (checks <= 2) return { label: 'Weak', tone: 'danger', score: 25 };
  if (checks <= 4) return { label: 'Medium', tone: 'amber', score: 55 };
  if (checks === 5) return { label: 'Strong', tone: 'ok', score: 78 };
  return { label: 'Very Strong', tone: 'ok', score: 100 };
}

function validateStaffForm({ code, name, phone, pw, email }) {
  const errors = {};
  const normalizedCode = code.trim().toUpperCase();
  const normalizedName = name.trim().replace(/\s+/g, ' ');
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[A-Z0-9_-]{2,40}$/.test(normalizedCode)) {
    errors.code = 'Use 2-40 letters, numbers, underscore, or hyphen.';
  }
  if (normalizedName.length < 2 || normalizedName.length > 80) {
    errors.name = 'Name must be 2-80 characters and cannot be only spaces.';
  }
  if (!/^[6-9]\d{9}$/.test(phone) || /^(\d)\1{9}$/.test(phone) || phone === '1234567890') {
    errors.phone = 'Enter 10 digits starting with 6, 7, 8, or 9.';
  }
  if (pw.length < 8 || pw.length > 64 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
    errors.pw = 'Use 8-64 chars with uppercase, lowercase, number, and special character.';
  }
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    errors.email = 'Enter a valid email address.';
  }
  return { errors, values: { normalizedCode, normalizedName, normalizedEmail } };
}

export default function StaffPage() {
  const { user } = useAuth();
  const query = employeesHooks.useList({ limit: 100 });
  const list = {
    data: query.data,
    error: query.error,
    loading: query.isLoading,
    fetching: query.isFetching,
    reload: query.refetch,
  };
  const canCreate = CREATE_MATRIX[user.role]?.length > 0;

  return (
    <Page title="Staff Management" subtitle={`Main Branch · ${list.data?.length ?? 0} members`}>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="min-w-0 space-y-3">
          <Hierarchy list={list} />
          {/* <EndpointBar
            tags={[
              { method: 'GET', path: '/staff' },
              { method: 'PATCH', path: '/staff/{id}/status' },
              { method: 'DELETE', path: '/staff/{id}' },
            ]}
          /> */}
        </div>

        <div className="space-y-5">
          <MatrixCard />
          {canCreate ? (
            <CreateStaff />
          ) : (
            <Panel className="p-6">
              <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">NEW STAFF</p>
              <p className="mt-3 text-[13px] text-dim">
                Your role cannot create staff members.
              </p>
            </Panel>
          )}
        </div>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------- hierarchy */
function Hierarchy({ list }) {
  const { user } = useAuth();
  const toast = useToast();
  const setStatusMutation = employeesHooks.useSetStatus();
  const removeMutation = employeesHooks.useRemove();
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const tree = useMemo(() => buildTree(list.data ?? []), [list.data]);

  if (list.loading && !list.data) return <Loading label="Loading staff…" />;
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  if (!(list.data ?? []).length) {
    return <Panel><Empty icon="◎" title="No staff" sub="Create the first member." /></Panel>;
  }

  async function toggle(s) {
    setBusy({ id: s.id, action: 'status' });
    try {
      await setStatusMutation.mutateAsync({ id: s.id, is_active: !s.is_active });
      toast.ok(`${s.full_name} ${s.is_active ? 'deactivated' : 'activated'}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  async function remove(s) {
    setBusy({ id: s.id, action: 'delete' });
    try {
      await removeMutation.mutateAsync({ id: s.id });
      toast.ok(`${s.full_name} deleted`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  function confirmAction() {
    if (!confirm) return;
    if (confirm.type === 'status') toggle(confirm.staff);
    if (confirm.type === 'delete') remove(confirm.staff);
  }

  return (
    <>
      <Panel className="overflow-hidden">
        <div className="flex items-baseline justify-between px-5 py-4">
          <span className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
            REPORTING HIERARCHY
          </span>
          <span className="font-mono text-[10px] text-mute">{list.data.length} staff</span>
        </div>

        <div className="border-t border-hairsoft">
          {tree.map((node) => (
            <StaffRow
              key={node.id}
              node={node}
              depth={0}
              busy={busy}
              currentUserId={user.id}
              canManageRole={user.role === ROLES.BM || user.role === ROLES.SM}
              canDeleteRole={user.role === ROLES.BM || user.role === ROLES.SM}
              onRequestStatus={(staff) => setConfirm({ type: 'status', staff })}
              onRequestDelete={(staff) => setConfirm({ type: 'delete', staff })}
            />
          ))}
        </div>
      </Panel>

      <ConfirmModal
        open={Boolean(confirm)}
        danger={confirm?.type === 'delete'}
        icon={confirm?.type === 'delete' ? '!' : 'i'}
        title={
          confirm?.type === 'delete'
            ? 'Delete Employee?'
            : `${confirm?.staff?.is_active ? 'Disable' : 'Enable'} Employee?`
        }
        message={
          confirm?.type === 'delete'
            ? `${confirm?.staff?.full_name} will be permanently removed. This action cannot be undone.`
            : `${confirm?.staff?.full_name} will be ${confirm?.staff?.is_active ? 'disabled' : 'enabled'}.`
        }
        confirmLabel={
          confirm?.type === 'delete'
            ? 'Delete'
            : confirm?.staff?.is_active
            ? 'Disable'
            : 'Enable'
        }
        loading={!!busy}
        onCancel={() => (busy ? null : setConfirm(null))}
        onConfirm={confirmAction}
      />
    </>
  );
}

/** Flat list -> nested by manager_id. Orphans (manager not visible) surface at root. */
function buildTree(rows) {
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const r of byId.values()) {
    const parent = r.manager_id != null ? byId.get(r.manager_id) : null;
    if (parent) parent.children.push(r);
    else roots.push(r);
  }
  const sort = (xs) => {
    xs.sort((a, b) => a.full_name.localeCompare(b.full_name));
    xs.forEach((x) => sort(x.children));
  };
  sort(roots);
  return roots;
}

const StaffRow = memo(function StaffRow({
  node,
  depth,
  busy,
  currentUserId,
  canManageRole,
  canDeleteRole,
  onRequestStatus,
  onRequestDelete,
}) {
  const isBusy = busy?.id === node.id;
  const canManage = canManageRole && node.id !== currentUserId;
  const canDelete = canDeleteRole && node.id !== currentUserId;
  return (
    <>
      <div
        className={`group flex flex-col gap-3 border-t border-hairsoft px-5 py-4 transition hover:bg-raised/60 sm:flex-row sm:items-center ${
          !node.is_active ? 'opacity-55' : ''
        } ${isBusy ? 'opacity-40' : ''}`}
        style={{ paddingLeft: 20 + depth * 34 }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {depth > 0 && <span className="-ml-4 text-mute">└</span>}
          <Avatar
            name={node.full_name}
            size={38}
            tone={node.role === ROLES.BM ? 'amber' : 'dim'}
          />
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold text-bone">{node.full_name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="font-mono text-[10.5px] text-mute">{node.employee_code}</p>
              <p className="font-mono text-[10.5px] text-dim">{node.phone_number || node.phone || '—'}</p>
            </div>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <Pill tone={ROLE_TONE[node.role]}>{ROLE_LABEL[node.role].toUpperCase()}</Pill>
          <Pill tone={node.is_active ? 'ok' : 'mute'}>
            {node.is_active ? 'ACTIVE' : 'INACTIVE'}
          </Pill>

          {canManage && (
            <ActionButtons
              staff={node}
              busy={busy}
              canDelete={canDelete}
              onRequestStatus={onRequestStatus}
              onRequestDelete={onRequestDelete}
            />
          )}
        </div>
      </div>

      {node.children.map((c) => (
        <StaffRow
          key={c.id}
          node={c}
          depth={depth + 1}
          busy={busy}
          currentUserId={currentUserId}
          canManageRole={canManageRole}
          canDeleteRole={canDeleteRole}
          onRequestStatus={onRequestStatus}
          onRequestDelete={onRequestDelete}
        />
      ))}
    </>
  );
});

function ActionButtons({ staff, busy, canDelete, onRequestStatus, onRequestDelete }) {
  const statusBusy = busy?.id === staff.id && busy?.action === 'status';
  const deleteBusy = busy?.id === staff.id && busy?.action === 'delete';
  const disabled = Boolean(busy);

  return (
    <div className="flex gap-2">
      <Button
        type="button"
        variant="secondary"
        loading={statusBusy}
        disabled={disabled}
        onClick={() => onRequestStatus(staff)}
        className="h-8 px-3 text-[11px] text-amber hover:border-amber/40 hover:bg-amber/10"
      >
        {staff.is_active ? 'Disable' : 'Enable'}
      </Button>
      {canDelete && (
        <Button
          type="button"
          variant="danger"
          loading={deleteBusy}
          disabled={disabled}
          onClick={() => onRequestDelete(staff)}
          className="h-8 px-3 text-[11px]"
        >
          Delete
        </Button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- matrix */
function MatrixCard() {
  const { user } = useAuth();
  const cols = [ROLES.BM, ROLES.SM, ROLES.SP];
  const short = { [ROLES.BM]: 'BM', [ROLES.SM]: 'SM', [ROLES.SP]: 'SP' };

  return (
    <Panel className="p-5">
      <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">CREATE MATRIX</p>
      <p className="mt-1 text-[10px] text-mute/70">who may create whom</p>

      <table className="mt-4 w-full">
        <thead>
          <tr className="border-b border-hairsoft">
            <th />
            {cols.map((c) => (
              <th key={c} className="pb-2 font-mono text-[10px] font-semibold text-mute">
                {short[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cols.map((r) => (
            <tr key={r} className={r === user.role ? 'bg-amber/[0.06]' : ''}>
              <td className="py-2.5 text-[12px] text-dim">{ROLE_LABEL[r]}</td>
              {cols.map((c) => {
                const yes = CREATE_MATRIX[r].includes(c);
                return (
                  <td
                    key={c}
                    className={`py-2.5 text-center text-[15px] font-bold ${
                      yes ? 'text-ok' : 'text-hair'
                    }`}
                  >
                    {yes ? '✔' : '✘'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-4 font-mono text-[9.5px] text-mute">
        enforced at route + service layer
      </p>
    </Panel>
  );
}

/* ---------------------------------------------------------------- create */
function Helper({ error, children }) {
  return (
    <span className={`mt-1 block text-[10px] ${error ? 'text-danger' : 'text-mute'}`}>
      {error || children}
    </span>
  );
}

function CreateStaff() {
  const { user } = useAuth();
  const toast = useToast();
  const createMutation = employeesHooks.useCreate();
  const allowed = CREATE_MATRIX[user.role] ?? [];
  const all = [ROLES.SM, ROLES.SP];

  const [role, setRole] = useState(allowed[0]);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [touched, setTouched] = useState({});
  const validation = useMemo(
    () => validateStaffForm({ code, name, phone, pw, email }),
    [code, name, phone, pw, email],
  );
  const strength = useMemo(() => passwordStrength(pw), [pw]);
  const visibleErrors = Object.fromEntries(
    Object.entries(validation.errors).filter(([key]) => touched[key]),
  );

  async function submit(e) {
    e.preventDefault();
    if (!allowed.includes(role)) return;
    const { errors, values } = validation;
    if (Object.keys(errors).length) {
      setTouched({ code: true, name: true, phone: true, email: true, pw: true });
      toast.error('Please fix the highlighted fields');
      return;
    }
    try {
      await createMutation.mutateAsync({
        role,
        employee_code: values.normalizedCode,
        full_name: values.normalizedName,
        phone,
        email: values.normalizedEmail || undefined,
        password: pw,
      });
      toast.ok(`${name} created`);
      setCode('');
      setName('');
      setPhone('');
      setEmail('');
      setPw('');
      setTouched({});
    } catch (e2) {
      toast.error(e2.message);
    }
  }

  return (
    <>
      <Panel className="p-5">
        <div className="flex items-center gap-3">
          <span className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
            NEW STAFF
          </span>
          <Pill tone="amber">AS {ROLE_LABEL[user.role].toUpperCase()}</Pill>
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <span className="mb-2 block text-[9px] font-semibold tracking-[0.09em] text-mute">
              ROLE
            </span>
            <div className="space-y-2">
              {all.map((r) => {
                const locked = !allowed.includes(r);
                const on = role === r;
                return (
                  <button
                    key={r}
                    type="button"
                    disabled={locked}
                    onClick={() => setRole(r)}
                    className={`flex w-full items-center gap-3 rounded-ctl border px-4 py-2.5 text-left transition ${
                      locked
                        ? 'cursor-not-allowed border-hair bg-raised/50 opacity-45'
                        : on
                        ? 'border-amber bg-amber/15'
                        : 'border-hair bg-raised hover:border-amber/40'
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border ${
                        on ? 'border-amber' : 'border-hair'
                      }`}
                    >
                      {on && <span className="h-1.5 w-1.5 rounded-full bg-amber" />}
                    </span>
                    <span
                      className={`flex-1 text-[13px] ${
                        on ? 'font-semibold text-amber' : 'text-dim'
                      }`}
                    >
                      {ROLE_LABEL[r]}
                    </span>
                    {locked && <span className="text-[12px] text-mute">🔒</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 font-mono text-[9.5px] text-mute">
              {ROLE_LABEL[user.role]} may only create{' '}
              {allowed.map((r) => ROLE_LABEL[r]).join(', ') || 'nobody'}
            </p>
          </div>

          <Field label="EMPLOYEE CODE">
            <Input
              mono
              required
              placeholder="SM003"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onBlur={() => setTouched((v) => ({ ...v, code: true }))}
              aria-invalid={Boolean(visibleErrors.code)}
            />
            <Helper error={visibleErrors.code}>Letters, numbers, underscore, or hyphen only.</Helper>
          </Field>
          <Field label="FULL NAME">
            <Input
              required
              placeholder="Nikhil Verma"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                setName((v) => v.trim().replace(/\s+/g, ' '));
                setTouched((v) => ({ ...v, name: true }));
              }}
              aria-invalid={Boolean(visibleErrors.name)}
            />
            <Helper error={visibleErrors.name}>Required, 2-80 characters.</Helper>
          </Field>
          <Field label="PHONE NUMBER">
            <div className="flex rounded-ctl border border-hair bg-raised focus-within:border-amber/60 focus-within:ring-1 focus-within:ring-amber/40">
              <span className="flex items-center border-r border-hair px-3 font-mono text-[13px] text-mute">
                +91
              </span>
              <Input
                mono
                required
                inputMode="numeric"
                maxLength={10}
                placeholder="9000041122"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                onBlur={() => setTouched((v) => ({ ...v, phone: true }))}
                className="border-0 bg-transparent focus:border-0 focus:ring-0"
                aria-invalid={Boolean(visibleErrors.phone)}
              />
            </div>
            <Helper error={visibleErrors.phone}>Enter only 10 digits after +91.</Helper>
          </Field>
          <Field label="EMAIL" hint="optional">
            <Input
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => {
                setEmail((v) => v.trim().toLowerCase());
                setTouched((v) => ({ ...v, email: true }));
              }}
              aria-invalid={Boolean(visibleErrors.email)}
            />
            <Helper error={visibleErrors.email}>Duplicates are checked case-insensitively.</Helper>
          </Field>
          <Field label="PASSWORD">
            <div className="relative">
              <Input
                type={showPw ? 'text' : 'password'}
                required
                minLength={8}
                maxLength={64}
                placeholder="Admin@123"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                onBlur={() => setTouched((v) => ({ ...v, pw: true }))}
                className="pr-11"
                aria-invalid={Boolean(visibleErrors.pw)}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-mute transition hover:text-bone"
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
              <div
                className={`h-full rounded-full ${
                  strength.tone === 'danger' ? 'bg-danger' : strength.tone === 'amber' ? 'bg-amber' : 'bg-ok'
                }`}
                style={{ width: `${strength.score}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px]">
              <span className={visibleErrors.pw ? 'text-danger' : 'text-mute'}>
                {visibleErrors.pw || 'Uppercase, lowercase, number, and special character.'}
              </span>
              <span className="font-mono text-mute">{strength.label}</span>
            </div>
          </Field>

          <Button type="submit" loading={createMutation.isPending} className="w-full py-3">
            CREATE STAFF
          </Button>
        </form>
      </Panel>
      {/* <EndpointBar tags={[{ method: 'POST', path: '/staff' }]} /> */}
    </>
  );
}
