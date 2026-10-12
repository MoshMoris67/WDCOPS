import { DEPLOYMENT } from '@/config/deployment';

// One place that turns an amount into display text, replacing the nine near-identical
// formatUGX copies that used to live in individual screens. The currency code and number
// locale come from the deployment config, so the Uganda system keeps printing exactly
// "UGX 1,234,567" / "UGX 2.4M" while the demo prints USD.
//
// Three variants because the screens differed in how aggressively they abbreviate:
//   formatMoney    full number, never abbreviated
//   formatMoneyM   abbreviates millions ("2.4M")
//   formatMoneyMB  abbreviates millions and billions ("2.40B")

const code = DEPLOYMENT.currencyCode;

export function formatMoney(amount: number): string {
  return `${code} ` + amount.toLocaleString(DEPLOYMENT.locale);
}

export function formatMoneyM(amount: number): string {
  if (amount >= 1000000) return `${code} ${(amount / 1000000).toFixed(1)}M`;
  return formatMoney(amount);
}

export function formatMoneyMB(amount: number): string {
  if (amount >= 1000000000) return `${code} ${(amount / 1000000000).toFixed(2)}B`;
  return formatMoneyM(amount);
}
