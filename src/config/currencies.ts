// Currencies the DEMO deployment can display (the Uganda system has no switcher).
//
// Amounts are always stored in the base currency (USD). Switching currency only changes how
// they are shown: stored amount x rate. The rates below are fixed, INDICATIVE figures for
// demonstration — not live exchange rates. To refresh them, edit this file and redeploy.
//
// rate = units of this currency per 1 USD.
// fractionDigits = most decimals shown for full (unabbreviated) amounts.

import { DEPLOYMENT } from '@/config/deployment';

export interface CurrencyDef {
  code: string;
  name: string;
  rate: number;
  fractionDigits: number;
}

export const BASE_CURRENCY_CODE = 'USD';

export const DEMO_CURRENCIES: CurrencyDef[] = [
  { code: 'USD', name: 'US dollar', rate: 1, fractionDigits: 2 },
  { code: 'EUR', name: 'Euro', rate: 0.92, fractionDigits: 2 },
  { code: 'MZN', name: 'Mozambican metical', rate: 63.9, fractionDigits: 2 },
  { code: 'KES', name: 'Kenyan shilling', rate: 129.2, fractionDigits: 0 },
  { code: 'TZS', name: 'Tanzanian shilling', rate: 2650, fractionDigits: 0 },
  { code: 'ZMW', name: 'Zambian kwacha', rate: 26.5, fractionDigits: 2 },
  { code: 'ZAR', name: 'South African rand', rate: 18.1, fractionDigits: 2 },
  { code: 'AED', name: 'UAE dirham', rate: 3.6725, fractionDigits: 2 },
  { code: 'ZWG', name: 'Zimbabwe Gold (ZiG)', rate: 26.7, fractionDigits: 2 },
];

// Currencies a FILE can be in when it is imported (demo only): everything the switcher offers
// plus UGX, which is accepted on upload but not offered for display. The importer converts the
// file's amounts to USD once, at upload, at the rates below (indicative, like the display rates).
export const IMPORT_CURRENCIES: CurrencyDef[] = [
  ...DEMO_CURRENCIES,
  { code: 'UGX', name: 'Shilling (UGX)', rate: 3700, fractionDigits: 0 },
];

/**
 * An amount read from an uploaded file, in the currency the uploader said the file is in,
 * as the USD amount to store. No currency (or USD, or anything unrecognised) leaves the
 * amount untouched, and a deployment that is not the demo never converts: the Uganda system
 * has no currency choice and always stores what the file says.
 */
export function usdFromFileAmount(value: number, currencyCode: string | null | undefined): number {
  if (!DEPLOYMENT.demo || !currencyCode || currencyCode === BASE_CURRENCY_CODE) return value;
  const currency = IMPORT_CURRENCIES.find((c) => c.code === currencyCode);
  if (!currency || !(currency.rate > 0)) return value;
  return Math.round((value / currency.rate) * 100) / 100;
}

export const RATES_NOTE =
  'Indicative rates for demonstration — not live. Amounts are stored in USD.';

export function findDemoCurrency(code: string | null | undefined): CurrencyDef | undefined {
  return DEMO_CURRENCIES.find((c) => c.code === code);
}
