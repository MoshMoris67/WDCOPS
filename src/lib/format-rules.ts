import { bandForBalance } from './distribution';

// Row/card background tint driven by balance band — centralized here so every list
// screen agrees on what a debtor row's background should look like, instead of
// re-deriving it per screen.
const BALANCE_BAND_ROW_CLASS: Record<string, string> = {
  band0_500k: 'bg-[var(--positive-bg)]/40',
  band500k_2m: 'bg-[var(--warning-bg)]/40',
  band2m_5m: 'bg-[var(--negative-bg)]/30',
  band5m_plus: 'bg-[var(--negative-bg)]/30',
};

export function debtorRowTint({ balance }: { balance: number }): string {
  return BALANCE_BAND_ROW_CLASS[bandForBalance(balance)] ?? '';
}
