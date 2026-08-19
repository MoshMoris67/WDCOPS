/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    container: {
      center: true,
      padding: '1rem',
    },
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        positive: 'var(--positive)',
        negative: 'var(--negative)',
        warning: 'var(--warning)',
        info: 'var(--info)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'calc(var(--radius) - 2px)',
        md: 'var(--radius)',
        lg: 'calc(var(--radius) + 4px)',
        xl: 'calc(var(--radius) + 8px)',
      },
      fontFamily: {
        sans: ['var(--font-ibm-plex-sans)', 'IBM Plex Sans', 'sans-serif'],
        mono: ['var(--font-ibm-plex-mono)', 'IBM Plex Mono', 'monospace'],
      },
      fontSize: {
        'page-title': ['1.5rem', { fontWeight: '600', lineHeight: '1.3' }],
        'section-header': ['1.125rem', { fontWeight: '600', lineHeight: '1.4' }],
        'card-label': ['0.8125rem', { fontWeight: '500', letterSpacing: '0.02em' }],
        'metric-value': ['2rem', { fontWeight: '700', lineHeight: '1' }],
        'table-cell': ['0.875rem', { fontWeight: '400' }],
      },
      boxShadow: {
        card: '0 2px 4px 0 rgba(16,24,40,0.05), 0 6px 16px -4px rgba(16,24,40,0.09)',
        'card-hover': '0 6px 14px -4px rgba(16,24,40,0.10), 0 14px 32px -8px rgba(16,24,40,0.16)',
        modal: '0 24px 70px -12px rgba(16,24,40,0.32)',
        dropdown: '0 8px 24px -4px rgba(16,24,40,0.14)',
      },
      animation: {
        'fade-in': 'fadeIn 200ms ease forwards',
        'slide-up': 'slideUp 200ms ease forwards',
        'pulse-highlight': 'pulseHighlight 600ms ease',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};