import { useEffect, useSyncExternalStore } from 'react';
import { DEPLOYMENT } from '@/config/deployment';

// Language support for the DEMO deployment.
//
// Screen text is written in English in the source and wrapped in t(): the English text is the
// lookup key, so an untranslated string simply stays English and nothing is ever blank. On the
// Uganda system (and whenever English is selected) t() returns the English text itself with
// only the {0}, {1}… placeholders filled in, so nothing changes there.
//
// Dictionaries live in src/i18n/dict/<code>.json, are loaded on demand, and are only ever used
// when NEXT_PUBLIC_DEMO_MODE=true.

export type LangCode = 'en' | 'pt' | 'sw' | 'sn';

export interface Language {
  code: LangCode;
  /** Name shown in the menu, in the language itself. */
  native: string;
  /** English name (for translators and docs). */
  english: string;
  /** Locale used for dates and numbers in this language (Shona has no browser date data, so it uses day-first English dates). */
  locale: string;
}

export const LANGUAGES: Language[] = [
  { code: 'en', native: 'English', english: 'English', locale: 'en-GB' },
  { code: 'pt', native: 'Português', english: 'Portuguese (Mozambique)', locale: 'pt-MZ' },
  { code: 'sw', native: 'Kiswahili', english: 'Swahili', locale: 'sw-KE' },
  { code: 'sn', native: 'chiShona', english: 'Shona', locale: 'en-GB' },
];

const STORAGE_KEY = 'wellcash-demo-language';
const DEFAULT: LangCode = 'en';

type Dictionary = Record<string, string>;

let current: LangCode = DEFAULT;
let dictionary: Dictionary | null = null;
let loaded = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const isLang = (v: unknown): v is LangCode => LANGUAGES.some((l) => l.code === v);

async function loadDictionary(code: LangCode): Promise<Dictionary | null> {
  switch (code) {
    case 'pt':
      return (await import('./dict/pt.json')).default as Dictionary;
    case 'sw':
      return (await import('./dict/sw.json')).default as Dictionary;
    case 'sn':
      return (await import('./dict/sn.json')).default as Dictionary;
    default:
      return null;
  }
}

function fill(template: string, args: unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (_m, i) => {
    const v = args[Number(i)];
    return v === undefined || v === null || typeof v === 'boolean' ? '' : String(v);
  });
}

/**
 * Translates `text` (English) into the selected language and fills {0}, {1}… with `args`.
 * Falls back to the English text when there is no translation.
 */
export function t(text: string | null | undefined, ...args: unknown[]): string {
  if (text === null || text === undefined) return '';
  const template = (DEPLOYMENT.demo && dictionary && dictionary[text]) || text;
  return args.length ? fill(template, args) : template;
}

export function getLanguage(): LangCode {
  return current;
}

/** BCP 47 locale for dates and numbers: the selected language's in the demo, otherwise `fallback`. */
export function localeFor(fallback: string): string {
  if (!DEPLOYMENT.demo) return fallback;
  return LANGUAGES.find((l) => l.code === current)?.locale ?? fallback;
}

async function apply(code: LangCode, persist: boolean) {
  if (!DEPLOYMENT.demo || !isLang(code) || code === current) return;
  let dict: Dictionary | null = null;
  try {
    dict = await loadDictionary(code);
  } catch {
    return; // dictionary failed to load (offline?) — keep the current language
  }
  dictionary = dict;
  current = code;
  if (typeof document !== 'undefined') document.documentElement.lang = code;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // storage blocked — the choice just won't survive a reload
    }
  }
  emit();
}

export function setLanguage(code: LangCode) {
  return apply(code, true);
}

// Reads the saved language once, after the first client render (never during it, so the first
// client render matches the server's English and hydration stays clean), and keeps other tabs
// in step.
function loadOnce() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) void apply(saved, false);
  } catch {
    // ignore
  }
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && isLang(e.newValue)) void apply(e.newValue, false);
  });
}

/** Subscribes the calling component to the selected language (and loads the saved one). */
export function useLanguage(): LangCode {
  const code = useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT
  );
  useEffect(loadOnce, []);
  return code;
}
