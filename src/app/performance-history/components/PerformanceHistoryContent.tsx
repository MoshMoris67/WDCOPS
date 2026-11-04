'use client';

import React, { useMemo, useState } from 'react';
import { Wallet, Percent, Users, PhoneCall, Handshake, Coins } from 'lucide-react';
import KPICard from '@/app/components/KPICard';
import EmptyState from '@/components/ui/EmptyState';
import { useCachedQuery } from '@/lib/use-cached-query';
import { useClients } from '@/lib/use-clients';
import { formatMoney, formatMoneyM } from '@/lib/money';
import { t } from '@/i18n';
import { monthKey, quarterOf, shiftQuarter } from '@/lib/performance-history-keys';
import { Row, Report, FileOption, AgentOption, pct, monthLabel, shortMonth, periodLabel, change } from './perf-shared';
import AgentView from './AgentView';
import CompareView from './CompareView';

export default function PerformanceHistoryContent() {
  const thisMonth = monthKey(new Date());
  const [kind, setKind] = useState<'month' | 'quarter'>('month');
  const [month, setMonth] = useState(thisMonth);
  const [quarter, setQuarter] = useState(quarterOf(thisMonth));
  const [clientId, setClientId] = useState('');
  const [fileId, setFileId] = useState('');
  const [tab, setTab] = useState<'overview' | 'agent' | 'compare'>('overview');
  const [agentId, setAgentId] = useState('');
  const [agentA, setAgentA] = useState('');
  const [agentB, setAgentB] = useState('');

  const clients = useClients();
  const { data: filesData } = useCachedQuery<{ files: FileOption[] }>('/api/files');
  const files = useMemo(() => (filesData?.files ?? []).filter((f) => !clientId || f.clientId === clientId), [filesData, clientId]);

  const period = kind === 'month' ? month : quarter;
  const qs = new URLSearchParams({ period });
  if (clientId) qs.set('clientId', clientId);
  if (fileId) qs.set('fileId', fileId);
  const { data: report, isLoading, error } = useCachedQuery<Report>(`/api/performance-history?${qs.toString()}`);

  // Selectable agents: every active agent, plus anyone with history in this period (e.g. an agent
  // whose account was since deleted still shows up by the name saved with their results).
  const { data: usersData } = useCachedQuery<{ users: { id: string; name: string; role: string }[] }>('/api/users');
  const agentOptions: AgentOption[] = useMemo(() => {
    const byId = new Map<string, AgentOption>();
    for (const u of usersData?.users ?? []) if (u.role === 'agent') byId.set(u.id, { id: u.id, name: u.name });
    for (const a of report?.agents ?? []) if (!byId.has(a.id)) byId.set(a.id, { id: a.id, name: a.name });
    return [...byId.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [usersData, report]);
  const scope = { period, clientId, fileId };

  const quarterOptions = useMemo(() => Array.from({ length: 8 }, (_, i) => shiftQuarter(quarterOf(thisMonth), -i)), [thisMonth]);
  const maxTrend = Math.max(1, ...(report?.trend ?? []).map((p) => p.recovered));
  const prev = report?.previousTotals;
  const cur = report?.totals;
  const noData = !!report && report.totals.recovered === 0 && report.totals.callsMade === 0 && report.emptyMonths.length === (report.months.length);

  const sel = 'h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground';

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t('Performance History')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('How the team performed in any month or quarter — by client, file and agent. Saved automatically each time a client is rolled into a new month.')}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border p-0.5">
          {(['month', 'quarter'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded px-3 py-1.5 text-sm ${kind === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              {k === 'month' ? t('Month') : t('Quarter')}
            </button>
          ))}
        </div>
        {kind === 'month' ? (
          <input type="month" className={sel} value={month} max={thisMonth} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        ) : (
          <select className={sel} value={quarter} onChange={(e) => setQuarter(e.target.value)}>
            {quarterOptions.map((q) => (
              <option key={q} value={q}>{periodLabel(q)}</option>
            ))}
          </select>
        )}
        <select className={sel} value={clientId} onChange={(e) => { setClientId(e.target.value); setFileId(''); }}>
          <option value="">{t('All clients')}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className={sel} value={fileId} onChange={(e) => setFileId(e.target.value)}>
          <option value="">{t('All files')}</option>
          {files.map((f) => (
            <option key={f.id} value={f.id}>{f.batchLabel}</option>
          ))}
        </select>
      </div>

      <div className="inline-flex rounded-md border border-border p-0.5">
        {([['overview', t('Overview')], ['agent', t('Agent')], ['compare', t('Compare agents')]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded px-3 py-1.5 text-sm ${tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'agent' && <AgentView scope={scope} agents={agentOptions} agentId={agentId} onAgent={setAgentId} />}
      {tab === 'compare' && <CompareView scope={scope} agents={agentOptions} agentA={agentA} agentB={agentB} onA={setAgentA} onB={setAgentB} />}

      {tab === 'overview' && error && !report && <p className="text-sm text-negative">{error}</p>}
      {tab === 'overview' && isLoading && !report && <p className="text-sm text-muted-foreground">{t('Loading…')}</p>}

      {tab === 'overview' && report && cur && prev && (
        <>
          {report.liveMonths.length > 0 && (
            <p className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">
              {t('{0} is still in progress — these figures are live and will keep moving until the month is rolled over.', report.liveMonths.map(monthLabel).join(', '))}
            </p>
          )}
          {!report.liveMonths.length && report.emptyMonths.length > 0 && (
            <p className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">
              {t('No saved performance for {0}. History starts from the first month rolled over after this feature was added.', report.emptyMonths.map(monthLabel).join(', '))}
            </p>
          )}

          {noData ? (
            <EmptyState icon={Wallet} title={t('Nothing recorded for {0}', periodLabel(report.period))} description={t('Pick a month that has been rolled over, or the current month.')} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
                <KPICard label={t('Recovered')} value={formatMoneyM(cur.recovered)} icon={Wallet} variant="positive"
                  trend={change(cur.recovered, prev.recovered).tone} trendValue={change(cur.recovered, prev.recovered).text}
                  subtext={t('vs {0}', periodLabel(report.previousPeriod))} />
                <KPICard label={t('Recovery rate')} value={pct(cur.recoveryRate)} icon={Percent} subtext={t('of {0} on the books', formatMoneyM(cur.bookAmount))} />
                <KPICard label={t('Accounts that paid')} value={cur.accountsPaid} icon={Users} subtext={t('of {0} held', cur.accountsAssigned)}
                  trend={change(cur.accountsPaid, prev.accountsPaid).tone} trendValue={change(cur.accountsPaid, prev.accountsPaid).text} />
                <KPICard label={t('Calls made')} value={cur.callsMade} icon={PhoneCall}
                  trend={change(cur.callsMade, prev.callsMade).tone} trendValue={change(cur.callsMade, prev.callsMade).text} />
                <KPICard label={t('Promises to pay')} value={cur.promisesMade} icon={Handshake} subtext={formatMoneyM(cur.promisedAmount)} />
                <KPICard label={t('Agent commission')} value={formatMoneyM(cur.agentCommission)} icon={Coins} subtext={cur.agentCommission === 0 ? t('no commission clients') : undefined} />
              </div>

              <section className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">{t('Recovered, last 12 months')}</h2>
                <div className="flex h-32 items-end gap-2">
                  {report.trend.map((p) => (
                    <div key={p.month} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${monthLabel(p.month)}: ${formatMoney(p.recovered)}`}>
                      <div
                        className={`w-full rounded-t ${report.months.some((m) => m.month === p.month) ? 'bg-primary' : 'bg-primary/30'} ${p.live ? 'opacity-70' : ''}`}
                        style={{ height: `${Math.max(2, (p.recovered / maxTrend) * 100)}%` }}
                      />
                      <span className="text-[10px] text-muted-foreground">{shortMonth(p.month)}</span>
                    </div>
                  ))}
                </div>
              </section>

              {report.kind === 'quarter' && (
                <section className="rounded-lg border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-semibold text-foreground">{t('Month by month')}</h2>
                  <div className="grid grid-cols-3 gap-3">
                    {report.months.map((m) => (
                      <div key={m.month} className="rounded-md bg-secondary p-3">
                        <div className="text-xs text-muted-foreground">{monthLabel(m.month)}{m.live ? ` (${t('live')})` : ''}</div>
                        <div className="text-lg font-semibold text-foreground">{formatMoneyM(m.recovered)}</div>
                        <div className="text-xs text-muted-foreground">{pct(m.recoveryRate)}</div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <BreakdownTable title={t('By file')} firstCol={t('File')} rows={report.files} showSub />
              <BreakdownTable title={t('By agent')} firstCol={t('Agent')} rows={report.agents} />
              <p className="text-xs text-muted-foreground">
                {t('A payment counts in the month it was actually paid and is credited to the agent who held the account that day. Recovery rate = recovered ÷ amount owed on the accounts held.')}
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function BreakdownTable({ title, firstCol, rows, showSub }: { title: string; firstCol: string; rows: Row[]; showSub?: boolean }) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t('No activity in this period.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">{firstCol}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Recovered')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Rate')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Accounts held')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Paid')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Calls')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Promises')}</th>
                <th className="px-3 py-2 text-right font-medium">{t('Commission')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2 text-foreground">
                    {r.name}
                    {showSub && r.subtitle && <div className="text-xs text-muted-foreground">{r.subtitle}</div>}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-foreground">{formatMoney(r.recovered)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.recoveryRate)}</td>
                  <td className="px-3 py-2 text-right">{r.accountsAssigned}</td>
                  <td className="px-3 py-2 text-right">{r.accountsPaid}</td>
                  <td className="px-3 py-2 text-right">{r.callsMade}</td>
                  <td className="px-3 py-2 text-right">{r.promisesMade}</td>
                  <td className="px-3 py-2 text-right">{r.agentCommission ? formatMoney(r.agentCommission) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
