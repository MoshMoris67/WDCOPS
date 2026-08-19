import React from 'react';
import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import '../styles/tailwind.css';
import { Toaster } from 'sonner';

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1D4ED8',
};

export const metadata: Metadata = {
  title: 'WellcashOps',
  description: 'Centralized debt collections platform for Wellcash Uganda — offline-first agent queue management, live admin oversight dashboard, and automated client reporting.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', type: 'image/x-icon' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'WellcashOps',
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
      <head>
        {/* Runs before paint, before hydration — sets the dark class from the saved
            preference so there's no flash of the wrong theme on load. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try { if (localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark'); } catch (e) {}`,
          }}
        />
        {/* Registers the (deliberately no-op) service worker — required by some
            browsers before they'll offer the install prompt. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); }); }`,
          }}
        />
      </head>
      <body className={ibmPlexSans.className}>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 3000,
            style: {
              fontFamily: 'var(--font-ibm-plex-sans)',
              fontSize: '0.875rem',
            },
          }}
        />
</body>
    </html>
  );
}