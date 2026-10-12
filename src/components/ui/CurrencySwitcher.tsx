'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Banknote, Check, ChevronDown } from 'lucide-react';
import { DEPLOYMENT } from '@/config/deployment';
import { DEMO_CURRENCIES, RATES_NOTE } from '@/config/currencies';
import { setCurrencyCode, useCurrencyCode } from '@/lib/currency-store';

interface CurrencySwitcherProps {
  /** "row" matches the sidebar's ThemeToggle row; "pill" is a compact button for top bars. */
  variant?: 'row' | 'pill';
  collapsed?: boolean;
}

// Demo-only display-currency picker. Renders nothing on the Uganda system.
export default function CurrencySwitcher({
  variant = 'row',
  collapsed = false,
}: CurrencySwitcherProps) {
  const code = useCurrencyCode();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
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

  // Fixed positioning so the list is never clipped by the sidebar's or a panel's overflow.
  const toggle = () => {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      const width = 248;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const spaceBelow = window.innerHeight - r.bottom;
      setPos(
        spaceBelow > 360
          ? { position: 'fixed', top: r.bottom + 6, left, width }
          : { position: 'fixed', bottom: window.innerHeight - r.top + 6, left, width }
      );
    }
    setOpen(!open);
  };

  const choose = (next: string) => {
    setCurrencyCode(next);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const buttonClass =
    variant === 'row'
      ? `w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm font-medium text-secondary-foreground hover:bg-secondary transition-colors ${collapsed ? 'justify-center' : ''}`
      : 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-sm font-medium text-foreground hover:bg-secondary transition-colors';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Display currency: ${code}. Change currency`}
        title="Change display currency"
        className={buttonClass}
      >
        <Banknote size={16} className="shrink-0" />
        {variant === 'row' ? (
          !collapsed && (
            <>
              <span className="flex-1 text-left">Currency</span>
              <span className="font-mono-data text-xs text-muted-foreground">{code}</span>
            </>
          )
        ) : (
          <>
            <span className="font-mono-data">{code}</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </>
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={pos}
            className="z-[70] rounded-xl border border-border bg-card shadow-modal p-1.5"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Currency
            </p>
            <ul
              role="listbox"
              aria-label="Display currency"
              className="max-h-[min(24rem,60vh)] overflow-y-auto scrollbar-thin"
            >
              {DEMO_CURRENCIES.map((c) => (
                <li key={c.code} role="option" aria-selected={c.code === code}>
                  <button
                    type="button"
                    onClick={() => choose(c.code)}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left transition-colors hover:bg-secondary ${
                      c.code === code ? 'text-primary font-semibold' : 'text-foreground'
                    }`}
                  >
                    <span className="font-mono-data w-10 shrink-0">{c.code}</span>
                    <span className="flex-1 truncate text-muted-foreground">{c.name}</span>
                    {c.code === code && <Check size={14} className="shrink-0" />}
                  </button>
                </li>
              ))}
            </ul>
            <p className="px-2.5 py-2 mt-1 border-t border-border text-[11px] leading-snug text-muted-foreground">
              {RATES_NOTE}
            </p>
          </div>,
          document.body
        )}
    </>
  );
}
