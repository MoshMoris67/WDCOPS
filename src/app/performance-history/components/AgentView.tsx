'use client';

import React from 'react';
import { Wallet, Percent, Trophy, PhoneCall, Handshake, Users } from 'lucide-react';
import KPICard from '@/app/components/KPICard';
import EmptyState from '@/components/ui/EmptyState';
import { useCachedQuery } from '@/lib/use-cached-query';
import { formatMoney, formatMoneyM } from '@/lib/money';
import { t } from '@/i18n';
import { AgentReport, AgentOption, Scope, scopeQuery, pct, monthLabel, shortMonth, periodLabel, change } from './perf-shared';

interface Props {
  scope: Scope;
  agents: AgentOption[];
  agentId: string;
  onAgent: (id: string) => void;
}

export default function AgentView({ scope, agents, agentId, onAgent }: Props) {
  const { data: r, isLoading, error } = useCachedQuery<AgentReport>(`/api/performance-history?${scopeQuery(scope, { view: 'agent', agentId })}`, {
    enabled: !!agentId,
  });
  const maxRecovered = Math.max(1, ...(r?.trend ?? []).map((p) => p.recovered));

  return (
    <div className="space-y-6">
      <select className="h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground" value={agentId} onChange={(e) => onAgent(e.target.value)}>
        <option value="">{t('Choose an agent…')}</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>

      {!agentId && <EmptyState icon={Users} title={t('Pick an agent')} description={t('See how one agent has performed month by month, where they rank in the team, and which files they do best on.')} />}
      {agentId && isLoading && !r && <p className="text-sm text-muted-foreground">{t('Loading…')}</p>}
      {agentId && error && !r && <p className="text-sm text-muted-foreground">{t('No performance recorded for this agent in {0}.', periodLabel(scope.period))}</p>}

      {r && (
        <>
          {r.liveMonths.length > 0 && (
            <p className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">
              {t('{0} is still in progress — these figures are live.', r.liveMonths.map(monthLabel).join(', '))}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <KPICard label={t('Recovered')} value={formatMoneyM(r.totals.recovered)} icon={Wallet} variant="positive"
              trend={change(r.totals.recovered, r.previousTotals.recovered).tone} trendValue={change(r.totals.recovered, r.previousTotals.recovered).text}
              subtext={t('vs {0}', periodLabel(r.previousPeriod))} />
            <KPICard label={t('Recovery rate')} value={pct(r.totals.recoveryRate)} icon={Percent}
              subtext={r.teamAverageRate === null ? undefined : t('team average {0}', pct(r.teamAverageRate))} />
            <KPICard label={t('Rank by amount')} value={r.rankByRecovered ? `${r.rankByRecovered} / ${r.teamSize}` : '—'} icon={Trophy} />
            <KPICard label={t('Rank by rate')} value={r.rankByRate ? `${r.rankByRate} / ${r.teamSize}` : '—'} icon={Trophy} subtext={t('fairer when books differ')} />
            <KPICard label={t('Calls made')} value={r.totals.callsMade} icon={PhoneCall}
              trend={change(r.totals.callsMade, r.previousTotals.callsMade).tone} trendValue={change(r.totals.callsMade, r.previousTotals.callsMade).text} />
            <KPICard label={t('Promises to pay')} value={r.totals.promisesMade} icon={Handshake} subtext={formatMoneyM(r.totals.promisedAmount)} />
          </div>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">{t('{0}: recovered, last 12 months', r.agentName)}</h2>
            <div className="flex h-36 items-end gap-2">
              {r.trend.map((p) => (
                <div key={p.month} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${monthLabel(p.month)}: ${formatMoney(p.recovered)} · ${pct(p.recoveryRate)}`}>
                  <span className="text-[10px] text-muted-foreground">{p.rank ? `#${p.rank}` : ''}</span>
                  <div className={`w-full rounded-t bg-primary ${p.live ? 'opacity-70' : ''}`} style={{ height: `${Math.max(2, (p.recovered / maxRecovered) * 100)}%` }} />
                  <span className="text-[10px] text-muted-foreground">{shortMonth(p.month)}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{t('The number above each bar is the agent’s rank in the team that month, by amount recovered.')}</p>
          </section>

          <section className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">{t('Files — strongest first')}</h2>
            {r.files.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">{t('No files in this period.')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 font-medium">{t('File')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('Recovered')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('Rate')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('Accounts held')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('Paid')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('Calls')}</th>
                      <th className="px-3 py-2 text-right font-medium">{t('Promises')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.files.map((f) => (
                      <tr key={f.id} className="border-t border-border">
                        <td className="px-4 py-2 text-foreground">{f.name}<div className="text-xs text-muted-foreground">{f.subtitle}</div></td>
                        <td className="px-3 py-2 text-right font-medium text-foreground">{formatMoney(f.recovered)}</td>
                        <td className="px-3 py-2 text-right">{pct(f.recoveryRate)}</td>
                        <td className="px-3 py-2 text-right">{f.accountsAssigned}</td>
                        <td className="px-3 py-2 text-right">{f.accountsPaid}</td>
                        <td className="px-3 py-2 text-right">{f.callsMade}</td>
                        <td className="px-3 py-2 text-right">{f.promisesMade}</td>
                      </tr>
                    ))}
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
