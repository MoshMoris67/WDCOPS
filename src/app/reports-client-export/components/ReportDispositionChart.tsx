'use client';

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList,
} from 'recharts';

interface Props {
  data: Array<{ code: string; count: number; color: string }>;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: { code: string } }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-dropdown px-3 py-2">
      <p className="text-xs font-semibold text-foreground">{payload[0].payload.code}</p>
      <p className="text-xs text-muted-foreground">{payload[0].value} dispositions</p>
    </div>
  );
}

export default function ReportDispositionChart({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 16, right: 4, left: -20, bottom: 0 }} barSize={28}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="code" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--secondary)' }} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={`rpt-cell-${entry.code}`} fill={entry.color} />
          ))}
          <LabelList dataKey="count" position="top" style={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}