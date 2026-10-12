'use client';

import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/lib/use-theme';
import { t } from '@/i18n';

interface ThemeToggleProps {
  collapsed?: boolean;
}

export default function ThemeToggle({ collapsed }: ThemeToggleProps) {
  const [theme, toggle] = useTheme();

  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? t('Switch to light mode') : t('Switch to dark mode')}
      className={`w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm font-medium text-secondary-foreground hover:bg-secondary transition-colors ${collapsed ? 'justify-center' : ''}`}
    >
      {theme === 'dark' ? <Sun size={16} className="shrink-0" /> : <Moon size={16} className="shrink-0" />}
      {!collapsed && <span className="flex-1 text-left">{theme === 'dark' ? t('Light mode') : t('Dark mode')}</span>}
    </button>
  );
}
