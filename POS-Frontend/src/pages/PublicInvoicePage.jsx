import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { PublicInvoices } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { money, rupees, dateStr, methodLabel, wholeQty } from '../lib/format';
import { Loading } from '../components/ui';

export default function PublicInvoicePage() {
  const { token } = useParams();
  const invoice = useAsync(() => PublicInvoices.get(token), [token]);

  if (invoice.loading && !invoice.data) return <Loading label="Loading invoice..." />;
  if (invoice.error) return <PublicInvoiceError error={invoice.error} onRetry={invoice.reload} />;
  if (!invoice.data) return null;

  return <PublicInvoice invoice={invoice.data} />;
}

function PublicInvoiceError({ error, onRetry }) {
  const expiredOrInvalid = error?.status === 404;
  return (
    <main className="flex min-h-screen items-center justify-center bg-receipt-frame px-4 py-8 text-receipt-text">
      <section className="w-full max-w-md rounded-md border border-receipt-text bg-receipt p-6 text-center shadow-lg">
        <h1 className="text-lg font-extrabold">
          {expiredOrInvalid ? 'Invoice Link Not Available' : 'Unable To Load Invoice'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-secondary">
          {expiredOrInvalid
            ? 'This invoice link is invalid or has expired. Please contact the store for a fresh receipt link.'
            : error?.message || 'The invoice could not be loaded right now.'}
        </p>
        {!expiredOrInvalid ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 rounded-sm bg-primary px-5 py-2 text-sm font-bold text-inverse"
          >
            Retry
          </button>
        ) : null}
      </section>
    </main>
  );
}

function PublicInvoice({ invoice }) {
  const barcodeRef = useRef(null);
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    if (!barcodeRef.current || !invoice.barcode_value) return;
    JsBarcode(barcodeRef.current, invoice.barcode_value, {
      format: 'CODE128',
      width: 1.2,
      height: 42,
      displayValue: true,
      font: 'monospace',
      fontSize: 10,
      margin: 0,
    });
  }, [invoice.barcode_value]);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(invoice.qr_value, { width: 150, margin: 1 })
      .then((url) => {
        if (alive) setQrUrl(url);
      })
      .catch(() => {
        if (alive) setQrUrl('');
      });
    return () => {
      alive = false;
    };
  }, [invoice.qr_value]);

  return (
    <main className="min-h-screen bg-ground px-3 py-4 text-receipt-text sm:px-5">
      <section className="mx-auto max-w-2xl overflow-hidden rounded-lg border border-hair bg-receipt shadow-lg">
        <header className="bg-primary px-4 py-5 text-center text-inverse sm:px-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-inverse/75">Tax Invoice</p>
          <h1 className="mt-1 text-xl font-extrabold leading-tight sm:text-2xl">{invoice.business.name}</h1>
          <p className="mt-2 text-xs leading-relaxed text-inverse/85">
            {[invoice.business.address, invoice.business.city].filter(Boolean).join(', ')}
          </p>
          {invoice.business.gstin ? (
            <p className="mt-1 font-mono text-xs text-inverse/85">GSTIN {invoice.business.gstin}</p>
          ) : null}
        </header>

        <div className="grid grid-cols-1 gap-2 border-b border-hairsoft px-4 py-4 text-sm sm:grid-cols-2 sm:px-6">
          <InfoLine label="Invoice" value={invoice.invoice_number} mono />
          <InfoLine label="Date" value={dateStr(invoice.invoice_date)} />
          <InfoLine label="Customer" value={invoice.customer_name} />
          <InfoLine label="Payment" value={methodLabel(invoice.payment_method)} />
          <InfoLine label="Status" value={invoice.paid_status} />
          <InfoLine label="Link Valid Till" value={invoice.expires_at ? `${dateStr(invoice.expires_at)} ${timeOnly(invoice.expires_at)}` : '24 hours'} />
        </div>

        <div className="px-4 py-4 sm:px-6">
          <h2 className="mb-3 text-xs font-extrabold uppercase tracking-[0.14em] text-receipt-text">Purchased Items</h2>
          <div className="divide-y divide-hairsoft rounded-md border border-hairsoft">
            {invoice.items.map((item, index) => (
              <div key={`${item.product_name}-${index}`} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-bold leading-snug">{item.product_name}</p>
                    <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-secondary">
                      SKU {item.sku || '-'} · BC {item.barcode || '-'}
                    </p>
                  </div>
                  <p className="shrink-0 font-mono text-sm font-extrabold">{rupees(item.total)}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <MiniLine label="Qty" value={wholeQty(item.quantity)} />
                  <MiniLine label="Rate" value={money(item.unit_price)} />
                  <MiniLine label="Discount" value={money(item.discount_amount)} />
                  <MiniLine label="Tax" value={money(item.tax_amount)} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-hairsoft px-4 py-4 sm:px-6">
          <div className="space-y-2 rounded-md bg-raised p-4">
            <InfoLine label="Taxable" value={money(invoice.taxable_value)} />
            <InfoLine label="CGST" value={money(invoice.cgst)} />
            <InfoLine label="SGST" value={money(invoice.sgst)} />
            <InfoLine label="IGST" value={money(invoice.igst)} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md bg-primary px-4 py-4 text-inverse">
            <span className="text-sm font-bold uppercase">Grand Total</span>
            <span className="shrink-0 font-mono text-xl font-extrabold">{rupees(invoice.grand_total)}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 items-center gap-5 border-t border-hairsoft px-4 py-5 sm:grid-cols-2 sm:px-6">
          <div className="flex justify-center overflow-hidden">
            <svg ref={barcodeRef} className="max-w-full" aria-label="Invoice barcode" />
          </div>
          <div className="flex justify-center">
            {qrUrl ? (
              <img src={qrUrl} alt="Invoice QR code" className="h-[132px] w-[132px] rounded-md border border-hairsoft p-1 sm:h-[150px] sm:w-[150px]" />
            ) : null}
          </div>
        </div>

        <footer className="border-t border-hairsoft px-4 py-4 text-center text-xs leading-relaxed text-secondary sm:px-6">
          <p>{invoice.return_policy}</p>
          <p className="mt-2">{invoice.footer}</p>
        </footer>
      </section>
    </main>
  );
}

function InfoLine({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 font-semibold text-secondary">{label}</span>
      <span className={`min-w-0 break-words text-right font-semibold text-receipt-text ${mono ? 'font-mono' : ''}`}>{value ?? '-'}</span>
    </div>
  );
}

function MiniLine({ label, value }) {
  return (
    <div className="rounded-sm bg-ground px-2.5 py-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-1 break-words font-mono text-[11px] font-bold text-receipt-text">{value ?? '-'}</p>
    </div>
  );
}

function timeOnly(value) {
  const date = new Date(value);
  if (Number.isNaN(+date)) return '';
  return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
