import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Download,
  Filter,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { reportsHooks } from '../features/reports';
import { useDebounced } from '../lib/useAsync';
import { money, rupees, wholeQty, dateStr } from '../lib/format';
import { Page } from '../components/Shell';
import { storeBranchLabel } from '../config/storeConfig';
import {
  Button,
  Empty,
  ErrorBox,
  Input,
  Loading,
  Panel,
  Pill,
  Skeleton,
} from '../components/ui';

const RANGE_PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['week', 'This Week'],
  ['month', 'This Month'],
  ['quarter', 'This Quarter'],
  ['year', 'This Year'],
];

const STATUS_OPTIONS = [
  ['', 'All Status'],
  ['submitted', 'Submitted'],
  ['verified', 'Verified'],
  ['approved', 'Approved'],
  ['completed', 'Completed'],
  ['rejected', 'Rejected'],
];

const KPI_CONFIG = [
  ['total_return_invoices', 'Return Invoices', 'invoices', 'info', wholeNumber],
  ['total_returned_items', 'Returned Items', 'units', 'amber', wholeNumber],
  ['total_damaged_items', 'Damaged Items', 'units', 'danger', wholeNumber],
  ['refund_amount', 'Refund Amount', 'cash out', 'danger', rupees],
  ['damage_cost', 'Damage Cost', 'estimated COGS', 'danger', rupees],
  ['net_loss', 'Net Loss', 'loss after recovery', 'danger', rupees],
  ['return_rate', 'Return Rate', 'vs invoices', 'violet', (v) => `${Number(v || 0).toFixed(2)}%`],
  ['damage_rate', 'Damage Rate', 'of returned units', 'danger', (v) => `${Number(v || 0).toFixed(2)}%`],
  ['average_processing_time_hours', 'Avg Processing', 'hours', 'info', (v) => `${wholeNumber(v)}h`],
];

const PIE_COLORS = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'];

function wholeNumber(value) {
  return wholeQty(value || 0);
}

function rangeForPreset(preset) {
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toIso = (d) => d.toISOString().slice(0, 10);
  let start = new Date(local);
  let end = new Date(local);
  if (preset === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === 'week') {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
  } else if (preset === 'month') {
    start = new Date(local.getFullYear(), local.getMonth(), 1);
  } else if (preset === 'quarter') {
    start = new Date(local.getFullYear(), Math.floor(local.getMonth() / 3) * 3, 1);
  } else if (preset === 'year') {
    start = new Date(local.getFullYear(), 0, 1);
  }
  return { startDate: toIso(start), endDate: toIso(end) };
}

export default function ReturnReportsPage() {
  const [preset, setPreset] = useState('month');
  const [filters, setFilters] = useState(() => ({
    ...rangeForPreset('month'),
    status: '',
    search: '',
    damageOnly: false,
    pendingOnly: false,
  }));
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('date');
  const [direction, setDirection] = useState('desc');
  const debouncedSearch = useDebounced(filters.search, 300);
  const queryClient = useQueryClient();

  const params = useMemo(() => {
    const clean = {
      ...filters,
      search: debouncedSearch || undefined,
      status: filters.status || undefined,
      page,
      pageSize: 15,
      sort,
      direction,
      grain: 'daily',
      top: 8,
    };
    Object.keys(clean).forEach((key) => {
      if (clean[key] === '' || clean[key] === false || clean[key] == null) delete clean[key];
    });
    return clean;
  }, [debouncedSearch, direction, filters, page, sort]);

  const summary = reportsHooks.useReturnSummary(params);
  const trends = reportsHooks.useReturnTrends(params);
  const breakdowns = reportsHooks.useReturnBreakdowns(params);
  const table = reportsHooks.useReturnTable(params);
  const insights = reportsHooks.useReturnInsights(params);
  const inventory = reportsHooks.useReturnInventory(params);

  useEffect(() => {
    const handler = (event) => {
      const path = event.detail?.path || '';
      if (
        path.startsWith('/returns') ||
        path.startsWith('/invoices') ||
        path.startsWith('/inventory') ||
        path.startsWith('/payments')
      ) {
        queryClient.invalidateQueries({ queryKey: ['pos', 'reports'] });
      }
    };
    window.addEventListener('pos:data-changed', handler);
    return () => window.removeEventListener('pos:data-changed', handler);
  }, [queryClient]);

  function refreshReports() {
    summary.refetch();
    trends.refetch();
    breakdowns.refetch();
    table.refetch();
    insights.refetch();
    inventory.refetch();
  }

  function patch(next) {
    setPage(1);
    setFilters((current) => ({ ...current, ...next }));
  }

  function applyPreset(nextPreset) {
    setPreset(nextPreset);
    patch(rangeForPreset(nextPreset));
  }

  function exportVisibleCsv() {
    const rows = table.data?.rows ?? [];
    const header = [
      'Return Invoice',
      'Original Invoice',
      'Date',
      'Customer',
      'Employee',
      'Outlet',
      'Returned Qty',
      'Damaged Qty',
      'Refund',
      'Loss',
      'Status',
    ];
    const csv = [
      header.join(','),
      ...rows.map((r) =>
        [
          r.return_invoice_no,
          r.original_invoice_no,
          r.date,
          r.customer,
          r.employee,
          r.outlet,
          r.returned_qty,
          r.damaged_qty,
          r.total_refund,
          r.loss_value,
          r.status,
        ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','),
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `return-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const loadingInitial = summary.isLoading && !summary.data;

  return (
    <Page title="Return Analytics" subtitle={storeBranchLabel()}>
      <div className="space-y-5">
        <FilterPanel
          filters={filters}
          preset={preset}
          onPreset={applyPreset}
          onPatch={patch}
          onRefresh={refreshReports}
          onExport={exportVisibleCsv}
        />

        {summary.error && <ErrorBox error={summary.error} onRetry={summary.refetch} />}

        <KpiGrid data={summary.data} loading={loadingInitial} />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
          <TrendPanel data={trends.data} loading={trends.isLoading && !trends.data} />
          <InsightsPanel data={insights.data} loading={insights.isLoading && !insights.data} />
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <PieBreakdownPanel title="Return Reasons" rows={breakdowns.data?.reasons} />
          <PieBreakdownPanel title="Top Products" rows={breakdowns.data?.products} />
          <PieBreakdownPanel title="Suppliers" rows={breakdowns.data?.suppliers} />
        </div>

        <InventoryPanel data={inventory.data} loading={inventory.isLoading && !inventory.data} />

        <ReturnGrid
          data={table.data}
          loading={table.isLoading && !table.data}
          error={table.error}
          page={page}
          onPage={setPage}
          sort={sort}
          direction={direction}
          onSort={(nextSort) => {
            if (nextSort === sort) setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
            else {
              setSort(nextSort);
              setDirection('desc');
            }
          }}
        />
      </div>
    </Page>
  );
}

function FilterPanel({ filters, preset, onPreset, onPatch, onRefresh, onExport }) {
  return (
    <Panel className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.12em] text-mute">
          <Filter className="h-4 w-4" />
          FILTERS
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RANGE_PRESETS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => onPreset(id)}
              className={`rounded-ctl border px-3 py-1.5 text-[11px] transition ${
                preset === id
                  ? 'border-amber/50 bg-amber/15 text-amber'
                  : 'border-hair bg-raised text-dim hover:text-bone'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Input
          type="date"
          value={filters.startDate}
          onChange={(e) => onPatch({ startDate: e.target.value })}
          className="w-[150px]"
        />
        <Input
          type="date"
          value={filters.endDate}
          onChange={(e) => onPatch({ endDate: e.target.value })}
          className="w-[150px]"
        />
        <select
          value={filters.status}
          onChange={(e) => onPatch({ status: e.target.value })}
          className="rounded-ctl border border-hair bg-raised px-3.5 py-2.5 text-[13px] text-bone focus:border-amber/60 focus:outline-none"
        >
          {STATUS_OPTIONS.map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 rounded-ctl border border-hair bg-raised px-3 py-2 text-[12px] text-dim">
          <input
            type="checkbox"
            checked={filters.damageOnly}
            onChange={(e) => onPatch({ damageOnly: e.target.checked })}
          />
          Damage only
        </label>
        <label className="flex items-center gap-2 rounded-ctl border border-hair bg-raised px-3 py-2 text-[12px] text-dim">
          <input
            type="checkbox"
            checked={filters.pendingOnly}
            onChange={(e) => onPatch({ pendingOnly: e.target.checked })}
          />
          Pending only
        </label>
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
          <Input
            value={filters.search}
            onChange={(e) => onPatch({ search: e.target.value })}
            placeholder="Search invoice, product, barcode, customer, employee"
            className="pl-9"
          />
        </div>
        <Button variant="secondary" className="px-3 py-2.5" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
        <Button className="px-3 py-2.5" onClick={onExport}>
          <Download className="h-4 w-4" />
          CSV
        </Button>
      </div>
    </Panel>
  );
}

function KpiGrid({ data, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-6">
      {KPI_CONFIG.map(([key, label, sub, tone, fmt]) => (
        <KpiCard
          key={key}
          label={label}
          sub={sub}
          tone={tone}
          value={fmt ? fmt(data?.[key]) : String(data?.[key] ?? 0)}
        />
      ))}
    </div>
  );
}

function KpiCard({ label, value, sub, tone }) {
  const colors = {
    amber: 'border-amber/35 text-amber',
    ok: 'border-ok/35 text-ok',
    danger: 'border-danger/35 text-danger',
    violet: 'border-violet/35 text-violet',
    info: 'border-info/35 text-info',
  };
  return (
    <Panel className={`p-4 ${colors[tone] || colors.info}`}>
      <p className="truncate text-[9.5px] font-semibold tracking-[0.11em] text-mute">{label.toUpperCase()}</p>
      <p className="mt-2 truncate font-mono text-[22px] font-bold text-bone">{value}</p>
      <p className={`mt-2 truncate text-[10.5px] ${colors[tone] || colors.info}`}>{sub}</p>
    </Panel>
  );
}

function TrendPanel({ data, loading }) {
  const rows = data ?? [];
  return (
    <Panel className="p-5">
      <SectionTitle icon={BarChart3} title="Returns Trend" right={`${rows.length} periods`} />
      {loading ? <Loading /> : !rows.length ? (
        <Empty title="No trend data" sub="Returns appear here once recorded for the selected range." />
      ) : (
        <div className="mt-4 max-h-64 overflow-y-auto rounded-ctl border border-hairsoft">
          <table className="w-full min-w-[560px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-left text-[9px] font-semibold tracking-wider text-mute">
                <th className="px-3 py-3">PERIOD</th>
                <th className="px-3 py-3 text-right">RETURNS</th>
                <th className="px-3 py-3 text-right">RETURNED</th>
                <th className="px-3 py-3 text-right">DAMAGED</th>
                <th className="px-3 py-3 text-right">REFUND</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.period} className="border-t border-hairsoft">
                  <td className="px-3 py-3 font-mono text-[11px] text-bone">{r.period}</td>
                  <td className="px-3 py-3 text-right font-mono text-[12px] text-dim">{wholeNumber(r.returns)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[12px] text-dim">{wholeNumber(r.returned_qty)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[12px] text-danger">{wholeNumber(r.damaged_qty)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[12px] text-bone">{rupees(r.refund_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function InsightsPanel({ data, loading }) {
  const rows = data ?? [];
  return (
    <Panel className="p-5">
      <SectionTitle icon={AlertTriangle} title="Insights Engine" right="auto generated" />
      {loading ? <Loading /> : (
        <div className="mt-4 space-y-3">
          {rows.map((item, i) => (
            <div key={i} className="rounded-ctl border border-hairsoft bg-raised px-4 py-3">
              <div className="flex items-center gap-2">
                <Pill tone={insightTone(item.severity)}>{item.severity.toUpperCase()}</Pill>
                <p className="text-[13px] font-semibold text-bone">{item.title}</p>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-mute">{item.message}</p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function PieBreakdownPanel({ title, rows = [] }) {
  const slices = rows
    .map((r) => ({
      ...r,
      value: Number(r.refund_amount) || Number(r.quantity) || Number(r.count) || 0,
    }))
    .filter((r) => r.value > 0);
  const total = slices.reduce((sum, r) => sum + r.value, 0);
  return (
    <Panel className="p-5">
      <SectionTitle title={title} right={`top ${rows.length}`} />
      {!slices.length ? (
        <p className="mt-6 text-center text-[12px] text-mute">No data for selected filters.</p>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[150px_minmax(0,1fr)]">
          <svg viewBox="0 0 100 100" className="mx-auto h-[150px] w-[150px] -rotate-90">
            {pieSlices(slices, total).map((slice, index) => (
              <path
                key={slice.key}
                d={slice.path}
                fillRule="evenodd"
                className={`cursor-pointer fill-${PIE_COLORS[index % PIE_COLORS.length]} transition-opacity hover:opacity-80`}
              >
                <title>
                  {`${slice.label}: ${rupees(slice.refund_amount || 0)} · ${wholeNumber(slice.quantity)} units · ${slice.percent.toFixed(1)}%`}
                </title>
              </path>
            ))}
            <circle cx="50" cy="50" r="24" fill="currentColor" className="text-surface" />
          </svg>
          <div className="max-h-[166px] space-y-2 overflow-y-auto pr-1">
            {pieSlices(slices, total).map((r, index) => (
              <div key={r.key} className="flex items-center gap-2 rounded-ctl border border-hairsoft bg-raised px-3 py-2">
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full bg-${PIE_COLORS[index % PIE_COLORS.length]}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-bone">{r.label}</p>
                  <p className="font-mono text-[10px] text-mute">
                    {wholeNumber(r.quantity)} units · {r.percent.toFixed(1)}%
                  </p>
                </div>
                <span className="font-mono text-[10.5px] text-mute">{rupees(r.refund_amount || 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function pieSlices(rows, total) {
  let cursor = 0;
  return rows.map((row, index) => {
    const start = cursor;
    const fraction = total ? row.value / total : 0;
    cursor += fraction;
    const end = index === rows.length - 1 ? 1 : cursor;
    return {
      ...row,
      percent: fraction * 100,
      path: describeDonutSlice(50, 50, 44, 25, start, end),
    };
  });
}

function describeDonutSlice(cx, cy, outerRadius, innerRadius, startFraction, endFraction) {
  if (endFraction - startFraction >= 0.9999) {
    return [
      `M ${cx + outerRadius} ${cy}`,
      `A ${outerRadius} ${outerRadius} 0 1 0 ${cx - outerRadius} ${cy}`,
      `A ${outerRadius} ${outerRadius} 0 1 0 ${cx + outerRadius} ${cy}`,
      `M ${cx + innerRadius} ${cy}`,
      `A ${innerRadius} ${innerRadius} 0 1 1 ${cx - innerRadius} ${cy}`,
      `A ${innerRadius} ${innerRadius} 0 1 1 ${cx + innerRadius} ${cy}`,
      'Z',
    ].join(' ');
  }
  const startOuter = polarToCartesian(cx, cy, outerRadius, endFraction);
  const endOuter = polarToCartesian(cx, cy, outerRadius, startFraction);
  const startInner = polarToCartesian(cx, cy, innerRadius, startFraction);
  const endInner = polarToCartesian(cx, cy, innerRadius, endFraction);
  const largeArc = endFraction - startFraction > 0.5 ? 1 : 0;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ');
}

function polarToCartesian(cx, cy, radius, fraction) {
  const angle = fraction * Math.PI * 2;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function InventoryPanel({ data, loading }) {
  const metrics = [
    ['Damaged', wholeNumber(data?.damaged), 'danger'],
    ['Frozen', wholeNumber(data?.inventory_frozen), 'amber'],
    ['Adjustment Value', rupees(data?.inventory_adjustment_value || 0), 'violet'],
  ];
  return (
    <Panel className="p-5">
      <SectionTitle title="Inventory Impact" right="stock disposition" />
      {loading ? <Loading /> : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {metrics.map(([label, value, tone]) => (
            <div key={label} className="rounded-ctl border border-hairsoft bg-raised px-4 py-3">
              <p className="text-[10px] font-semibold tracking-[0.1em] text-mute">{label.toUpperCase()}</p>
              <p className={`mt-2 font-mono text-[18px] font-bold ${toneText(tone)}`}>{value ?? '0'}</p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ReturnGrid({ data, loading, error, page, onPage, sort, direction, onSort }) {
  const [expanded, setExpanded] = useState({});
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.page_size || 15)));
  if (error) return <ErrorBox error={error} />;
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <SectionTitle title="Return Invoice Grid" right={`${total} records`} />
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} className="px-3 py-1.5 text-xs">Prev</Button>
          <span className="font-mono text-[11px] text-mute">{page} / {pages}</span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} className="px-3 py-1.5 text-xs">Next</Button>
        </div>
      </div>
      {loading ? <Loading /> : !rows.length ? (
        <Empty title="No return invoices" sub="Adjust filters or date range to view return analytics." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full border-t border-hairsoft">
            <thead className="sticky top-0 bg-surface">
              <tr className="text-[9px] font-semibold tracking-wider text-mute">
                <GridHead label="RETURN INVOICE" sortKey="return_invoice_no" sort={sort} direction={direction} onSort={onSort} />
                <GridHead label="ORIGINAL" />
                <GridHead label="DATE" sortKey="date" sort={sort} direction={direction} onSort={onSort} />
                <GridHead label="CUSTOMER" />
                <GridHead label="EMPLOYEE" />
                <GridHead label="QTY" />
                <GridHead label="DAMAGED" />
                <GridHead label="REFUND" sortKey="refund" sort={sort} direction={direction} onSort={onSort} align="right" />
                <GridHead label="LOSS" align="right" />
                <GridHead label="STATUS" sortKey="status" sort={sort} direction={direction} onSort={onSort} align="right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <>
                  <tr key={r.id} className="border-t border-hairsoft hover:bg-raised/60">
                    <td className="px-5 py-3">
                      <button
                        className="flex items-center gap-2 font-mono text-[12px] text-bone"
                        onClick={() => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))}
                      >
                        {expanded[r.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {r.return_invoice_no}
                      </button>
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-dim">{r.original_invoice_no || '-'}</td>
                    <td className="px-3 py-3 text-[12px] text-dim">{dateStr(r.date)}</td>
                    <td className="px-3 py-3 text-[12px] text-dim">{r.customer || '-'}</td>
                    <td className="px-3 py-3 text-[12px] text-dim">{r.employee || '-'}</td>
                    <td className="px-3 py-3 font-mono text-[12px] text-dim">{wholeNumber(r.returned_qty)}</td>
                    <td className="px-3 py-3 font-mono text-[12px] text-danger">{wholeNumber(r.damaged_qty)}</td>
                    <td className="px-3 py-3 text-right font-mono text-[12px] text-bone">{rupees(r.total_refund)}</td>
                    <td className="px-3 py-3 text-right font-mono text-[12px] text-danger">{rupees(r.loss_value)}</td>
                    <td className="px-5 py-3 text-right"><StatusPill status={r.status} /></td>
                  </tr>
                  {expanded[r.id] && <ExpandedRow row={r} />}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ExpandedRow({ row }) {
  return (
    <tr className="border-t border-hairsoft bg-ground/60">
      <td colSpan={10} className="px-5 py-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(row.items ?? []).map((item) => (
            <div key={item.id} className="rounded-ctl border border-hairsoft bg-raised p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-bone">{item.product_name}</p>
                  <p className="mt-1 font-mono text-[10px] text-mute">
                    SKU {item.sku || '-'} · BC {item.barcode || '-'} · {item.category || '-'}
                  </p>
                  <p className="mt-1 text-[11px] text-mute">Supplier {item.supplier || '-'}</p>
                </div>
                <Pill tone={item.stock_status === 'available' ? 'ok' : 'danger'}>{item.stock_status}</Pill>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <MiniMetric label="Returned" value={wholeNumber(item.returned_qty)} />
                <MiniMetric label="Damaged" value={wholeNumber(item.damaged_qty)} tone="danger" />
                <MiniMetric label="Sell Price" value={money(item.selling_price)} />
                <MiniMetric label="Cost Price" value={money(item.cost_price)} />
                <MiniMetric label="Damage Cost" value={money(item.damage_cost)} tone="danger" />
              </div>
              {item.remarks && <p className="mt-3 text-[11px] text-mute">{item.remarks}</p>}
            </div>
          ))}
        </div>
      </td>
    </tr>
  );
}

function GridHead({ label, sortKey, sort, direction, onSort, align = 'left' }) {
  const active = sortKey && sort === sortKey;
  return (
    <th className={`px-3 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {sortKey ? (
        <button className={active ? 'text-amber' : ''} onClick={() => onSort(sortKey)}>
          {label}{active ? ` ${direction === 'asc' ? '↑' : '↓'}` : ''}
        </button>
      ) : label}
    </th>
  );
}

function MiniMetric({ label, value, tone = 'info' }) {
  return (
    <div>
      <p className="text-[9px] font-semibold tracking-[0.09em] text-mute">{label.toUpperCase()}</p>
      <p className={`mt-1 font-mono text-[12px] font-semibold ${toneText(tone)}`}>{value}</p>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, right }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="h-4 w-4 text-amber" /> : null}
        <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">{title.toUpperCase()}</p>
      </div>
      {right ? <span className="font-mono text-[10px] text-mute">{right}</span> : null}
    </div>
  );
}

function StatusPill({ status }) {
  const tone = status === 'completed' ? 'ok' : status === 'rejected' ? 'danger' : status === 'approved' ? 'amber' : 'info';
  return <Pill tone={tone}>{String(status).replace(/_/g, ' ').toUpperCase()}</Pill>;
}

function insightTone(severity) {
  return severity === 'danger' ? 'danger' : severity === 'warning' ? 'amber' : severity === 'ok' ? 'ok' : 'info';
}

function toneText(tone) {
  return {
    amber: 'text-amber',
    ok: 'text-ok',
    danger: 'text-danger',
    violet: 'text-violet',
    info: 'text-info',
  }[tone] || 'text-info';
}
