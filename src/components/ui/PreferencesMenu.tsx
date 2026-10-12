'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { DEPLOYMENT } from '@/config/deployment';
import { DEMO_CURRENCIES, RATES_NOTE } from '@/config/currencies';
import { setCurrencyCode, useCurrencyCode } from '@/lib/currency-store';
import { LANGUAGES, setLanguage, t, useLanguage } from '@/i18n';

interface PreferencesMenuProps {
  /** "row" matches the sidebar's ThemeToggle row; "pill" is a compact button for top bars. */
  variant?: 'row' | 'pill';
  collapsed?: boolean;
}

// Demo-only picker for the display language and currency. Renders nothing on the Uganda system.
export default function PreferencesMenu({ variant = 'row', collapsed = false }: PreferencesMenuProps) {
  const lang = useLanguage();
  const currency = useCurrencyCode();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!DEPLOYMENT.demo) return null;

  // Fixed positioning, through a portal, so the menu is never clipped or shifted by an
  // ancestor's overflow or transform (the login form animates in with a transform).
  const toggle = () => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      const width = 264;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const room = Math.max(160, Math.min(window.innerHeight - r.bottom - 14, 560));
      const placeBelow = window.innerHeight - r.bottom > 420 || r.top < 260;
      setPos(
        placeBelow
          ? { position: 'fixed', top: r.bottom + 6, left, width, maxHeight: room }
          : { position: 'fixed', bottom: window.innerHeight - r.top + 6, left, width, maxHeight: Math.min(r.top - 14, 560) }
      );
    }
    setOpen(!open);
  };

  const code = lang.toUpperCase();
  const summary = `${code} · ${currency}`;
  const label = `${t('Language and currency')}: ${summary}`;

  const buttonClass =
    variant === 'row'
      ? `w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm font-medium text-secondary-foreground hover:bg-secondary transition-colors ${collapsed ? 'justify-center' : ''}`
      : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-secondary transition-colors';

  const optionClass = (selected: boolean) =>
    `w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left transition-colors hover:bg-secondary ${
      selected ? 'text-primary font-semibold' : 'text-foreground'
    }`;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={t('Language and currency')}
        className={buttonClass}
      >
        <Globe size={16} className="shrink-0" />
        {variant === 'row' ? (
          !collapsed && (
            <>
              <span className="flex-1 text-left">{t('Language and currency')}</span>
              <span className="font-mono-data text-xs text-muted-foreground">{summary}</span>
            </>
          )
        ) : (
          <>
            <span className="font-mono-data">{summary}</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={pos}
            role="dialog"
            aria-label={t('Language and currency')}
            className="z-[70] rounded-xl border border-border bg-card shadow-modal p-1.5 overflow-y-auto scrollbar-thin"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('Language')}
            </p>
            <ul role="listbox" aria-label={t('Language')}>
              {LANGUAGES.map((l) => (
                <li key={l.code} role="option" aria-selected={l.code === lang}>
                  <button
                    type="button"
                    lang={l.code}
                    onClick={() => {
                      void setLanguage(l.code);
                      buttonRef.current?.focus();
                    }}
                    className={optionClass(l.code === lang)}
                  >
                    <span className="flex-1">{l.native}</span>
                    {l.code === lang && <Check size={14} className="shrink-0" />}
                  </button>
                </li>
              ))}
            </ul>

            <p className="px-2.5 pt-3 pb-1 mt-1 border-t border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('Currency')}
            </p>
            <ul role="listbox" aria-label={t('Currency')}>
              {DEMO_CURRENCIES.map((c) => (
                <li key={c.code} role="option" aria-selected={c.code === currency}>
                  <button type="button" onClick={() => setCurrencyCode(c.code)} className={optionClass(c.code === currency)}>
                    <span className="font-mono-data w-10 shrink-0">{c.code}</span>
                    <span className="flex-1 truncate text-muted-foreground">{t(c.name)}</span>
                    {c.code === currency && <Check size={14} className="shrink-0" />}
                  </button>
                </li>
              ))}
            </ul>
            <p className="px-2.5 py-2 mt-1 border-t border-border text-[11px] leading-snug text-muted-foreground">
              {t(RATES_NOTE)}
            </p>
          </div>,
          document.body
        )}
    </>
  );
}
