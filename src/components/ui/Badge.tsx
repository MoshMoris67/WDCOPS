import React from 'react';

type BadgeVariant = 'default'| 'positive' | 'negative' | 'warning' | 'info' | 'muted' |'cb' | 'ptp' | 'np' | 'na' | 'hu' | 'nb' | 'db' | 'so' | 'os';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-secondary text-secondary-foreground',
  positive: 'bg-[var(--positive-bg)] text-positive border border-[#BBF7D0]',
  negative: 'bg-[var(--negative-bg)] text-negative border border-[#FECACA]',
  warning: 'bg-[var(--warning-bg)] text-warning border border-[#FDE68A]',
  info: 'bg-[var(--info-bg)] text-info border border-[#BFDBFE]',
  muted: 'bg-secondary text-muted-foreground',
  cb: 'disposition-cb',
  ptp: 'disposition-ptp',
  np: 'disposition-np',
  na: 'disposition-na',
  hu: 'disposition-hu',
  nb: 'disposition-nb',
  db: 'disposition-db',
  so: 'disposition-so',
  os: 'disposition-os',
};

const dotClasses: Record<BadgeVariant, string> = {
  default: 'bg-secondary-foreground',
  positive: 'bg-positive',
  negative: 'bg-negative',
  warning: 'bg-warning',
  info: 'bg-info',
  muted: 'bg-muted-foreground',
  cb: 'bg-primary',
  ptp: 'bg-positive',
  np: 'bg-warning',
  na: 'bg-muted-foreground',
  hu: 'bg-orange-600',
  nb: 'bg-violet-600',
  db: 'bg-negative',
  so: 'bg-slate-500',
  os: 'bg-purple-600',
};

export default function Badge({ variant = 'default', children, className = '', dot }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${variantClasses[variant]} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotClasses[variant]}`} />}
      {children}
    </span>
  );
}