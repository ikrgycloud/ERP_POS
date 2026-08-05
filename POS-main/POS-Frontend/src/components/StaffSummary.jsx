import { Badge, IndianRupee, Phone, Receipt, Users } from 'lucide-react';
import { initials, rupees } from '../lib/format';
import { Panel, Skeleton } from './ui';

export function StaffSummaryGrid({ rows, maxRevenue }) {
  if (!rows.length) return <NoSalesData />;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {rows.map((row) => {
        const revenue = Number(row.total_revenue) || 0;
        const progress = maxRevenue > 0 ? Math.round((revenue / maxRevenue) * 100) : 0;
        return (
          <EmployeePerformanceCard
            key={row.id}
            employeeName={row.employee_name || row.full_name || ''}
            employeeId={row.employee_id || row.employee_code || ''}
            phoneNumber={row.phone_number || row.phone || ''}
            totalBills={row.total_bills ?? row.total_invoices ?? 0}
            totalRevenue={row.total_revenue ?? 0}
            progress={progress}
            avatar={row.avatar_initials || initials(row.employee_name || row.full_name || '')}
          />
        );
      })}
    </div>
  );
}

export function EmployeePerformanceCard({
  employeeName,
  employeeId,
  phoneNumber,
  totalBills,
  totalRevenue,
  progress,
  avatar,
}) {
  const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(progress, 100)) : 0;
  const barWidth = Number(totalRevenue) > 0 ? Math.max(safeProgress, 4) : 0;

  return (
    <article className="rounded-panel border border-hair bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-amber/30 bg-amberdim/30 font-mono text-[13px] font-bold text-amber">
          {avatar || initials(employeeName)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-bone">{employeeName}</h3>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-mute">
            <Badge className="h-3.5 w-3.5" />
            <span className="truncate">{employeeId || '—'}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11px] text-dim">
            <Phone className="h-3.5 w-3.5 text-mute" />
            <span className="truncate">{phoneNumber || '—'}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Metric icon={Receipt} label="Bills" value={totalBills ?? 0} />
        <Metric icon={IndianRupee} label="Revenue" value={rupees(totalRevenue)} />
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium text-dim">Revenue Progress</span>
          <span className="font-mono text-[11px] text-mute">{safeProgress}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-raised">
          <div
            className="h-full rounded-full bg-amber transition-all duration-700 ease-out"
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>
    </article>
  );
}

export function StaffSummarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Panel key={i} className="p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-36" />
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
          <Skeleton className="mt-5 h-2.5" />
        </Panel>
      ))}
    </div>
  );
}

export function NoSalesData() {
  return (
    <Panel>
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <Users className="mb-3 h-8 w-8 text-mute/60" />
        <p className="text-sm font-medium text-dim">No sales data yet</p>
        <p className="mt-1 max-w-sm text-xs text-mute">
          Once your team starts billing, performance appears here.
        </p>
      </div>
    </Panel>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="min-w-0 rounded-card border border-hairsoft bg-raised px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.08em] text-mute">
        <Icon className="h-3.5 w-3.5" />
        <span className="truncate">{label.toUpperCase()}</span>
      </div>
      <p className="mt-1 truncate font-mono text-[13px] font-semibold text-bone">{value}</p>
    </div>
  );
}
