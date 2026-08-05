import { Check } from 'lucide-react';
import { useTheme } from './useTheme';

function Preview({ theme }) {
  return <div className="mt-4 overflow-hidden rounded-lg border border-hairsoft">
    <div className="flex h-28" style={{ background: theme.background }}><div className="w-[28%] p-2" style={{ background: theme.sidebar }}><i className="block h-2 w-8 rounded bg-receipt/80" /><i className="mt-3 block h-1.5 rounded bg-receipt/25" /><i className="mt-2 block h-1.5 w-3/4 rounded bg-receipt/25" /></div><div className="flex flex-1 flex-col"><div className="h-5 border-b" style={{ background: theme.header, borderColor: theme.border }} /><div className="flex flex-1 gap-1.5 p-2"><div className="flex-1 rounded p-1.5 shadow-sm" style={{ background: theme.card }}><i className="block h-1.5 w-2/3 rounded bg-slate-200" /><i className="mt-2 block h-3 rounded" style={{ background: theme.primary }} /><i className="mt-2 block h-2 w-10 rounded" style={{ background: theme.accent }} /></div><div className="w-[37%] rounded p-1.5 shadow-sm" style={{ background: theme.card }}><i className="block h-1.5 rounded bg-slate-200" /><i className="mt-2 block h-1.5 rounded" style={{ background: theme.tableHeader }} /><i className="mt-1 block h-1.5 rounded bg-slate-100" /></div></div></div></div>
  </div>;
}

export function ThemeSelector() {
  const { themeId, themes, selectTheme } = useTheme();
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Object.entries(themes).map(([id, theme]) => {
    const active = id === themeId;
    return <button key={id} type="button" aria-pressed={active} onClick={() => selectTheme(id)} className={`relative rounded-panel border bg-surface p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 ${active ? 'border-amber ring-1 ring-amber/35' : 'border-hair'}`}>
      {active && <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-amber px-2 py-1 text-[10px] font-bold text-on-primary"><Check size={12} /> Active</span>}
      <h3 className="pr-16 text-sm font-semibold text-bone">{theme.name}</h3><p className="mt-1 text-xs text-mute">Click to apply instantly</p><Preview theme={theme} />
      <div className="mt-3 flex items-center justify-between gap-2"><div className="flex gap-2">{[theme.primary, theme.secondary, theme.accent, theme.sidebar].map((color) => <span key={color} className="h-4 w-4 rounded-full border border-hair" style={{ background: color }} />)}</div><span className="text-[10px] font-medium uppercase tracking-wide text-mute">{active ? 'Applied' : 'Apply theme'}</span></div>
    </button>;
  })}</div>;
}
