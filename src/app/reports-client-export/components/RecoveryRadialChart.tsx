'use client';

import React from 'react';
import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from 'recharts';

interface Props {
  percentage: number;
  label: string;
}

export default function RecoveryRadialChart({ percentage, label }: Props) {
  const data = [{ name: label, value: percentage, fill: 'var(--positive)' }];
  return (
    <div className="relative flex items-center justify-center">
      <ResponsiveContainer width={120} height={120}>
        <RadialBarChart
          cx="50%"
          cy="50%"
          innerRadius="65%"
          outerRadius="100%"
          data={data}
          startAngle={90}
          endAngle={-270}
          barSize={12}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar background={{ fill: 'var(--secondary)' }} dataKey="value" angleAxisId={0} cornerRadius={6} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-tabular font-bold text-xl text-foreground">{percentage}%</span>
        <span className="text-xs text-muted-foreground">recovered</span>
      </div>
    </div>
  );
}