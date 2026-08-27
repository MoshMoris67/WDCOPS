import React from 'react';
import { FileText } from 'lucide-react';

interface RecentFile {
  id: string;
  batchLabel: string;
  receivedDate: string;
}

interface ClientCardProps {
  name: string;
  categoryLabel: string;
  debtorCount: number;
  contactRate: number;
  recovered: number;
  totalOwed: number;
  totalBalance: number;
  recentFiles?: RecentFile[];
  onClick?: () => void;
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// A handful of accent pairs (bar + soft badge tint), picked deterministically per
// client name — same idea as lib/client-badge.ts's clientBadgeVariant, but returning
// a real hex pair since this card needs an actual accent color for the stripe/progress
// bar, not just one of Badge's fixed semantic variants. Any client, current or future,
// gets a stable color with zero hardcoding of names.
const ACCENTS = [
  { bar: '#1D4ED8', light: '#3B82F6', soft: '#EFF6FF', text: '#1D4ED8' },
  { bar: '#7C3AED', light: '#A78BFA', soft: '#F5F3FF', text: '#7C3AED' },
  { bar: '#0D9488', light: '#2DD4BF', soft: '#F0FDFA', text: '#0F766E' },
  { bar: '#D97706', light: '#FBBF24', soft: '#FFFBEB', text: '#B45309' },
  { bar: '#DB2777', light: '#F472B6', soft: '#FDF2F8', text: '#BE185D' },
  { bar: '#4F46E5', light: '#818CF8', soft: '#EEF2FF', text: '#4338CA' },
] as const;

function accentFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length];
}

function formatUGX(amount: number) {
  if (amount >= 1000000) return `UGX ${(amount / 1000000).toFixed(1)}M`;
  return 'UGX ' + amount.toLocaleString('en-UG');
}

export default function ClientCard({ name, categoryLabel, debtorCount, contactRate, recovered, totalOwed, totalBalance, recentFiles, onClick }: ClientCardProps) {
  const accent = accentFor(name);
  const recoveryPct = totalOwed > 0 ? Math.round((recovered / totalOwed) * 100) : 0;

  return (
    <div
      onClick={onClick}
      className={`group relative bg-card border border-border rounded-xl shadow-card hover:shadow-card-hover transition-all overflow-hidden ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="absolute top-0 left-0 w-1.5 h-full" style={{ background: `linear-gradient(180deg, ${accent.light}, ${accent.bar})` }} />
      <div className="p-5 pl-6">
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full inline-block mb-2"
          style={{ color: accent.text, backgroundColor: accent.soft }}
        >
          {categoryLabel}
        </span>

        <h3 className="text-lg font-bold text-foreground group-hover:text-primary transition-colors truncate">{name}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{debtorCount.toLocaleString()} debtor{debtorCount === 1 ? '' : 's'} on file</p>

        <div className="grid grid-cols-3 gap-3 my-4 rounded-lg p-3.5 border border-border/60" style={{ background: 'linear-gradient(135deg, var(--secondary), transparent)' }}>
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Book Value</span>
            <span className="text-sm font-bold text-foreground font-tabular">{formatUGX(totalBalance)}</span>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Contact Rate</span>
            <span className="text-sm font-bold text-foreground font-tabular">{contactRate}%</span>
          </div>
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">Recovered</span>
            <span className="text-sm font-bold text-positive font-tabular">{formatUGX(recovered)}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Recovery Progress</span>
            <span className="font-bold text-foreground font-tabular">{recoveryPct}%</span>
          </div>
          <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, recoveryPct)}%`, background: `linear-gradient(90deg, ${accent.light}, ${accent.bar})` }} />
          </div>
        </div>

        {recentFiles && recentFiles.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/60 space-y-1">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Recent Files</span>
            {recentFiles.map((f) => (
              <div key={f.id} className="flex items-center gap-1.5 text-xs">
                <FileText size={11} className="text-muted-foreground shrink-0" />
                <span className="text-foreground truncate flex-1 font-mono-data">{f.batchLabel}</span>
                <span className="text-muted-foreground shrink-0">{formatShortDate(f.receivedDate)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
