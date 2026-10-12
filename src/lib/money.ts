import { DEPLOYMENT } from '@/config/deployment';
import { getActiveCurrency } from '@/lib/currency-store';

// One place that turns an amount into display text, replacing the nine near-identical
// formatUGX copies that used to live in individual screens.
//
// The Uganda system prints exactly "UGX 1,234,567" / "UGX 2.4M" as before (rate 1, no
// decimal cap). In the demo, amounts are stored in USD and shown in whichever currency the
// viewer picked (see config/currencies.ts and lib/currency-store.ts).
//
// Three variants because the screens differed in how aggressively they abbreviate:
//   formatMoney    full number, never abbreviated
//   formatMoneyM   abbreviates millions ("2.4M")
//   formatMoneyMB  abbreviates millions and billions ("2.40B")

function convert(amount: number) {
  const c = getActiveCurrency();
  return { code: c.code, value: amount * c.rate, fractionDigits: c.fractionDigits };
}

function full(code: string, value: number, fractionDigits: number | undefined): string {
  const options =
    fractionDigits === undefined ? undefined : { maximumFractionDigits: fractionDigits };
  return `${code} ` + value.toLocaleString(DEPLOYMENT.locale, options);
}

export function formatMoney(amount: number): string {
  const { code, value, fractionDigits } = convert(amount);
  return full(code, value, fractionDigits);
}

export function formatMoneyM(amount: number): string {
  const { code, value, fractionDigits } = convert(amount);
  if (value >= 1000000) return `${code} ${(value / 1000000).toFixed(1)}M`;
  return full(code, value, fractionDigits);
}

export function formatMoneyMB(amount: number): string {
  const { code, value, fractionDigits } = convert(amount);
  if (value >= 1000000000) return `${code} ${(value / 1000000000).toFixed(2)}B`;
  if (value >= 1000000) return `${code} ${(value / 1000000).toFixed(1)}M`;
  return full(code, value, fractionDigits);
}
