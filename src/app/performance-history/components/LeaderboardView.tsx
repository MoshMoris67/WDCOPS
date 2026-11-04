'use client';

import React, { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, TrendingUp, TrendingDown, Trophy } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { useCachedQuery } from '@/lib/use-cached-query';
import { formatMoney } from '@/lib/money';
import { t } from '@/i18n';
import { Leaderboard, LeaderboardRow, Scope, scopeQuery, pct, monthLabel, periodLabel } from './perf-shared';

type SortKey = 'recovered' | 'rate' | 'accountsPaid' | 'callsMade' | 'promisesMade' | 'agentCommission' | 'name';

const sortValue: Record<SortKey, (r: LeaderboardRow) => number | string> = {
  recovered: (r) => r.recovered,
  rate: (r) => r.recoveryRate ?? -1,
  accountsPaid: (r) => r.accountsPaid,
  callsMade: (r) => r.callsMade,
  promisesMade: (r) => r.promisesMade,
  agentCommission: (r) => r.agentCommission,
  name: (r) => r.name.toLowerCase(),
};

export default function LeaderboardView({ scope }: { scope: Scope }) {
  const { data: board, isLoading, error } = useCachedQuery<Leaderboard>(`/api/performance-history?${scopeQuery(scope, { view: 'leaderboard' })}`);
  const [sortKey, setSortKey] = useState<SortKey>('recovered');
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    const list = [...(board?.rows ?? [])];
    const get = sortValue[sortKey];
    list.sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return desc ? -c : c;
    });
    return list;
  }, [board, sortKey, desc]);

  const header = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => (sortKey === key ? setDesc(!desc) : (setSortKey(key), setDesc(key !== 'name')))}
        className={`inline-flex items-center gap-1 ${sortKey === key ? 'text-foreground' : ''}`}
      >
        {label}
        {sortKey === key && (desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
      </button>
    </th>
  );

  const rankMove = (r: LeaderboardRow) => {
    if (r.previousRank === null) return <span className="text-xs text-muted-foreground">{t('new')}</span>;
    const moved = r.previousRank - r.rank;
    if (moved === 0) return <span className="text-xs text-muted-foreground">–</span>;
    return moved > 0
      ? <span className="inline-flex items-center text-xs text-positive"><ArrowUp size={11} />{moved}</span>
      : <span className="inline-flex items-center text-xs text-negative"><ArrowDown size={11} />{-moved}</span>;
  };

  if (isLoading && !board) return <p className="text-sm text-muted-foreground">{t('Loading…')}</p>;
  if (error && !board) return <p className="text-sm text-negative">{error}</p>;
  if (!board) return null;
  if (board.rows.length === 0) {
    return <EmptyState icon={Trophy} title={t('Nothing recorded for {0}', periodLabel(board.period))} description={t('Pick a month that has been rolled over, or the current month.')} />;
  }

  return (
    <div className="space-y-6">
      {board.liveMonths.length > 0 && (
        <p className="rounded-md border border-border bg-secondary px-3 py-2 text-sm text-muted-foreground">
          {t('{0} is still in progress — these figures are live.', board.liveMonths.map(monthLabel).join(', '))}
        </p>
      )}

      {(board.mostImproved || board.biggestDrop) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {board.mostImproved && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <TrendingUp className="text-positive" size={22} />
              <div>
                <div className="text-xs text-muted-foreground">{t('Most improved')}</div>
                <div className="font-semibold text-foreground">{board.mostImproved.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t('recovery rate {0} points vs {1}', `+${board.mostImproved.rateChangePoints!.toFixed(1)}`, periodLabel(board.previousPeriod))}
                </div>
              </div>
            </div>
          )}
          {board.biggestDrop && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
              <TrendingDown className="text-negative" size={22} />
              <div>
                <div className="text-xs text-muted-foreground">{t('Biggest drop')}</div>
                <div className="font-semibold text-foreground">{board.biggestDrop.name}</div>
                <div className="text-xs text-muted-foreground">
                  {t('recovery rate {0} points vs {1}', board.biggestDrop.rateChangePoints!.toFixed(1), periodLabel(board.previousPeriod))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <section className="rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">#</th>
                {header('name', t('Agent'), 'left')}
                {header('recovered', t('Recovered'))}
                {header('rate', t('Rate'))}
                <th className="px-3 py-2 text-right font-medium">{t('Rate change')}</th>
                {header('accountsPaid', t('Paid'))}
                {header('callsMade', t('Calls'))}
                {header('promisesMade', t('Promises'))}
                {header('agentCommission', t('Commission'))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <span className="font-medium text-foreground">{r.rank}</span> {rankMove(r)}
                  </td>
                  <td className="px-3 py-2 text-foreground">{r.name}</td>
                  <td className="px-3 py-2 text-right font-medium text-foreground">{formatMoney(r.recovered)}</td>
                  <td className="px-3 py-2 text-right">{pct(r.recoveryRate)}</td>
                  <td className={`px-3 py-2 text-right ${r.rateChangePoints === null ? 'text-muted-foreground' : r.rateChangePoints > 0 ? 'text-positive' : r.rateChangePoints < 0 ? 'text-negative' : ''}`}>
                    {r.rateChangePoints === null ? '—' : `${r.rateChangePoints > 0 ? '+' : ''}${r.rateChangePoints.toFixed(1)}`}
                  </td>
                  <td className="px-3 py-2 text-right">{r.accountsPaid}</td>
                  <td className="px-3 py-2 text-right">{r.callsMade}</td>
                  <td className="px-3 py-2 text-right">{r.promisesMade}</td>
                  <td className="px-3 py-2 text-right">{r.agentCommission ? formatMoney(r.agentCommission) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        {t('Rank is by amount recovered; arrows show movement since {0}. Rate change is in percentage points. Agents with very different book sizes are better compared on rate.', periodLabel(board.previousPeriod))}
      </p>
    </div>
  );
}
