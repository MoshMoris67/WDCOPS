'use client';

import React from 'react';
import { Users } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { useCachedQuery } from '@/lib/use-cached-query';
import { formatMoney } from '@/lib/money';
import { t } from '@/i18n';
import { CompareReport, AgentOption, Scope, Totals, scopeQuery, pct, monthLabel, periodLabel } from './perf-shared';

interface Props {
  scope: Scope;
  agents: AgentOption[];
  agentA: string;
  agentB: string;
  onA: (id: string) => void;
  onB: (id: string) => void;
}

type Metric = { label: string; get: (x: Totals) => number | null; fmt: (n: number) => string };

const METRICS: Metric[] = [
  { label: 'Recovered', get: (x) => x.recovered, fmt: formatMoney },
  { label: 'Recovery rate', get: (x) => x.recoveryRate, fmt: (n) => pct(n) },
  { label: 'Accounts held', get: (x) => x.accountsAssigned, fmt: String },
  { label: 'Book (amount owed)', get: (x) => x.bookAmount, fmt: formatMoney },
  { label: 'Accounts that paid', get: (x) => x.accountsPaid, fmt: String },
  { label: 'Calls made', get: (x) => x.callsMade, fmt: String },
  { label: 'Promises to pay', get: (x) => x.promisesMade, fmt: String },
  { label: 'Promised amount', get: (x) => x.promisedAmount, fmt: formatMoney },
  { label: 'Agent commission', get: (x) => x.agentCommission, fmt: formatMoney },
];
// Book size and accounts held describe the workload, not the result — never crowned a "winner".
const NEUTRAL = new Set(['Accounts held', 'Book (amount owed)']);

export default function CompareView({ scope, agents, agentA, agentB, onA, onB }: Props) {
  const ready = !!agentA && !!agentB && agentA !== agentB;
  const { data: r, isLoading, error } = useCachedQuery<CompareReport>(`/api/performance-history?${scopeQuery(scope, { view: 'compare', agentA, agentB })}`, {
    enabled: ready,
  });
  const sel = 'h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground';
  const maxMonth = Math.max(1, ...(r?.months ?? []).flatMap((m) => [m.a.recovered, m.b.recovered]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <select className={sel} value={agentA} onChange={(e) => onA(e.target.value)}>
          <option value="">{t('First agent…')}</option>
          {agents.filter((a) => a.id !== agentB).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <span className="text-sm text-muted-foreground">{t('vs')}</span>
        <select className={sel} value={agentB} onChange={(e) => onB(e.target.value)}>
          <option value="">{t('Second agent…')}</option>
          {agents.filter((a) => a.id !== agentA).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {!ready && <EmptyState icon={Users} title={t('Pick two agents')} description={t('Compare them side by side for the chosen month or quarter. Choose a file above to compare them on the same file.')} />}
      {ready && isLoading && !r && <p className="text-sm text-muted-foreground">{t('Loading…')}</p>}
      {ready && error && !r && <p className="text-sm text-muted-foreground">{t('No performance recorded for these agents in {0}.', periodLabel(scope.period))}</p>}

      {r && (
        <>
          {r.notes.map((n) => (
            <p key={n} className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">{n}</p>
          ))}

          <section className="rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">{periodLabel(r.period)}</th>
                  <th className="px-3 py-3 text-right font-semibold text-foreground">{r.a.name}</th>
                  <th className="px-3 py-3 text-right font-semibold text-foreground">{r.b.name}</th>
                  <th className="px-3 py-3 text-right font-medium">{t('Difference')}</th>
                </tr>
              </thead>
              <tbody>
                {METRICS.map((m) => {
                  const va = m.get(r.a.totals);
                  const vb = m.get(r.b.totals);
                  const lead = !NEUTRAL.has(m.label) && va !== null && vb !== null && va !== vb ? (va > vb ? 'a' : 'b') : null;
                  const diff = va !== null && vb !== null ? va - vb : null;
                  const cell = (v: number | null, side: 'a' | 'b') => (
                    <td className={`px-3 py-2 text-right ${lead === side ? 'font-semibold text-positive' : 'text-foreground'}`}>{v === null ? '—' : m.fmt(v)}</td>
                  );
                  return (
                    <tr key={m.label} className="border-t border-border">
                      <td className="px-4 py-2 text-muted-foreground">{t(m.label)}</td>
                      {cell(va, 'a')}
                      {cell(vb, 'b')}
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {diff === null ? '—' : `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${m.fmt(Math.abs(diff))}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">{t('Recovered each month')}</h2>
            <div className="flex h-36 items-end justify-around gap-6">
              {r.months.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <div className="flex h-28 w-full items-end justify-center gap-2">
                    {([['a', m.a, 'bg-primary'], ['b', m.b, 'bg-primary/40']] as const).map(([k, p, color]) => (
                      <div key={k} className={`w-1/3 rounded-t ${color} ${m.live ? 'opacity-70' : ''}`} style={{ height: `${Math.max(2, (p.recovered / maxMonth) * 100)}%` }}
                        title={`${k === 'a' ? r.a.name : r.b.name}: ${formatMoney(p.recovered)}`} />
                    ))}
                  </div>
                  <span className="text-[10px] text-muted-foreground">{monthLabel(m.month)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><i className="inline-block size-2 rounded-sm bg-primary" />{r.a.name}</span>
              <span className="inline-flex items-center gap-1"><i className="inline-block size-2 rounded-sm bg-primary/40" />{r.b.name}</span>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">{t('By file — files both worked first')}</h2>
            {r.files.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{t('No files in this period.')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">{t('File')}</th>
                      <th className="px-3 py-2 text-right font-medium">{r.a.name} · {t('recovered')}</th>
                      <th className="px-3 py-2 text-right font-medium">{r.a.name} · {t('rate')}</th>
                      <th className="px-3 py-2 text-right font-medium">{r.b.name} · {t('recovered')}</th>
                      <th className="px-3 py-2 text-right font-medium">{r.b.name} · {t('rate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.files.map((f) => {
                      const both = f.a && f.b;
                      const aLeads = both && (f.a!.recoveryRate ?? -1) > (f.b!.recoveryRate ?? -1);
                      const bLeads = both && (f.b!.recoveryRate ?? -1) > (f.a!.recoveryRate ?? -1);
                      return (
                        <tr key={f.fileId} className="border-t border-border">
                          <td className="px-4 py-2 text-foreground">{f.name}<div className="text-xs text-muted-foreground">{f.subtitle}{both ? '' : ` · ${t('only one agent')}`}</div></td>
                          <td className="px-3 py-2 text-right">{f.a ? formatMoney(f.a.recovered) : '—'}</td>
                          <td className={`px-3 py-2 text-right ${aLeads ? 'font-semibold text-positive' : ''}`}>{f.a ? pct(f.a.recoveryRate) : '—'}</td>
                          <td className="px-3 py-2 text-right">{f.b ? formatMoney(f.b.recovered) : '—'}</td>
                          <td className={`px-3 py-2 text-right ${bLeads ? 'font-semibold text-positive' : ''}`}>{f.b ? pct(f.b.recoveryRate) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
