// Currencies the DEMO deployment can display (the Uganda system has no switcher).
//
// Amounts are always stored in the base currency (USD). Switching currency only changes how
// they are shown: stored amount x rate. The rates below are fixed, INDICATIVE figures for
// demonstration — not live exchange rates. To refresh them, edit this file and redeploy.
//
// rate = units of this currency per 1 USD.
// fractionDigits = most decimals shown for full (unabbreviated) amounts.

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

export const RATES_NOTE =
  'Indicative rates for demonstration — not live. Amounts are stored in USD.';

export function findDemoCurrency(code: string | null | undefined): CurrencyDef | undefined {
  return DEMO_CURRENCIES.find((c) => c.code === code);
}
