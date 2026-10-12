import { useEffect, useSyncExternalStore } from 'react';
import { DEPLOYMENT } from '@/config/deployment';
import {
  BASE_CURRENCY_CODE,
  DEMO_CURRENCIES,
  findDemoCurrency,
  type CurrencyDef,
} from '@/config/currencies';

// The demo's currently selected display currency, kept in a tiny module-level store so the
// plain formatter functions in lib/money.ts can read it while rendering, and so the switcher
// and every screen can react when it changes. The choice is remembered in the browser.
//
// The Uganda system never switches: getActiveCurrency() always returns its own currency
// at a rate of 1, so nothing here changes how amounts print there.

const STORAGE_KEY = 'wellcash-demo-currency';

let current: string = BASE_CURRENCY_CODE;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveCurrency():
  CurrencyDef | { code: string; rate: 1; fractionDigits?: undefined } {
  if (!DEPLOYMENT.demo) return { code: DEPLOYMENT.currencyCode, rate: 1 };
  return findDemoCurrency(current) ?? DEMO_CURRENCIES[0];
}

export function setCurrencyCode(code: string) {
  if (!DEPLOYMENT.demo || !findDemoCurrency(code) || code === current) return;
  current = code;
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage can be blocked (private window); the choice just won't survive a reload.
  }
  emit();
}

// Reads the saved choice once, after the first client render (never during it, so the first
// client render matches the server's USD output and hydration stays clean), and keeps other
// open tabs in step.
function loadOnce() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  const apply = (value: string | null) => {
    if (value && findDemoCurrency(value) && value !== current) {
      current = value;
      emit();
    }
  };
  try {
    apply(localStorage.getItem(STORAGE_KEY));
  } catch {
    // ignore
  }
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) apply(e.newValue);
  });
}

/** Subscribes the calling component to the selected currency code (and loads the saved one). */
export function useCurrencyCode(): string {
  const code = useSyncExternalStore(
    subscribe,
    () => current,
    () => BASE_CURRENCY_CODE
  );
  useEffect(loadOnce, []);
  return code;
}
