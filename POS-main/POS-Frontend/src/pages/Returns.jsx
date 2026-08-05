import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { ApiError } from '../lib/api';
import { mediaUrl, qrApiBaseWithVersion } from '../config/appConfig';
import { useAuth, ROLES, ROLE_LABEL } from '../lib/auth';
import { invoicesHooks } from '../features/invoices';
import { returnsHooks } from '../features/returns';
import { money, rupees, dateStr, wholeQty, invoiceTotal } from '../lib/format';
import { useToast } from '../components/Toast';
import { Page } from '../components/Shell';
import { storeBranchLabel } from '../config/storeConfig';
import {
  Panel,
  Button,
  Input,
  Pill,
  Empty,
  Loading,
  ErrorBox,
  ConfirmModal,
} from '../components/ui';

/** Mirrors VALID_TRANSITIONS in app/services/returns.py */
const STAGES = ['submitted', 'verified', 'approved', 'reversal_generated', 'completed'];
const NEXT = {
  submitted: 'verified',
  verified: 'approved',
  approved: null, // -> use POST /process
};

function returnErrorMessage(err, fallback = 'Return transaction failed') {
  const message = err?.message || fallback;
  if (err?.code === 'CANCELLED') return 'Request was cancelled. No return change was completed.';
  if (err?.code === 'TIMEOUT') return 'Request timed out. Check the return status before retrying.';
  if (err?.status === 0) return 'Offline or network unavailable. No confirmed server response was received.';
  if (err?.status === 401) return 'Session expired. Please login again before continuing returns.';
  if (err?.status === 403) return 'You do not have permission to perform this return action.';
  if (err?.status === 409 || err?.status === 422) return message;
  if (err?.status >= 500) return 'Server could not complete the return transaction. Check status before retrying.';
  return message;
}

export default function ReturnsPage() {
  const { user } = useAuth();
  const [selected, setSelected] = useState(null);
  const list = returnsHooks.useList({ limit: 50 });

  useEffect(() => {
    if (!selected || !list.data) return;
    const fresh = list.data.find((row) => row.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [list.data, selected]);

  const applyReturnChange = useCallback(async (updated) => {
    if (updated) setSelected(updated);
  }, []);

  return (
    <Page title="Return & Reversal" subtitle={storeBranchLabel()} chip={selected?.return_number}>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="min-w-0 space-y-4">
          {selected ? (
            <ReturnDetail
              ret={selected}
              onBack={() => setSelected(null)}
              onChanged={applyReturnChange}
            />
          ) : (
            <ReturnList list={list} onSelect={setSelected} />
          )}
        </div>

        <div className="space-y-4">
          {user.role === ROLES.SP ? (
            <NewReturn onCreated={setSelected} />
          ) : (
            <Panel className="p-6">
              <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
                RAISE A RETURN
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-dim">
                Only a {ROLE_LABEL[ROLES.SP]} may submit a return at the counter. Managers
                verify, approve, and process.
              </p>
              {/* <div className="mt-4 rounded-ctl border border-hair bg-raised p-3">
                <p className="font-mono text-[10.5px] text-mute">
                  POST /returns → requires role sales_person
                </p>
              </div> */}
            </Panel>
          )}

          <LifecycleLegend />
        </div>
      </div>
    </Page>
  );
}

/* ------------------------------------------------------------------ list */
function ReturnList({ list, onSelect }) {
  if (list.isLoading && !list.data) return <Loading label="Loading returns…" />;
  if (list.error) return <ErrorBox error={list.error} onRetry={list.refetch} />;

  const rows = list.data ?? [];
  if (!rows.length) {
    return (
      <Panel>
        <Empty icon="↺" title="No returns yet" sub="Submitted returns appear here." />
      </Panel>
    );
  }

  return (
    <>
      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[11px] font-semibold tracking-[0.12em] text-mute">
            RETURNS
          </span>
          <span className="font-mono text-[11px] text-amber">{rows.length}</span>
        </div>
        <table className="w-full border-t border-hairsoft">
          <thead>
            <tr className="text-[9.5px] font-semibold tracking-wider text-mute">
              <th className="px-5 py-3 text-left">RETURN</th>
              <th className="py-3 text-left">DATE</th>
              <th className="py-3 text-center">ITEMS</th>
              <th className="py-3 text-right">REFUND</th>
              <th className="px-5 py-3 text-right">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={r.id}
                onClick={() => onSelect(r)}
                className={`cursor-pointer border-t border-hairsoft transition hover:bg-raised ${
                  i % 2 ? 'bg-raised/40' : ''
                }`}
              >
                <td className="px-5 py-3.5">
                  <p className="font-mono text-[13px] font-medium text-bone">
                    {r.return_number}
                  </p>
                  <p className="text-[10.5px] text-mute">
                    invoice #{r.original_invoice_id}
                  </p>
                </td>
                <td className="py-3.5 text-[12px] text-dim">{dateStr(r.return_date)}</td>
                <td className="py-3.5 text-center font-mono text-[13px] text-dim">
                  {r.items?.length ?? 0}
                </td>
                <td className="py-3.5 text-right font-mono text-[13.5px] font-semibold text-bone">
                  {rupees(r.refund_amount)}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <StatusPill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

function StatusPill({ status }) {
  const tone =
    status === 'completed'
      ? 'ok'
      : status === 'rejected'
      ? 'danger'
      : status === 'approved'
      ? 'amber'
      : 'info';
  return <Pill tone={tone}>{status.replace(/_/g, ' ').toUpperCase()}</Pill>;
}

/* ---------------------------------------------------------------- detail */
function ReturnDetail({ ret, onBack, onChanged }) {
  const { user } = useAuth();
  const toast = useToast();
  const advanceReturn = returnsHooks.useUpdate();
  const processReturn = returnsHooks.useProcess();
  const evidenceLinkMutation = returnsHooks.useEvidenceLink();
  const evidenceQuery = returnsHooks.useEvidence(ret.id, {
    enabled: false,
    placeholderData: ret.evidence ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [interState, setInterState] = useState(false);
  const [approvedNotice, setApprovedNotice] = useState(false);
  const [evidenceLink, setEvidenceLink] = useState(null);
  const [evidenceQr, setEvidenceQr] = useState('');
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceRows, setEvidenceRows] = useState(ret.evidence ?? []);

  const orig = invoicesHooks.useDetail(ret.original_invoice_id);
  const rev = invoicesHooks.useDetail(ret.reversal_invoice_id, {
    enabled: Boolean(ret.reversal_invoice_id),
  });

  const canAdvance = user.role === ROLES.BM || user.role === ROLES.SM;
  const canProcess = user.role === ROLES.BM;
  const next = NEXT[ret.status];
  const evidence = evidenceRows ?? [];
  const evidenceRequired = Boolean(ret.evidence_required);

  useEffect(() => {
    setEvidenceRows(ret.evidence ?? []);
  }, [ret.id, ret.evidence]);

  async function refreshEvidence({ silent = false } = {}) {
      setEvidenceBusy(true);
    try {
      const result = await evidenceQuery.refetch();
      const rows = result.data ?? [];
      setEvidenceRows(rows ?? []);
      if (!silent) toast.ok('Evidence refreshed');
      return rows ?? [];
    } catch (e) {
      if (!silent) toast.error(returnErrorMessage(e, 'Unable to refresh evidence'));
      return evidence;
    } finally {
      setEvidenceBusy(false);
    }
  }

  async function ensureEvidenceReady() {
    if (!evidenceRequired) return true;
    if (evidence.length > 0) return true;
    const rows = await refreshEvidence({ silent: true });
    if (rows.length > 0) return true;
    toast.error('Photo evidence is required before approval or processing');
    return false;
  }

  async function advance(status) {
    setBusy(true);
    try {
      if (status === 'approved' && !(await ensureEvidenceReady())) return;
      const updated = await advanceReturn.mutateAsync({ id: ret.id, status });
      if (status === 'approved' && user.role === ROLES.BM) {
        setApprovedNotice(true);
      } else {
        toast.ok(`Moved to ${status}`);
      }
      await onChanged(updated);
    } catch (e) {
      toast.error(returnErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function process() {
    setBusy(true);
    try {
      if (!(await ensureEvidenceReady())) return;
      const r = await processReturn.mutateAsync({ id: ret.id, interState });
      toast.ok(`Reversal generated · refund ${rupees(r.refund_amount)}`);
      await onChanged(r);
    } catch (e) {
      toast.error(returnErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function createEvidenceLink() {
    setEvidenceBusy(true);
    try {
      const link = await evidenceLinkMutation.mutateAsync({
        id: ret.id,
        apiBase: qrApiBaseWithVersion(),
      });
      setEvidenceLink(link);
      toast.ok('Evidence QR ready');
    } catch (e) {
      toast.error(returnErrorMessage(e));
    } finally {
      setEvidenceBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function renderQr() {
      if (!evidenceLink?.upload_url) {
        setEvidenceQr('');
        return;
      }
      const dataUrl = await QRCode.toDataURL(evidenceLink.upload_url, {
        margin: 1,
        width: 220,
      });
      if (!cancelled) setEvidenceQr(dataUrl);
    }
    renderQr().catch(() => {
      if (!cancelled) setEvidenceQr('');
    });
    return () => {
      cancelled = true;
    };
  }, [evidenceLink]);

  useEffect(() => {
    if (!evidenceLink || ret.status === 'completed' || ret.status === 'rejected') return undefined;
    const timer = window.setInterval(() => {
      refreshEvidence({ silent: true });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [evidenceLink, ret.id, ret.status]);

  const stageIdx = STAGES.indexOf(ret.status);

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-[12px] text-mute transition hover:text-bone"
      >
        ← All returns
      </button>

      {/* stepper */}
      <Panel className="p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
            RETURN LIFECYCLE
          </span>
          <span className="font-mono text-[11.5px] text-dim">{ret.return_number}</span>
        </div>

        {ret.status === 'rejected' ? (
          <div className="mt-5 rounded-ctl border border-danger/40 bg-danger/10 px-4 py-3 text-[13px] text-danger">
            This return was rejected. No reversal was generated.
          </div>
        ) : (
          <div className="mt-6 flex items-start">
            {STAGES.map((s, i) => {
              const done = i < stageIdx;
              const active = i === stageIdx;
              return (
                <div key={s} className="flex flex-1 flex-col items-center last:flex-none">
                  <div className="flex w-full items-center">
                    {i > 0 && (
                      <div
                        className={`h-0.5 flex-1 ${
                          i <= stageIdx ? 'bg-ok' : 'border-t border-dashed border-hair'
                        }`}
                      />
                    )}
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                        done
                          ? 'bg-ok text-on-primary'
                          : active
                          ? 'bg-amber text-on-primary'
                          : 'border border-hair bg-raised text-mute'
                      }`}
                    >
                      {done ? '✓' : i + 1}
                    </div>
                    {i < STAGES.length - 1 && (
                      <div
                        className={`h-0.5 flex-1 ${
                          i < stageIdx ? 'bg-ok' : 'border-t border-dashed border-hair'
                        }`}
                      />
                    )}
                  </div>
                  <span
                    className={`mt-2 text-center text-[8.5px] font-semibold tracking-wide ${
                      i <= stageIdx ? 'text-bone' : 'text-mute'
                    }`}
                  >
                    {s.replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* invoices */}
      {orig.isLoading ? (
        <Loading label="Loading invoice…" />
      ) : orig.data ? (
        <InvoiceCard invoice={orig.data} kind="original" />
      ) : null}

      <div className="flex items-center justify-center gap-3 py-0.5 font-mono text-[10px] text-mute">
        <span>original never mutated</span>
        <span className="text-danger">↓</span>
        <span>reversal issued instead</span>
      </div>

      {rev.data ? (
        <InvoiceCard invoice={rev.data} kind="reversal" linked={ret.original_invoice_id} />
      ) : (
        <Panel className="border-dashed p-5 text-center">
          <p className="text-[13px] text-mute">
            No reversal invoice yet — it is generated when the return is processed.
          </p>
        </Panel>
      )}

      {/* items */}
      <Panel className="overflow-hidden">
        <div className="px-5 py-4 text-[10.5px] font-semibold tracking-[0.12em] text-mute">
          RETURNED ITEMS
        </div>
        <table className="w-full border-t border-hairsoft">
          <thead>
            <tr className="text-[9px] font-semibold tracking-wider text-mute">
              <th className="px-5 py-2.5 text-left">PRODUCT</th>
              <th className="py-2.5 text-center">QTY</th>
              <th className="py-2.5 text-right">RATE</th>
              <th className="py-2.5 text-center">DAMAGE</th>
              <th className="px-5 py-2.5 text-right">REFUND</th>
            </tr>
          </thead>
          <tbody>
            {(ret.items ?? []).map((it, i) => (
              <tr key={it.id} className={`border-t border-hairsoft ${i % 2 ? 'bg-raised/40' : ''}`}>
                <td className="px-5 py-3 font-mono text-[12.5px] text-bone">#{it.product_id}</td>
                <td className="py-3 text-center font-mono text-[13px] text-dim">
                  {wholeQty(it.quantity)}
                </td>
                <td className="py-3 text-right font-mono text-[13px] text-dim">
                  {money(it.rate)}
                </td>
                <td className="py-3 text-center">
                  {it.damage_type ? <Pill tone="danger">{it.damage_type}</Pill> : '—'}
                </td>
                <td className="px-5 py-3 text-right font-mono text-[13.5px] font-semibold text-bone">
                  {money(it.line_refund)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
              PHOTO EVIDENCE
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-mute">
              Generate a QR code, scan it on a phone, then capture damaged or expired
              item photos directly into this return.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10.5px] text-mute">
                Uploaded images: {evidence.length}
              </span>
              {evidenceRequired ? <Pill tone={evidence.length ? 'ok' : 'amber'}>Required</Pill> : null}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              loading={evidenceBusy}
              onClick={() => refreshEvidence()}
              className="px-3 py-2 text-[12px]"
            >
              Refresh
            </Button>
            {ret.status === 'completed' || ret.status === 'rejected' ? null : (
              <Button
                variant="secondary"
                loading={evidenceBusy}
                onClick={createEvidenceLink}
                className="px-4 py-2"
              >
                QR
              </Button>
            )}
          </div>
        </div>

        {evidenceRequired && !evidence.length ? (
          <div className="mt-4 rounded-ctl border border-amber/40 bg-amber/10 px-4 py-3 text-[12px] text-amber">
            Photo evidence must be uploaded and reviewed before this return can be approved.
          </div>
        ) : null}

        {evidenceLink ? (
          <div className="mt-4 grid gap-4 rounded-ctl border border-hair bg-raised p-4 sm:grid-cols-[auto_1fr]">
            <div className="flex h-[220px] w-[220px] items-center justify-center rounded-ctl bg-receipt p-2">
              {evidenceQr ? (
                <img src={evidenceQr} alt="Return evidence upload QR" className="h-full w-full" />
              ) : (
                <span className="text-[12px] text-ground">Generating...</span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-bone">Scan with phone camera</p>
              <p className="mt-2 break-all font-mono text-[10.5px] text-mute">
                {evidenceLink.upload_url}
              </p>
              <p className="mt-3 text-[11px] text-mute">
                Link expires {dateStr(evidenceLink.expires_at)}. Generate a new QR if it expires.
              </p>
              <Button
                variant="ghost"
                onClick={() => navigator.clipboard?.writeText(evidenceLink.upload_url)}
                className="mt-3 px-3 py-2 text-[12px]"
              >
                Copy Link
              </Button>
            </div>
          </div>
        ) : null}

        {evidence.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {evidence.map((item) => (
              <EvidenceThumb key={item.id} item={item} />
            ))}
          </div>
        ) : null}
      </Panel>

      {/* actions */}
      <Panel className="p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
              REFUND DUE
            </p>
            <p className="mt-1 font-mono text-[11px] text-mute">
              {ret.resolution} · {ret.refund_method || 'cash'}
            </p>
          </div>
          <p className="font-mono text-[27px] font-bold text-danger">
            {rupees(ret.refund_amount)}
          </p>
        </div>

        {ret.status === 'completed' ? (
          <div className="mt-4 rounded-ctl border border-ok/40 bg-ok/10 px-4 py-3 text-center text-[13px] text-ok">
            ✓ Processed — reversal invoice generated, stock quarantined, refund recorded
          </div>
        ) : ret.status === 'rejected' ? null : (
          <div className="mt-5 space-y-3">
            {ret.status === 'approved' && canProcess && (
              <button
                onClick={() => setInterState((v) => !v)}
                className="flex w-full items-center justify-between rounded-ctl border border-hair bg-raised px-3 py-2"
              >
                <span className="text-[11px] text-dim">
                  {interState ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}
                </span>
                <span className={`h-4 w-8 rounded-full ${interState ? 'bg-amber' : 'bg-hair'}`} />
              </button>
            )}

            <div className="flex gap-2">
              {next && canAdvance && (
                <Button onClick={() => advance(next)} loading={busy} className="flex-1 py-2.5">
                  Mark {next}
                </Button>
              )}
              {ret.status === 'approved' && canProcess && (
                <Button onClick={process} loading={busy} className="flex-1 py-2.5">
                  PROCESS RETURN
                </Button>
              )}
              {canAdvance && ret.status !== 'approved' && (
                <Button
                  variant="danger"
                  onClick={() => advance('rejected')}
                  disabled={busy}
                  className="px-4 py-2.5"
                >
                  Reject
                </Button>
              )}
            </div>

            {!canAdvance && (
              <p className="text-center font-mono text-[10.5px] text-mute">
                managers advance the lifecycle
              </p>
            )}
            {ret.status === 'approved' && !canProcess && (
              <p className="text-center font-mono text-[10.5px] text-amber">
                only a {ROLE_LABEL[ROLES.BM]} may process the reversal
              </p>
            )}
          </div>
        )}
      </Panel>

      <ConfirmModal
        open={approvedNotice}
        icon="✓"
        title="Return Approved"
        message="Your refund request has been approved successfully. The refund amount will be credited within 3 business days."
        confirmLabel="Done"
        cancelLabel="Close"
        onCancel={() => setApprovedNotice(false)}
        onConfirm={() => setApprovedNotice(false)}
      />
    </div>
  );
}

function EvidenceThumb({ item }) {
  const [broken, setBroken] = useState(false);
  const url = mediaUrl(item.file_url);

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="overflow-hidden rounded-ctl border border-hair bg-raised"
    >
      {broken ? (
        <div className="flex h-24 w-full items-center justify-center bg-ground px-3 text-center text-[11px] text-mute">
          Image unavailable
        </div>
      ) : (
        <img
          src={url}
          alt={item.original_name}
          className="h-24 w-full bg-ground object-cover"
          onError={() => setBroken(true)}
        />
      )}
      <div className="truncate px-2 py-1.5 text-[10px] text-mute">
        {item.original_name}
      </div>
    </a>
  );
}

function InvoiceCard({ invoice, kind, linked }) {
  const reversal = kind === 'reversal';
  return (
    <Panel className={`relative overflow-hidden p-5 ${reversal ? 'border-danger bg-danger/[0.05]' : ''}`}>
      <span
        className={`absolute inset-y-0 left-0 w-[3px] ${reversal ? 'bg-danger' : 'bg-mute/50'}`}
      />
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span
              className={`text-[10px] font-semibold tracking-[0.11em] ${
                reversal ? 'text-danger' : 'text-mute'
              }`}
            >
              {reversal ? 'REVERSAL INVOICE' : 'ORIGINAL INVOICE'}
            </span>
            <Pill tone={reversal ? 'danger' : 'mute'}>
              {reversal ? 'is_reverse = TRUE' : 'IMMUTABLE'}
            </Pill>
          </div>
          <p className="mt-2 font-mono text-[19px] font-semibold text-bone">
            {invoice.invoice_number}
          </p>
          <p className="mt-1 text-[11.5px] text-mute">
            {reversal ? (
              <span className="font-mono">linked_invoice_id → #{linked}</span>
            ) : (
              invoice.party_name
            )}
          </p>
        </div>
        <div className="text-right">
          <p
            className={`font-mono text-[22px] font-bold ${
              reversal ? 'text-danger' : 'text-dim'
            }`}
          >
            {reversal ? '−' : ''}
            {rupees(invoiceTotal(invoice))}
          </p>
          <div className="mt-2 flex justify-end">
            <Pill tone={reversal ? 'danger' : 'ok'}>{invoice.status.toUpperCase()}</Pill>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------- new return */
function NewReturn({ onCreated }) {
  const toast = useToast();
  const lookupReturn = returnsHooks.useLookup();
  const createReturn = returnsHooks.useCreate();
  const [invNo, setInvNo] = useState('');
  const [invoice, setInvoice] = useState(null);
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('damaged');
  const [otherReason, setOtherReason] = useState('');
  const [rows, setRows] = useState([]);

  const reasons = [
    ['damaged', 'Damaged'],
    ['expired', 'Expired'],
    ['wrong_product', 'Wrong Product'],
    ['manufacturing_defect', 'Manufacturing Defect'],
    ['billing_error', 'Billing Error'],
    ['quality_issue', 'Quality Issue'],
    ['customer_changed_mind', 'Customer Changed Mind'],
    ['delivery_issue', 'Delivery Issue'],
    ['other', 'Other'],
  ];

  const total = useMemo(
    () => rows.reduce((s, r) => s + estimateLineRefund(r), 0),
    [rows],
  );

  async function lookup(e) {
    e.preventDefault();
    if (!invNo.trim()) return;
    setLooking(true);
    try {
      const inv = await lookupReturn.mutateAsync({ invoice_number: invNo.trim() });
      if (inv.is_reverse) {
        toast.error('Cannot return against a reversal invoice');
        return;
      }
      const lines = invoiceLines(inv);
      if (!lines.length) {
        toast.error('This invoice has no product lines available for return');
        return;
      }
      setInvoice(inv);
      setRows(lines.map((line) => ({ ...line, return_quantity: '' })));
    } catch (e2) {
      toast.error(e2 instanceof ApiError && e2.status === 404 ? 'Invoice not found' : returnErrorMessage(e2));
    } finally {
      setLooking(false);
    }
  }

  function patch(i, k, v) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  }

  async function submit() {
    if (!invoice || !rows.length) return;
    const originalInvoiceId = Number(invoice.id);
    if (!Number.isInteger(originalInvoiceId) || originalInvoiceId <= 0) {
      toast.error('Invoice lookup did not return a valid invoice id');
      return;
    }
    const selectedRows = rows.filter((r) => wholeQtyNumber(r.return_quantity) > 0);
    if (!selectedRows.length) {
      toast.error('Enter a return quantity for at least one invoice line');
      return;
    }
    const overLimit = selectedRows.find((r) => wholeQtyNumber(r.return_quantity) > wholeQtyNumber(lineQty(r)));
    if (overLimit) {
      toast.error(`Return quantity cannot exceed sold quantity for ${lineName(overLimit)}`);
      return;
    }
    if (reason === 'other' && !otherReason.trim()) {
      toast.error('Describe the return reason when Other is selected');
      return;
    }
    setBusy(true);
    try {
      const items = selectedRows.map((x) => {
        const invoiceItemId = Number(x.id);
        const productId = Number(x.product_id);
        const item = {
          quantity: wholeQtyNumber(x.return_quantity),
          damage_type: reason,
        };
        if (Number.isInteger(invoiceItemId) && invoiceItemId > 0) {
          item.invoice_item_id = invoiceItemId;
        } else if (Number.isInteger(productId) && productId > 0) {
          item.product_id = productId;
        }
        return item;
      });
      if (items.some((item) => !item.invoice_item_id && !item.product_id)) {
        toast.error('Selected return line is missing a product reference');
        return;
      }
      const r = await createReturn.mutateAsync({
        original_invoice_id: originalInvoiceId,
        reason: reason === 'other' ? otherReason.trim() : reasons.find(([id]) => id === reason)?.[1],
        resolution: 'refund',
        refund_method: 'cash',
        items,
      });
      toast.ok(`Return ${r.return_number} submitted`);
      setInvoice(null);
      setInvNo('');
      setRows([]);
      setReason('damaged');
      setOtherReason('');
      onCreated?.(r);
    } catch (e) {
      toast.error(returnErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel className="p-5">
        <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
          RAISE A RETURN
        </p>

        <form onSubmit={lookup} className="mt-3 flex gap-2">
          <Input
            mono
            placeholder="Invoice number"
            value={invNo}
            onChange={(e) => setInvNo(e.target.value)}
          />
          <Button variant="secondary" type="submit" className="px-4" loading={looking}>
            Find
          </Button>
        </form>

        {invoice && (
          <>
            <div className="mt-4 rounded-ctl border border-hair bg-raised p-3">
              <div className="flex justify-between">
                <span className="font-mono text-[12px] text-bone">{invoice.invoice_number}</span>
                <span className="font-mono text-[12px] text-dim">
                  {rupees(invoiceTotal(invoice))}
                </span>
              </div>
              <p className="mt-1 text-[10.5px] text-mute">
                {invoice.party_name} · {dateStr(invoice.date)}
              </p>
            </div>

            <div className="mt-4 space-y-3">
              {rows.map((r, i) => (
                <div key={i} className="rounded-ctl border border-hair bg-raised p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-semibold text-bone">
                        {lineName(r)}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-mute">
                        ID {r.product_id ?? '—'} · SKU {lineSku(r)} · BC {lineBarcode(r)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-mute">
                        {lineCategory(r)} · Sold {wholeQty(lineQty(r))} · GST {lineGst(r)}%
                      </p>
                    </div>
                    <Pill tone="mute">{money(lineRate(r))}</Pill>
                  </div>
                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    <Input
                      mono
                      type="number"
                      min="0"
                      max={wholeQty(lineQty(r))}
                      step="1"
                      placeholder="Return qty"
                      value={r.return_quantity}
                      onChange={(e) => patch(i, 'return_quantity', cleanWholeQtyInput(e.target.value, lineQty(r)))}
                    />
                    <span className="flex items-center rounded-ctl border border-hair bg-ground px-3 font-mono text-[12px] text-mute">
                      / {wholeQty(lineQty(r))}
                    </span>
                  </div>
                  <div className="mt-2 flex justify-between font-mono text-[10.5px] text-mute">
                    <span>Discount {money(lineDiscount(r))}</span>
                    <span>Est. refund {rupees(estimateLineRefund(r))}</span>
                  </div>
                </div>
              ))}

              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full rounded-ctl border border-hair bg-raised px-3.5 py-2.5 text-[13px] text-bone focus:border-amber/60 focus:outline-none focus:ring-1 focus:ring-amber/40"
              >
                {reasons.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>

              {reason === 'other' && (
                <Input
                  required
                  placeholder="Describe the return reason"
                  value={otherReason}
                  onChange={(e) => setOtherReason(e.target.value)}
                />
              )}

              <p className="rounded-ctl border border-hair bg-raised px-3 py-2 text-[10.5px] text-mute">
                After submitting, open the return and generate a QR code so a phone can
                capture damaged or expired item photos.
              </p>

              <div className="flex items-center justify-between rounded-ctl border border-danger/35 bg-danger/10 px-4 py-3">
                <span className="text-[11px] text-mute">Est. refund</span>
                <span className="font-mono text-[16px] font-bold text-danger">
                  {rupees(total)}
                </span>
              </div>

              <Button onClick={submit} loading={busy || createReturn.isPending} className="w-full py-3">
                Submit Return
              </Button>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

function invoiceLines(invoice) {
  const rows = invoice?.lines || invoice?.items || invoice?.order_items || invoice?.products;
  return Array.isArray(rows) ? rows : [];
}

function lineName(line) {
  return line.product_name || line.name || `Product #${line.product_id ?? '—'}`;
}

function lineQty(line) {
  return line.quantity ?? line.qty ?? 0;
}

function wholeQtyNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function cleanWholeQtyInput(value, maxValue) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  const max = wholeQtyNumber(maxValue);
  const next = Number(digits);
  return String(max > 0 ? Math.min(next, max) : next);
}

function lineRate(line) {
  return line.rate ?? line.unit_price ?? line.price ?? 0;
}

function lineGst(line) {
  return line.gst_rate ?? line.gst ?? line.tax_rate ?? 0;
}

function lineSku(line) {
  return line.sku || '—';
}

function lineBarcode(line) {
  return line.barcode || '—';
}

function lineCategory(line) {
  return line.category || '—';
}

function lineDiscount(line) {
  return line.discount_amount ?? line.discount ?? 0;
}

function estimateLineRefund(line) {
  const soldQty = wholeQtyNumber(lineQty(line));
  const returnQty = wholeQtyNumber(line.return_quantity);
  if (!soldQty || !returnQty) return 0;
  const discountPerUnit = Number(lineDiscount(line) || 0) / soldQty;
  const taxable = Math.max(0, (Number(lineRate(line) || 0) - discountPerUnit) * returnQty);
  return taxable + (taxable * Number(lineGst(line) || 0)) / 100;
}

function LifecycleLegend() {
  return (
    <Panel className="p-5">
      <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
        AUTO-PROCESSING
      </p>
      <p className="mt-2 text-[11px] text-mute">
        What <span className="font-mono text-dim">POST /returns/{'{id}'}/process</span> does,
        atomically:
      </p>
      <ol className="mt-4 space-y-3">
        {[
          ['Reversal invoice generated', 'is_reverse=TRUE · linked to original', 'text-danger'],
          ['Stock → damaged_inventory', 'disposition = quarantined', 'text-amber'],
          ['Refund payment recorded', 'direction = out', 'text-ok'],
          ['Return marked completed', 'transition locked', 'text-mute'],
        ].map(([t, s, c], i) => (
          <li key={t} className="flex gap-3">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-current/40 bg-current/10 text-[11px] font-bold ${c}`}
            >
              {i + 1}
            </span>
            <div>
              <p className="text-[12.5px] text-bone">{t}</p>
              <p className="font-mono text-[10px] text-mute">{s}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 border-t border-hairsoft pt-3 font-mono text-[10px] text-mute">
        requires status = approved · {ROLE_LABEL[ROLES.BM]} only
      </p>
    </Panel>
  );
}

