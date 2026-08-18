import { bandForBalance } from './distribution';

// Row/card background tint driven by the same signals already shown via badges/icons
// elsewhere (stale flag, balance band) — centralized here so every list screen agrees on
// what a debtor row's background should look like, instead of re-deriving it per screen.
const BALANCE_BAND_ROW_CLASS: Record<string, string> = {
  band0_500k: 'bg-[var(--positive-bg)]/40',
  band500k_2m: 'bg-[var(--warning-bg)]/40',
  band2m_5m: 'bg-[var(--negative-bg)]/30',
  band5m_plus: 'bg-[var(--negative-bg)]/30',
};

// Stale takes visual priority over balance band — matches the always-shown AlertTriangle
// warning icon already used next to a stale debtor's name.
export function debtorRowTint({ isStale, balance }: { isStale: boolean; balance: number }): string {
  if (isStale) return 'bg-[var(--negative-bg)]/50';
  return BALANCE_BAND_ROW_CLASS[bandForBalance(balance)] ?? '';
}
