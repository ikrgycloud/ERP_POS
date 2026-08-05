/**
 * The API serialises Decimal as a *string* ("1876.44"). Never do float math
 * on money here — the backend is the source of truth. These helpers only
 * format for display.
 */

import { CURRENCY, DATE_FORMAT } from '../config/appConfig';

const moneyFormatter = new Intl.NumberFormat(CURRENCY.locale, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholeMoneyFormatter = new Intl.NumberFormat(CURRENCY.locale, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

function withCurrencySymbol(value) {
  const symbol = CURRENCY.symbol || '₹';
  return `${symbol} ${value}`;
}

/** "1876.44" -> "₹ 1,876.44" */
export function money(v) {
  if (v === null || v === undefined || v === '') return withCurrencySymbol('0.00');
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  return withCurrencySymbol(moneyFormatter.format(n));
}

export function formatCurrency(v) {
  if (v === null || v === undefined || v === '') return withCurrencySymbol(moneyFormatter.format(0));
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  return withCurrencySymbol(moneyFormatter.format(n));
}

export const rupees = formatCurrency;

export function compactCurrency(v) {
  const n = Number(v) || 0;
  const symbol = CURRENCY.symbol || '₹';
  if (n >= 1e7) return `${symbol} ${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `${symbol} ${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `${symbol} ${(n / 1e3).toFixed(1)}k`;
  return formatCurrency(n);
}

export const compactRupees = compactCurrency;

/** Strip trailing zeros from a quantity: "2.000" -> "2" */
export function qty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  return String(Number(n.toFixed(3)));
}

/** Invoice display format: whole rupees, rounded only for presentation. */
export function wholeCurrency(v) {
  if (v === null || v === undefined || v === '') return withCurrencySymbol('0');
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  return withCurrencySymbol(wholeMoneyFormatter.format(n));
}

export function wholeQty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '');
  return String(Math.round(n));
}

export function pct(v) {
  const n = Number(v) || 0;
  return `${Number(n.toFixed(2))}%`;
}

export function dateStr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return String(iso);
  return d.toLocaleDateString(DATE_FORMAT.locale, DATE_FORMAT.date);
}

export function timeStr(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '—';
  return d.toLocaleTimeString(DATE_FORMAT.locale, DATE_FORMAT.time);
}

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Grand total from an invoice payload (taxable + all GST components). */
export function invoiceTotal(inv) {
  if (!inv) return 0;
  return (
    Number(inv.taxable_value || 0) +
    Number(inv.cgst || 0) +
    Number(inv.sgst || 0) +
    Number(inv.igst || 0)
  );
}

export function stockOnHand(p) {
  if (p?.stock_cached !== undefined && p?.stock_cached !== null) {
    return Number(p.stock_cached || 0);
  }
  return Number(p.qty_bought || 0) - Number(p.qty_sold || 0) - Number(p.damaged_qty || 0);
}

/** Payment method display names. `capitalize` would render "upi" as "Upi". */
const METHOD_LABELS = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  wallet: 'Wallet',
  cheque: 'Cheque',
  split: 'Split',
};

export function methodLabel(m) {
  if (!m) return '—';
  return METHOD_LABELS[String(m).toLowerCase()] ?? String(m);
}
