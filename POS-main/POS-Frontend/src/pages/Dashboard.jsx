import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IndianRupee,
  Receipt,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, ROLES, ROLE_LABEL } from '../lib/auth';
import { dashboardHooks } from '../features/dashboard';
import { paymentsHooks } from '../features/payments';
import { reportsHooks } from '../features/reports';
import { rupees, compactRupees, wholeQty, methodLabel } from '../lib/format';
import { Page } from '../components/Shell';
import { storeBranchLabel } from '../config/storeConfig';
import {
  NoSalesData,
  StaffSummaryGrid,
  StaffSummarySkeleton,
} from '../components/StaffSummary';
import {
  Panel,
  Pill,
  Avatar,
  Loading,
  ErrorBox,
  Button,
} from '../components/ui';

export default function DashboardPage() {
  const { user } = useAuth();
  if (user.role === ROLES.BM) return <BranchManager />;
  if (user.role === ROLES.SM) return <SalesManager />;
  return <SalesPerson />;
}

/* ------------------------------------------------------------------ cards */
function Stat({ label, value, sub, accent = 'amber' }) {
  const bar = {
    amber: 'bg-amber',
    ok: 'bg-ok',
    danger: 'bg-danger',
    violet: 'bg-violet',
    info: 'bg-info',
  }[accent];
  const text = {
    amber: 'text-amber',
    ok: 'text-ok',
    danger: 'text-danger',
    violet: 'text-violet',
    info: 'text-info',
  }[accent];
  return (
    <Panel className="relative overflow-hidden p-5">
      <span className={`absolute inset-y-0 left-0 w-[3px] opacity-70 ${bar}`} />
      <p className="text-[10px] font-semibold tracking-[0.11em] text-mute">{label}</p>
      {typeof value === 'string' || typeof value === 'number' ? (
        <div className="mt-2 font-mono text-[28px] font-bold leading-none text-bone">{value}</div>
      ) : (
        <div className="mt-2">{value}</div>
      )}
      {sub && <p className={`mt-2 text-[10.5px] ${text}`}>{sub}</p>}
    </Panel>
  );
}

function CurrencyStatValue({ value }) {
  const text = String(value).replace(/^₹\s*/, '');
  return (
    <div className="flex items-baseline gap-1 font-mono leading-none text-bone">
      <span className="text-[25px] font-bold">₹</span>
      <span className="text-[28px] font-bold">{text}</span>
    </div>
  );
}

/* -------------------------------------------------------- branch manager */
function BranchManager() {
  const queryClient = useQueryClient();
  const dash = dashboardHooks.useRoleDashboard(ROLES.BM);
  const rev = reportsHooks.useRevenue();
  const pay = paymentsHooks.useSummary();
  const products = reportsHooks.useProductInsights({ top: 8 });
  useReportAutoRefresh(queryClient);

  if (dash.isLoading && !dash.data) return <Page title="Branch Dashboard"><Loading /></Page>;

  const d = dash.data;

  return (
    <Page title="Branch Dashboard" subtitle={storeBranchLabel()}>
      {dash.error && <ErrorBox error={dash.error} onRetry={dash.refetch} />}

      {d && (
        <>
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            <Stat
              label="TODAY'S REVENUE"
              value={<CurrencyStatValue value={compactRupees(d.today_revenue)} />}
              sub={`${d.today_sales} bills issued`}
              accent="amber"
            />
            <Stat label="PRODUCTS" value={d.products} sub={`${d.customers} customers`} accent="ok" />
            <Stat
              label="LOW STOCK"
              value={d.low_stock}
              sub={d.low_stock ? 'needs reorder' : 'all healthy'}
              accent={d.low_stock ? 'danger' : 'ok'}
            />
            <Stat
              label="TEAM"
              value={`${d.sales_managers}/${d.sales_persons}`}
              sub={`${ROLE_LABEL[ROLES.SM].toLowerCase()}s / ${ROLE_LABEL[ROLES.SP].toLowerCase()}s`}
              accent="violet"
            />
          </div>
        </>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-3">
          <RevenueByStaff data={rev.data} loading={rev.isLoading} error={rev.error} onRetry={rev.refetch} />
        </div>

        <div className="space-y-5">
          <div className="space-y-3">
            <PaymentSplit data={pay.data} loading={pay.isLoading} />
          </div>
          <div className="space-y-3">
            <ProductInsights data={products.data} loading={products.isLoading} />
          </div>
        </div>
      </div>
    </Page>
  );
}

function RevenueByStaff({ data, loading, error, onRetry }) {
  if (error) return <ReportsFailure onRetry={onRetry} />;
  if (loading && !data) return <PerformanceSkeleton />;

  const report = normalizeRevenueReport(data);
  const flatRows = report.scope === 'branch_manager'
    ? report.managers.flatMap((manager) => manager.sales_persons)
    : report.staff;
  const max = Math.max(...flatRows.map((r) => Number(r.total_revenue) || 0), 0);
  const hasPeople = report.scope === 'branch_manager'
    ? report.managers.length > 0
    : report.staff.length > 0;
  if (!hasPeople) return <NoSalesData />;

  return (
    <section className="space-y-4">
      <PerformanceHeader
        title={report.scope === 'branch_manager' ? 'Sales Managers Performance' : 'My Team Performance'}
        subtitle="Revenue Performance"
      />

      {report.scope === 'branch_manager' ? (
        <div className="space-y-5">
          {report.managers.map((manager) => (
            <ManagerPerformance key={manager.manager.id} manager={manager} maxRevenue={max} />
          ))}
        </div>
      ) : (
        <StaffSummaryGrid rows={report.staff} maxRevenue={max} />
      )}
    </section>
  );
}

function useReportAutoRefresh(queryClient) {
  useEffect(() => {
    const handler = (event) => {
      const path = event.detail?.path || '';
      if (
        path.startsWith('/staff') ||
        path.startsWith('/pos/') ||
        path.startsWith('/returns')
      ) {
        queryClient.invalidateQueries({ queryKey: ['pos', 'dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['pos', 'reports'] });
        queryClient.invalidateQueries({ queryKey: ['pos', 'payments'] });
      }
    };
    window.addEventListener('pos:data-changed', handler);
    return () => window.removeEventListener('pos:data-changed', handler);
  }, [queryClient]);
}

function normalizeRevenueReport(data) {
  if (data?.scope) {
    return {
      scope: data.scope,
      staff: data.staff ?? [],
      managers: data.managers ?? [],
    };
  }

  const rows = (data ?? [])
    .filter((r) => r.staff || r.staff_id != null)
    .map((r) => {
      const staff = r.staff ?? {};
      return {
        id: staff.id ?? r.staff_id,
        employee_name: staff.employee_name ?? staff.full_name ?? '',
        employee_id: staff.employee_id ?? staff.employee_code ?? '',
        employee_code: staff.employee_code ?? staff.employee_id ?? '',
        full_name: staff.full_name ?? staff.employee_name ?? '',
        phone_number: staff.phone_number ?? staff.phone ?? null,
        phone: staff.phone ?? staff.phone_number ?? null,
        avatar_initials: staff.avatar_initials ?? '',
        role: staff.role ?? ROLES.SP,
        status: (staff.active ?? staff.is_active) ? 'active' : 'inactive',
        active: Boolean(staff.active ?? staff.is_active),
        total_invoices: r.invoice_count ?? r.invoices ?? 0,
        total_bills: r.invoice_count ?? r.invoices ?? 0,
        total_revenue: r.revenue ?? 0,
      };
    });
  return { scope: 'sales_manager', staff: rows, managers: [] };
}

function PerformanceHeader({ title, subtitle }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">{subtitle.toUpperCase()}</p>
        <h2 className="mt-1 text-[18px] font-semibold text-bone">{title}</h2>
      </div>
      <span className="font-mono text-[10px] text-mute">all time</span>
    </div>
  );
}

function ManagerPerformance({ manager, maxRevenue }) {
  const rows = manager.sales_persons ?? [];
  return (
    <div className="rounded-panel border border-hair bg-surface p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={manager.manager.full_name} size={44} tone="dim" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-[15px] font-semibold text-bone">{manager.manager.full_name}</p>
              <Pill tone="info">{ROLE_LABEL[manager.manager.role] ?? manager.manager.role}</Pill>
            </div>
            <p className="mt-1 font-mono text-[11px] text-mute">{manager.manager.employee_code}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:min-w-[250px]">
          <Metric icon={IndianRupee} label="Team Revenue" value={rupees(manager.team_revenue)} />
          <Metric icon={Receipt} label="Bills" value={manager.invoice_count} />
        </div>
      </div>

      {rows.length ? (
        <>
          <div className="mt-5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.11em] text-mute">
            <Users className="h-3.5 w-3.5" />
            SALES PERSONS
          </div>
          <div className="mt-3">
            <StaffSummaryGrid rows={rows} maxRevenue={maxRevenue} />
          </div>
        </>
      ) : (
        <p className="mt-5 rounded-card border border-hairsoft bg-raised px-4 py-3 text-[12px] text-mute">
          No sales data yet. Once this team starts billing, performance appears here.
        </p>
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0 rounded-card border border-hairsoft bg-raised px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-mute">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label.toUpperCase()}</span>
      </div>
      <p className="mt-1 truncate font-mono text-[12px] font-semibold text-bone">{value}</p>
    </div>
  );
}

function PerformanceSkeleton() {
  return (
    <section className="space-y-4">
      <PerformanceHeader title="Loading team performance..." subtitle="Revenue Performance" />
      <StaffSummarySkeleton />
    </section>
  );
}

function ReportsFailure({ onRetry }) {
  return (
    <div className="rounded-card border border-danger/40 bg-danger/10 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-[13px] font-medium text-danger">Unable to load reports</p>
          <p className="mt-0.5 text-xs text-danger/80">Team performance could not be refreshed.</p>
        </div>
        {onRetry ? (
          <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    </div>
  );
}

const PAY_COLORS = { cash: 'bg-amber', upi: 'bg-ok', card: 'bg-info', wallet: 'bg-violet' };

function PaymentSplit({ data, loading }) {
  if (loading && !data) return <Panel className="p-6"><Loading /></Panel>;
  const rows = data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.total), 0);

  return (
    <Panel className="p-5">
      <span className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">
        COLLECTION BY METHOD
      </span>

      {!rows.length ? (
        <p className="mt-6 text-center text-[12px] text-mute">No payments recorded yet.</p>
      ) : (
        <>
          <div className="mt-4 flex h-3 overflow-hidden rounded-full">
            {rows.map((r) => (
              <div
                key={r.method}
                className={PAY_COLORS[r.method] ?? 'bg-mute'}
                style={{ width: `${(Number(r.total) / total) * 100}%` }}
                title={r.method}
              />
            ))}
          </div>
          <div className="mt-4 space-y-2.5">
            {rows.map((r) => (
              <div key={r.method} className="flex items-center gap-3">
                <span className={`h-2 w-2 rounded-full ${PAY_COLORS[r.method] ?? 'bg-mute'}`} />
                <span className="flex-1 text-[12px] text-dim">{methodLabel(r.method)}</span>
                <span className="font-mono text-[11px] text-mute">
                  {Math.round((Number(r.total) / total) * 100)}%
                </span>
                <span className="w-24 text-right font-mono text-[12.5px] font-semibold text-bone">
                  {rupees(r.total)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}

function ProductInsights({ data, loading }) {
  if (loading && !data) return <Panel className="p-6"><Loading /></Panel>;
  const lowStock = data?.low_stock ?? [];
  const bestSellers = data?.best_sellers ?? [];

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-[10.5px] font-semibold tracking-[0.12em] text-mute">PRODUCT INTELLIGENCE</span>
          <p className="mt-1 text-[12px] text-dim">Stock alerts and fast-moving products</p>
        </div>
        {lowStock.length > 0 && <Pill tone="danger">{lowStock.length} ALERTS</Pill>}
      </div>

      <div className="mt-5 space-y-6">
        <section>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[12px] font-semibold text-bone">Low Stock Products</h3>
            <span className="font-mono text-[10px] text-mute">stock &lt; 5</span>
          </div>
          {!lowStock.length ? (
            <p className="mt-4 rounded-card border border-hairsoft bg-raised px-4 py-3 text-center text-[12px] text-ok">
              No low-stock products right now.
            </p>
          ) : (
            <div className="mt-3 space-y-2.5">
              {lowStock.map((p) => (
                <div key={p.product_id} className="rounded-card border border-hairsoft bg-raised px-3 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.status === 'out_of_stock' ? 'bg-danger' : 'bg-amber'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold text-bone">{p.name}</p>
                      <p className="truncate font-mono text-[10px] text-mute">{p.sku || p.barcode || 'NO CODE'}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-mono text-[17px] font-bold ${p.status === 'out_of_stock' ? 'text-danger' : 'text-amber'}`}>
                        {wholeQty(p.stock)}
                      </p>
                      <p className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-mute">
                        {p.status === 'out_of_stock' ? 'out' : 'low'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[12px] font-semibold text-bone">Best Selling Products</h3>
            <span className="font-mono text-[10px] text-mute">last 90 days</span>
          </div>
          {!bestSellers.length ? (
            <p className="mt-4 rounded-card border border-hairsoft bg-raised px-4 py-3 text-center text-[12px] text-mute">
              Best sellers appear after invoices are completed.
            </p>
          ) : (
            <div className="mt-3 max-h-[292px] space-y-2.5 overflow-y-auto pr-1">
              {bestSellers.map((p, index) => (
                <div key={p.product_id} className="flex items-center gap-3 rounded-card border border-hairsoft bg-raised px-3 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber/15 font-mono text-[11px] font-bold text-amber">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-bone">{p.name}</p>
                    <p className="truncate font-mono text-[10px] text-mute">
                      {wholeQty(p.quantity_sold)} sold · {p.invoices} bills
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-[12px] font-semibold text-bone">{rupees(p.revenue)}</p>
                    <p className="font-mono text-[9.5px] text-mute">stock {wholeQty(p.stock)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Panel>
  );
}

/* --------------------------------------------------------- sales manager */
function SalesManager() {
  const queryClient = useQueryClient();
  const dash = dashboardHooks.useRoleDashboard(ROLES.SM);
  const rev = reportsHooks.useRevenue();
  const products = reportsHooks.useProductInsights({ top: 8 });
  useReportAutoRefresh(queryClient);

  if (dash.isLoading && !dash.data) return <Page title="Team Dashboard"><Loading /></Page>;
  const d = dash.data;

  return (
    <Page title="Team Dashboard" subtitle={`Your ${ROLE_LABEL[ROLES.SP]}s`}>
      {dash.error && <ErrorBox error={dash.error} onRetry={dash.refetch} />}

      {d && (
        <>
          <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
            <Stat
              label="TODAY'S REVENUE"
              value={<CurrencyStatValue value={compactRupees(d.today_revenue)} />}
              sub={`${d.today_invoices} invoices`}
              accent="amber"
            />
            <Stat
              label="THIS MONTH"
              value={<CurrencyStatValue value={compactRupees(d.monthly_revenue)} />}
              sub={`${d.monthly_invoices} invoices`}
              accent="ok"
            />
            <Stat
              label="TEAM"
              value={`${d.active_sales_persons}/${d.total_sales_persons}`}
              sub="active / total"
              accent="info"
            />
            <Stat label="RETURNS" value={d.returns} sub="team total" accent="danger" />
          </div>
        </>
      )}

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-3">
          <RevenueByStaff data={rev.data} loading={rev.isLoading} error={rev.error} onRetry={rev.refetch} />
        </div>
        <ProductInsights data={products.data} loading={products.isLoading} />
      </div>
    </Page>
  );
}

/* ---------------------------------------------------------- sales person */
function SalesPerson() {
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const dash = dashboardHooks.useRoleDashboard(ROLES.SP);
  useReportAutoRefresh(queryClient);
  if (dash.isLoading && !dash.data) return <Page title="My Day"><Loading /></Page>;
  const d = dash.data;

  return (
    <Page title="My Day" subtitle="Your counter performance">
      {dash.error && <ErrorBox error={dash.error} onRetry={dash.refetch} />}
      {d && (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <Stat label="TODAY'S BILLS" value={d.today_bills} accent="ok" />
            <Stat label="TODAY'S REVENUE" value={compactRupees (d.today_revenue)} accent="amber" />
            <Stat label="THIS MONTH" value={<CurrencyStatValue value={compactRupees(d.monthly_revenue)} />} sub={`${d.monthly_bills} bills`} accent="info" />
          </div>
          <Panel className="mt-6 p-5">
            <PerformanceHeader title="My Performance" subtitle="Revenue Performance" />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Metric icon={Receipt} label="Bills Completed" value={d.invoice_count} />
              <Metric icon={IndianRupee} label="Today's Sales" value={rupees(d.today_revenue)} />
              <Metric icon={TrendingUp} label="Monthly Sales" value={rupees(d.monthly_revenue)} />
            </div>
          </Panel>
          <Panel className="mt-6 p-8 text-center">
            <p className="text-[15px] font-medium text-bone">Ready for the next customer</p>
            <p className="mt-1 text-[12px] text-mute">Head to the counter to start a bill.</p>
            <Button className="mt-5 px-6 py-2.5" onClick={() => nav('/billing')}>
              Open Billing Counter
            </Button>
          </Panel>
        </>
      )}
    </Page>
  );
}
