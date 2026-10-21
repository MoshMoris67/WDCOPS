'use client';

import React from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoneyMB } from '@/lib/money';
import { localeFor, t } from '@/i18n';

interface Props {
  data: { date: string; calls: number; collected: number }[];
}

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ dataKey: string; value: number }>;
}

function ActivityTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !label || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-dropdown px-3 py-2">
      <p className="text-xs font-semibold text-foreground">
        {new Date(`${label}T00:00:00`).toLocaleDateString(localeFor('en-GB'))}
      </p>
      {payload.map((item) => (
        <p key={item.dataKey} className="text-xs text-muted-foreground">
          {item.dataKey === 'calls'
            ? t('{0} calls', item.value)
            : t('Collections: {0}', formatMoneyMB(item.value))}
        </p>
      ))}
    </div>
  );
}

export default function ReportActivityChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 12, right: 8, left: -16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(value: string) =>
            new Date(`${value}T00:00:00`).toLocaleDateString(localeFor('en-GB'), {
              day: '2-digit',
              month: 'short',
            })
          }
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          yAxisId="calls"
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <YAxis yAxisId="collected" orientation="right" hide />
        <Tooltip content={<ActivityTooltip />} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line
          yAxisId="calls"
          type="monotone"
          dataKey="calls"
          name={t('Calls')}
          stroke="var(--info)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          yAxisId="collected"
          type="monotone"
          dataKey="collected"
          name={t('Collections')}
          stroke="var(--positive)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
