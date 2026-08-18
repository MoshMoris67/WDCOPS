import React from 'react';
import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';


interface KPICardProps {
  label: string;
  value: string | number;
  subtext?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon: LucideIcon;
  variant?: 'default' | 'positive' | 'negative' | 'warning' | 'info';
  featured?: boolean;
}

const variantStyles = {
  default: { card: 'bg-card border border-border', icon: 'bg-secondary text-secondary-foreground', value: 'text-foreground' },
  positive: { card: 'bg-card border border-[#BBF7D0]', icon: 'bg-[var(--positive-bg)] text-positive', value: 'text-positive' },
  negative: { card: 'bg-card border border-[#FECACA]', icon: 'bg-[var(--negative-bg)] text-negative', value: 'text-negative' },
  warning: { card: 'bg-card border border-[#FDE68A]', icon: 'bg-[var(--warning-bg)] text-warning', value: 'text-warning' },
  info: { card: 'bg-card border border-[#BFDBFE]', icon: 'bg-[var(--info-bg)] text-info', value: 'text-info' },
};

export default function KPICard({ label, value, subtext, trend, trendValue, icon: Icon, variant = 'default', featured }: KPICardProps) {
  const styles = variantStyles[variant];
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? 'text-positive' : trend === 'down' ? 'text-negative' : 'text-muted-foreground';

  return (
    <div className={`${styles.card} rounded-xl shadow-card p-5 flex flex-col gap-3 ${featured ? 'col-span-2' : ''} hover:shadow-card-hover transition-shadow duration-200`}>
      <div className="flex items-start justify-between">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${styles.icon}`}>
          <Icon size={18} />
        </div>
        {trend && trendValue && (
          <div className={`flex items-center gap-1 text-xs font-semibold ${trendColor}`}>
            <TrendIcon size={13} />
            <span>{trendValue}</span>
          </div>
        )}
      </div>
      <div>
        <p className="text-card-label text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
        <p className={`font-tabular font-bold text-hero-value ${styles.value}`}>{value}</p>
        {subtext && <p className="text-xs text-muted-foreground mt-1">{subtext}</p>}
      </div>
    </div>
  );
}