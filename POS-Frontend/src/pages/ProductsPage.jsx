import { useState } from 'react';
import { useDebounced } from '../lib/useAsync';
import { productsHooks } from '../features/products';
import { money, rupees, stockOnHand, wholeQty } from '../lib/format';
import { Page } from '../components/Shell';
import {
  Panel,
  Input,
  Pill,
  Loading,
  ErrorBox,
  Empty,
} from '../components/ui';

export default function ProductsPage() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 300);

  const list = productsHooks.useList(
    { q: dq || undefined, limit: 100 },
    { refetchInterval: 15_000, refetchIntervalInBackground: false, staleTime: 15_000 },
  );
  const rows = list.data ?? [];

  return (
    <Page title="Products" subtitle="Catalog & inventory">
      <div className="mb-4 flex items-center gap-3">
        <Input
          className="max-w-sm"
          placeholder="Search by name or SKU…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {list.isFetching && <span className="text-[11px] text-mute">searching…</span>}
      </div>

      {list.error ? (
        <ErrorBox error={list.error} onRetry={list.refetch} />
      ) : list.isLoading && !list.data ? (
        <Loading label="Loading products…" />
      ) : !rows.length ? (
        <Panel>
          <Empty icon="◫" title="No products" sub={q ? `Nothing matches "${q}".` : 'Catalog is empty.'} />
        </Panel>
      ) : (
        <div className="space-y-3">
          <Panel className="overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="text-[9.5px] font-semibold tracking-wider text-mute">
                  <th className="px-5 py-3.5 text-left">PRODUCT</th>
                  <th className="py-3.5 text-left">BARCODE</th>
                  <th className="py-3.5 text-right">MRP</th>
                  <th className="py-3.5 text-right">SELL</th>
                  <th className="py-3.5 text-right">GST</th>
                  <th className="py-3.5 text-right">AVAILABLE</th>
                  <th className="px-5 py-3.5 text-right">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p, i) => {
                  const soh = stockOnHand(p);
                  const displayStock = Math.max(0, Number(soh) || 0);
                  const status = stockStatus(displayStock);
                  return (
                    <tr
                      key={p.id}
                      className={`border-t border-hairsoft ${i % 2 ? 'bg-raised/40' : ''}`}
                    >
                      <td className="px-5 py-3.5">
                        <p className="text-[13.5px] font-medium text-bone">{p.name}</p>
                        <p className="font-mono text-[10.5px] text-mute">{p.sku}</p>
                      </td>
                      <td className="py-3.5 font-mono text-[11.5px] text-mute">
                        {p.barcode || '—'}
                      </td>
                      <td className="py-3.5 text-right font-mono text-[12.5px] text-mute">
                        {money(p.mrp)}
                      </td>
                      <td className="py-3.5 text-right font-mono text-[13px] font-semibold text-bone">
                        {rupees(p.sell_price)}
                      </td>
                      <td className="py-3.5 text-right font-mono text-[12px] text-mute">
                        {Number(p.gst_rate)}%
                      </td>
                      <td
                        className={`py-3.5 text-right font-mono text-[14px] font-semibold ${
                          status.tone === 'danger'
                            ? 'text-danger'
                            : status.tone === 'amber'
                            ? 'text-amber'
                            : status.tone === 'ok'
                            ? 'text-ok'
                            : 'text-dim'
                        }`}
                      >
                        <div>{wholeQty(displayStock)}</div>
                        <div className="mt-0.5 text-[9.5px] font-medium text-mute">
                          {wholeQty(p.qty_sold)} sold · {wholeQty(p.qty_bought)} in
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {!p.is_active ? (
                          <Pill tone="mute">INACTIVE</Pill>
                        ) : (
                          <Pill tone={status.tone}>{status.label}</Pill>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </div>
      )}
    </Page>
  );
}

function stockStatus(stock) {
  const qty = Number(stock);
  if (!Number.isFinite(qty) || qty <= 0) return { label: 'OUT OF STOCK', tone: 'danger' };
  if (qty < 5) return { label: 'LOW', tone: 'amber' };
  if (qty > 100) return { label: 'HIGH STOCK', tone: 'ok' };
  return { label: 'IN STOCK', tone: 'ok' };
}
