import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JsBarcode from 'jsbarcode';
import { useAuth, ROLES } from '../lib/auth';
import { invoicesHooks } from '../features/invoices';
import { settingsHooks } from '../features/settings';
import { useToast } from '../components/Toast';
import { wholeCurrency as money, wholeCurrency as rupees, dateStr, timeStr, invoiceTotal, methodLabel } from '../lib/format';
import { Page } from '../components/Shell';
import {
  STORE_CONFIG,
  storeFromBranding,
  storeBranchLabel,
  storeGstinLabel,
} from '../config/storeConfig';
import {
  Panel,
  Pill,
  Button,
  Loading,
  ErrorBox,
  Empty,
} from '../components/ui';

export default function InvoicesPage() {
  const [selected, setSelected] = useState(null);
  const branding = settingsHooks.useInvoiceBranding();
  const list = invoicesHooks.useList({ limit: 50 });
  const store = branding.data ? storeFromBranding(branding.data) : STORE_CONFIG;

  return (
    <Page
      title={selected ? 'Invoice Detail' : 'Invoices'}
      subtitle={storeBranchLabel(store)}
      chip={selected?.invoice_number}
    >
      {selected ? (
        <Detail invoice={selected} store={store} onBack={() => setSelected(null)} />
      ) : (
        <List list={list} onSelect={setSelected} />
      )}
    </Page>
  );
}

function List({ list, onSelect }) {
  const { user } = useAuth();
  if (list.isLoading && !list.data) return <Loading label="Loading invoices…" />;
  if (list.error) return <ErrorBox error={list.error} onRetry={list.refetch} />;

  const rows = list.data ?? [];
  if (!rows.length) {
    return <Panel><Empty icon="⎘" title="No invoices" sub="Completed sales appear here." /></Panel>;
  }

  return (
    <div className="space-y-3">
      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[11px] font-semibold tracking-[0.12em] text-mute">INVOICES</span>
          <span className="font-mono text-[11px] text-amber">{rows.length}</span>
        </div>
        <table className="w-full border-t border-hairsoft">
          <thead>
            <tr className="text-[9.5px] font-semibold tracking-wider text-mute">
              <th className="px-5 py-3 text-left">NUMBER</th>
              <th className="py-3 text-left">CUSTOMER</th>
              <th className="py-3 text-left">DATE</th>
              <th className="py-3 text-right">TAXABLE</th>
              <th className="py-3 text-right">TOTAL</th>
              <th className="px-5 py-3 text-right">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv, i) => (
              <tr
                key={inv.id}
                onClick={() => onSelect(inv)}
                className={`cursor-pointer border-t border-hairsoft transition hover:bg-raised ${
                  i % 2 ? 'bg-raised/40' : ''
                } ${inv.is_reverse ? 'bg-danger/[0.04]' : ''}`}
              >
                <td className="px-5 py-3.5">
                  <p className="font-mono text-[13px] font-medium text-bone">
                    {inv.invoice_number}
                  </p>
                  {inv.is_reverse && (
                    <p className="font-mono text-[10px] text-danger">
                      reversal → #{inv.linked_invoice_id}
                    </p>
                  )}
                </td>
                <td className="py-3.5 text-[12.5px] text-dim">{inv.party_name}</td>
                <td className="py-3.5 text-[12px] text-mute">{dateStr(inv.date)}</td>
                <td className="py-3.5 text-right font-mono text-[12.5px] text-dim">
                  {money(inv.taxable_value)}
                </td>
                <td
                  className={`py-3.5 text-right font-mono text-[13.5px] font-semibold ${
                    inv.is_reverse ? 'text-danger' : 'text-bone'
                  }`}
                >
                  {inv.is_reverse ? '−' : ''}
                  {rupees(invoiceTotal(inv))}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <Pill tone={inv.is_reverse ? 'danger' : 'ok'}>
                    {inv.status.toUpperCase()}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {user.role === ROLES.SP && (
        <p className="font-mono text-[10px] text-mute">
          scoped server-side — you see only your own invoices
        </p>
      )}
    </div>
  );
}

function Detail({ invoice, store, onBack }) {
  const { user } = useAuth();
  const toast = useToast();
  const canSeePayments = user.role !== ROLES.SP;
  const canResend = user.role === ROLES.BM;
  const pay = invoicesHooks.usePayments(invoice.id, { enabled: canSeePayments });
  const notifications = invoicesHooks.useNotifications(invoice.id);
  const resendNotification = invoicesHooks.useResendNotification({
    onSuccess: (_data, variables) => toast.ok(`${variables.channel.toUpperCase()} queued`),
  });

  const total = invoiceTotal(invoice);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-[12px] text-mute transition hover:text-bone">
        ← All invoices
      </button>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-3">
          <Panel className="relative overflow-hidden p-6">
            <span
              className={`absolute inset-y-0 left-0 w-[3px] ${
                invoice.is_reverse ? 'bg-danger' : 'bg-ok/80'
              }`}
            />
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-mono text-[25px] font-bold text-bone">
                {invoice.invoice_number}
              </h2>
              <Pill tone={invoice.is_reverse ? 'danger' : 'ok'}>
                {invoice.status.toUpperCase()}
              </Pill>
              <Pill tone="mute">IMMUTABLE</Pill>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
              <Meta
                label="BILLED TO"
                a={invoice.customer_id ? invoice.party_name : '—'}
                b={invoice.customer_id ? `customer #${invoice.customer_id}` : ''}
              />
              <Meta label="SOLD BY" a={`staff #${invoice.staff_id ?? '—'}`} b={`outlet #${invoice.outlet_id ?? '—'}`} />
              <Meta label="ISSUED" a={dateStr(invoice.date)} b={timeStr(invoice.created_at)} />
              <Meta
                label="METHOD"
                a={methodLabel(invoice.payment_method)}
                b={`${rupees(total)} tendered`}
              />
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4">
              <span className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
                PRODUCT SNAPSHOTS
              </span>
              <span className="font-mono text-[10px] text-mute">{invoiceLines(invoice).length} lines</span>
            </div>
            <div className="overflow-x-auto border-t border-hairsoft">
              <table className="w-full min-w-[760px] text-left">
                <thead className="text-[9px] font-semibold tracking-wider text-mute">
                  <tr>
                    <th className="px-6 py-3">PRODUCT</th>
                    <th className="py-3">SKU / BARCODE</th>
                    <th className="py-3">CATEGORY</th>
                    <th className="py-3 text-right">QTY</th>
                    <th className="py-3 text-right">UNIT</th>
                    <th className="py-3 text-right">DISCOUNT</th>
                    <th className="py-3 text-right">TAX</th>
                    <th className="px-6 py-3 text-right">TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceLines(invoice).map((line, index) => (
                    <tr key={line.id || index} className="border-t border-hairsoft text-[12px]">
                      <td className="px-6 py-3">
                        <p className="font-semibold text-bone">{lineName(line)}</p>
                        <p className="font-mono text-[10px] text-mute">ID {line.product_id ?? '—'} · MRP {lineMrp(line) != null ? money(lineMrp(line)) : '—'}</p>
                      </td>
                      <td className="py-3 font-mono text-[10.5px] text-dim">{lineSku(line)} / {lineBarcode(line)}</td>
                      <td className="py-3 text-dim">{lineCategory(line)}</td>
                      <td className="py-3 text-right font-mono text-dim">{lineQty(line)}</td>
                      <td className="py-3 text-right font-mono text-dim">{money(lineRate(line))}</td>
                      <td className="py-3 text-right font-mono text-dim">{money(lineDiscount(line))}</td>
                      <td className="py-3 text-right font-mono text-dim">{money(lineTax(line))}</td>
                      <td className="px-6 py-3 text-right font-mono font-semibold text-bone">{money(lineTotal(line))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!invoiceLines(invoice).length ? (
                <p className="px-6 py-5 text-[12px] text-mute">Product line details unavailable for this invoice record.</p>
              ) : null}
            </div>
          </Panel>

          <Panel className="p-6">
            <span className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
              TAX BREAKDOWN
            </span>
            <div className="mt-4 space-y-2">
              <Line label="Taxable value" value={money(invoice.taxable_value)} />
              <Line label="CGST" value={money(invoice.cgst)} faded={Number(invoice.cgst) === 0} />
              <Line label="SGST" value={money(invoice.sgst)} faded={Number(invoice.sgst) === 0} />
              <Line label="IGST" value={money(invoice.igst)} faded={Number(invoice.igst) === 0} />
            </div>
            <div className="mt-4 flex items-end justify-between border-t border-hairsoft pt-4">
              <span className="text-[10.5px] font-semibold tracking-[0.12em] text-amber">
                GRAND TOTAL
              </span>
              <span
                className={`font-mono text-[26px] font-bold ${
                  invoice.is_reverse ? 'text-danger' : 'text-amber'
                }`}
              >
                {invoice.is_reverse ? '−' : ''}
                {rupees(total)}
              </span>
            </div>
          </Panel>

          {canSeePayments && (
            <div className="space-y-3">
              <Panel className="p-6">
                <span className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
                  PAYMENTS
                </span>
                {pay.isLoading ? (
                  <Loading />
                ) : !(pay.data ?? []).length ? (
                  <p className="mt-4 text-[12px] text-mute">No payments recorded.</p>
                ) : (
                  <div className="mt-4 space-y-2">
                    {pay.data.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-ctl border border-hair bg-raised px-4 py-2.5"
                      >
                        <div className="flex items-center gap-3">
                          <Pill tone={p.direction === 'in' ? 'ok' : 'danger'}>
                            {p.direction === 'in' ? 'IN' : 'OUT'}
                          </Pill>
                          <span className="text-[12.5px] text-dim">{methodLabel(p.method)}</span>
                        </div>
                        <span className="font-mono text-[13px] font-semibold text-bone">
                          {rupees(p.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          )}

          <Panel className="p-6">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
                NOTIFICATIONS
              </span>
              <span className="font-mono text-[10px] text-mute">
                {(notifications.data ?? []).length} records
              </span>
            </div>
            {notifications.isLoading && !notifications.data ? (
              <Loading />
            ) : notifications.error ? (
              <ErrorBox error={notifications.error} onRetry={notifications.refetch} />
            ) : !(notifications.data ?? []).length ? (
              <p className="mt-4 text-[12px] text-mute">No notification records for this invoice.</p>
            ) : (
              <div className="mt-4 space-y-2">
                {(notifications.data ?? []).map((row) => (
                  <NotificationRow
                    key={row.id}
                    row={row}
                    canResend={canResend}
                    onResend={async () => {
                      try {
                        await resendNotification.mutateAsync({
                          invoiceId: invoice.id,
                          channel: row.channel,
                        });
                      } catch (err) {
                        toast.error(err.message);
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-3">
          <Receipt invoice={invoice} total={total} store={store} />
          <Button variant="secondary" className="w-full py-2.5" onClick={() => printReceipt(invoice, store)}>
            Print receipt
          </Button>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, a, b }) {
  return (
    <div>
      <p className="text-[9px] font-semibold tracking-[0.09em] text-mute">{label}</p>
      <p className="mt-1.5 text-[13.5px] font-medium text-bone">{a}</p>
      {b ? <p className="font-mono text-[10.5px] text-mute">{b}</p> : null}
    </div>
  );
}

function NotificationRow({ row, canResend, onResend }) {
  const tone = row.status === 'sent' ? 'ok' : row.status === 'failed' ? 'danger' : row.status === 'queued' ? 'amber' : 'mute';
  return (
    <div className="rounded-ctl border border-hair bg-raised px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Pill tone={tone}>{row.status.toUpperCase()}</Pill>
            <span className="font-mono text-[12px] uppercase text-dim">{row.channel}</span>
            <span className="font-mono text-[11px] text-mute">{row.phone || 'no phone'}</span>
          </div>
          <p className="mt-2 font-mono text-[10.5px] text-mute">
            Attempts {row.attempts} · Sent {row.sent_at ? timeStr(row.sent_at) : '-'} · SID {row.twilio_sid || '-'}
          </p>
          {row.error_message ? (
            <p className="mt-1 text-[11px] text-danger">{row.error_message}</p>
          ) : null}
        </div>
        {canResend ? (
          <Button variant="secondary" className="px-3 py-1.5 text-[11px]" onClick={onResend}>
            Resend
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Line({ label, value, faded }) {
  return (
    <div className={`flex justify-between ${faded ? 'opacity-40' : ''}`}>
      <span className="text-[12.5px] text-mute">{label}</span>
      <span className="font-mono text-[13px] text-dim">{value}</span>
    </div>
  );
}

function invoiceLines(invoice) {
  const rows = invoice?.lines || invoice?.items || invoice?.order_items || invoice?.products;
  return Array.isArray(rows) ? rows : [];
}

function lineName(line) {
  return line.product_name || line.name || line.description || `Product #${line.product_id ?? '—'}`;
}

function lineQty(line) {
  return line.quantity ?? line.qty ?? 1;
}

function lineRate(line) {
  return line.rate ?? line.unit_price ?? line.price ?? 0;
}

function lineGst(line) {
  return line.gst_rate ?? line.gst ?? line.tax_rate ?? 0;
}

function lineTotal(line) {
  return line.line_total ?? line.total ?? Number(lineRate(line)) * Number(lineQty(line));
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

function lineMrp(line) {
  return line.mrp ?? null;
}

function lineDiscount(line) {
  return line.discount_amount ?? line.discount ?? 0;
}

function lineTax(line) {
  return line.tax_amount ?? line.tax ?? 0;
}

function Receipt({ invoice, total, store = STORE_CONFIG }) {
  const barcodeRef = useRef(null);

  useEffect(() => {
    if (!barcodeRef.current || !invoice?.invoice_number) return;
    JsBarcode(barcodeRef.current, invoice.invoice_number, {
      format: 'CODE128',
      width: 1.2,
      height: 40,
      displayValue: true,
      font: 'monospace',
      fontSize: 9,
      margin: 0,
    });
  }, [invoice?.invoice_number]);

  return (
    <div className="relative overflow-hidden rounded-t bg-receipt px-5 pb-6 pt-6 text-receipt-text shadow-lg print:shadow-none">
      <div className="relative">
      <p className="text-center text-[15px] font-bold tracking-[0.16em]">{store.name}</p>
      {storeBranchLabel(store) && (
        <p className="mt-1 text-center text-[9px] text-secondary">{storeBranchLabel(store)}</p>
      )}
      {storeGstinLabel(store) && (
        <p className="text-center font-mono text-[9px] text-secondary">{storeGstinLabel(store)}</p>
      )}

      <div className="my-3 border-t border-dashed border-receipt-border" />

      <div className="flex justify-between font-mono text-[9.5px]">
        <span className="font-bold">TAX INVOICE</span>
        <span className="text-secondary">{invoice.invoice_number}</span>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-secondary">
        <span>{dateStr(invoice.date)}</span>
        <span>staff #{invoice.staff_id}</span>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-secondary">
        <span>{timeStr(invoice.created_at)}</span>
        <span>{methodLabel(invoice.payment_method)}</span>
      </div>

      <div className="my-3 border-t border-dashed border-receipt-border" />

      {invoice.customer_id ? (
        <>
          <div className="space-y-1.5 font-mono text-[9px] text-secondary">
            <Rrow l="Customer" v={invoice.party_name || 'Customer'} />
            <Rrow l="Customer ID" v={invoice.customer_id} />
          </div>

          <div className="my-3 border-t border-dashed border-receipt-border" />
        </>
      ) : null}

      <ReceiptItems invoice={invoice} />

      <div className="my-3 border-t border-dashed border-receipt-border" />

      <div className="space-y-1.5 font-mono text-[9px] text-secondary">
        <Rrow l="Taxable" v={money(invoice.taxable_value)} />
        <Rrow l="CGST" v={money(invoice.cgst)} />
        <Rrow l="SGST" v={money(invoice.sgst)} />
        <Rrow l="IGST" v={money(invoice.igst)} />
      </div>

      <div className="mt-4 flex items-center justify-between rounded-sm bg-primary px-3 py-2">
        <span className="font-mono text-[10.5px] font-bold tracking-wide text-inverse">
          TOTAL
        </span>
        <span className="font-mono text-[12.5px] font-bold text-inverse">
          {rupees(total)}
        </span>
      </div>

      <div className="mt-3 flex justify-between font-mono text-[9px] uppercase text-secondary">
        <span>{methodLabel(invoice.payment_method)}</span>
        <span>{money(total)}</span>
      </div>

      <div className="mt-5 flex justify-center overflow-hidden">
        <svg ref={barcodeRef} className="max-w-full" />
      </div>
      <p className="mt-2 text-center text-[8px] text-secondary">{store.receiptFooter}</p>
      <p className="mt-1 text-center text-[8px] text-secondary">
        Computer Generated Invoice
      </p>
      </div>
    </div>
  );
}

function ReceiptItems({ invoice }) {
  const rows = invoiceLines(invoice);
  if (!rows.length) {
    return (
      <div className="rounded-sm border border-receipt-border px-2 py-2 text-center text-[9px] text-secondary">
        Product line details unavailable for this invoice record.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((line, index) => (
        <div key={line.id || line.order_item_id || index} className="font-mono text-[9px]">
          <div className="font-semibold text-receipt-text">{lineName(line)}</div>
          <div className="mt-0.5 text-secondary">
            ID {line.product_id ?? '—'} · SKU {lineSku(line)} · BC {lineBarcode(line)}
          </div>
          <div className="mt-0.5 text-secondary">
            Category {lineCategory(line)}{lineMrp(line) != null ? ` · MRP ${money(lineMrp(line))}` : ''}
          </div>
          <div className="mt-0.5 flex justify-between text-secondary">
            <span>
              Qty: {lineQty(line)} x {rupees(lineRate(line))}
            </span>
            <span>GST {lineGst(line)}%</span>
          </div>
          <div className="mt-0.5 flex justify-between text-secondary">
            <span>Discount {money(lineDiscount(line))}</span>
            <span>Tax {money(lineTax(line))}</span>
          </div>
          <div className="mt-0.5 text-right font-semibold text-receipt-text">
            Total {rupees(lineTotal(line))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Rrow({ l, v }) {
  return (
    <div className="flex justify-between">
      <span>{l}</span>
      <span className="text-receipt-text">{v}</span>
    </div>
  );
}

function receiptStyles() {
  return `
    @page { size: auto; margin: 5mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      background: #fff;
      color: #111111;
      font-family: Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body { padding: 0; }
    .receipt {
      position: relative;
      width: 80mm;
      max-width: 100%;
      margin: 0 auto;
      overflow: hidden;
      background: #FFFFFF;
      color: #111111;
      padding: 6mm 5mm;
      font-size: 9px;
      line-height: 1.35;
    }
    .receipt-content { position: relative; z-index: 1; }
    .center { text-align: center; }
    .store { font-size: 15px; font-weight: 800; letter-spacing: 0.16em; }
    .muted { color: #222222; }
    .mono { font-family: "Courier New", monospace; }
    .rule { border-top: 1px dashed #6B7280; margin: 10px 0; }
    .row { display: flex; justify-content: space-between; gap: 10px; }
    .row span:last-child { text-align: right; color: #111111; }
    .section-title {
      margin-bottom: 5px;
      font-size: 8px;
      font-weight: 800;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #222222;
    }
    .item { margin-bottom: 8px; font-family: "Courier New", monospace; }
    .item-name { font-weight: 700; color: #111111; overflow-wrap: anywhere; }
    .item-line { margin-top: 2px; display: flex; justify-content: space-between; gap: 8px; color: #222222; }
    .item-total { margin-top: 2px; text-align: right; font-weight: 700; color: #111111; }
    .unavailable {
      border: 1px solid #6B7280;
      border-radius: 2px;
      padding: 7px;
      text-align: center;
      color: #222222;
    }
    .total-box {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 12px;
      border-radius: 3px;
      background: #111111;
      color: #FFFFFF;
      padding: 8px 10px;
      font-family: "Courier New", monospace;
      font-weight: 800;
      letter-spacing: 0.04em;
    }
    .total-box span:last-child { white-space: nowrap; }
    .total-box span { color: #fff; }
    .payment { margin-top: 10px; text-transform: uppercase; }
    .barcode-wrap { margin-top: 14px; display: flex; justify-content: center; overflow: hidden; }
    #invoice-barcode { max-width: 100%; }
    .footer { margin-top: 10px; text-align: center; color: #222222; }
  `;
}

function PrintableReceipt({ invoice, store = STORE_CONFIG }) {
  const total = invoiceTotal(invoice);
  const rows = invoiceLines(invoice);

  return (
    <main className="receipt">
      <div className="receipt-content">
        <div className="center">
          <div className="store">{store.name}</div>
          {storeBranchLabel(store) && <div className="muted">{storeBranchLabel(store)}</div>}
          {storeGstinLabel(store) && <div className="mono muted">{storeGstinLabel(store)}</div>}
        </div>

      <div className="rule" />

      <div className="row mono">
        <strong>TAX INVOICE</strong>
        <span className="muted">{invoice.invoice_number}</span>
      </div>
      <div className="row mono muted">
        <span>{dateStr(invoice.date)}</span>
        <span>{timeStr(invoice.created_at)}</span>
      </div>
      <div className="row mono muted">
        <span>staff #{invoice.staff_id ?? '—'}</span>
        <span>{methodLabel(invoice.payment_method)}</span>
      </div>

      <div className="rule" />

      {invoice.customer_id ? (
        <>
          <div className="section-title">Customer Details</div>
          <div className="row mono muted"><span>Name</span><span>{invoice.party_name || 'Customer'}</span></div>
          <div className="row mono muted"><span>Customer ID</span><span>{invoice.customer_id}</span></div>

          <div className="rule" />
        </>
      ) : null}

      <div className="section-title">Product Details</div>
      {rows.length ? (
        rows.map((line, index) => (
          <div className="item" key={line.id || line.order_item_id || index}>
            <div className="item-name">{lineName(line)}</div>
            <div className="item-line">
              <span>ID {line.product_id ?? '—'}</span>
              <span>SKU {lineSku(line)}</span>
            </div>
            <div className="item-line">
              <span>Barcode {lineBarcode(line)}</span>
              <span>{lineCategory(line)}</span>
            </div>
            {lineMrp(line) != null ? (
              <div className="item-line">
                <span>MRP {money(lineMrp(line))}</span>
                <span>Discount {money(lineDiscount(line))}</span>
              </div>
            ) : null}
            <div className="item-line">
              <span>Qty: {lineQty(line)} x {rupees(lineRate(line))}</span>
              <span>GST {lineGst(line)}%</span>
            </div>
            <div className="item-line">
              <span>Tax {money(lineTax(line))}</span>
              <span>Line {money(lineTotal(line))}</span>
            </div>
            <div className="item-total">Total {rupees(lineTotal(line))}</div>
          </div>
        ))
      ) : (
        <div className="unavailable">Product line details unavailable for this invoice record.</div>
      )}

      <div className="rule" />

      <div className="section-title">Tax Summary</div>
      <div className="mono muted">
        <div className="row"><span>Taxable Amount</span><span>{money(invoice.taxable_value)}</span></div>
        <div className="row"><span>CGST</span><span>{money(invoice.cgst)}</span></div>
        <div className="row"><span>SGST</span><span>{money(invoice.sgst)}</span></div>
        <div className="row"><span>IGST</span><span>{money(invoice.igst)}</span></div>
      </div>

      <div className="total-box">
        <span>TOTAL</span>
        <span>{rupees(total)}</span>
      </div>

      <div className="payment row mono muted">
        <span>{methodLabel(invoice.payment_method)}</span>
        <span>{money(total)}</span>
      </div>

      <div className="barcode-wrap">
        <svg id="invoice-barcode" />
      </div>

      <div className="footer">
        <div>{store.name}</div>
        <div>{store.receiptFooter}</div>
      </div>
      </div>
    </main>
  );
}

function waitForImages(doc) {
  const images = Array.from(doc.images || []);
  return Promise.all(
    images.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }),
  );
}

async function printReceipt(invoice, store = STORE_CONFIG) {
  const win = window.open('', '_blank', 'width=420,height=720');
  if (!win) return;

  const html = renderToStaticMarkup(<PrintableReceipt invoice={invoice} store={store} />);

  win.document.open();
  win.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${invoice?.invoice_number || 'Receipt'}</title>
        <style>${receiptStyles()}</style>
      </head>
      <body>${html}</body>
    </html>
  `);
  win.document.close();

  await new Promise((resolve) => {
    if (win.document.readyState === 'complete') resolve();
    else win.addEventListener('load', resolve, { once: true });
  });

  const barcode = win.document.getElementById('invoice-barcode');
  if (barcode && invoice?.invoice_number) {
    JsBarcode(barcode, invoice.invoice_number, {
      format: 'CODE128',
      width: 1.2,
      height: 40,
      displayValue: true,
      font: 'monospace',
      fontSize: 9,
      margin: 0,
    });
  }

  await win.document.fonts?.ready;
  await waitForImages(win.document);
  await new Promise((resolve) => win.setTimeout(resolve, 150));
  win.focus();
  win.print();
  win.onafterprint = () => win.close();
}
