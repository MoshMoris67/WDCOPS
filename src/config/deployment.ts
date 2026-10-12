// Per-deployment settings. One codebase serves both the real Uganda system and the
// neutral demo; which one you get is decided by a single build-time variable.
//
//   NEXT_PUBLIC_DEMO_MODE=true  -> the neutral demo (no country-specific text, USD amounts)
//   anything else / unset       -> the Uganda system, exactly as it behaved before this file existed
//
// NEXT_PUBLIC_* values are baked into the build, so set the variable BEFORE building
// (on Render: Environment tab, then redeploy). The office server never sets it.

interface Deployment {
  demo: boolean;
  /** Shown wherever the UI names the branch ("Uganda Branch", "System configuration for the ..."). */
  branchName: string;
  /** Stored on records created without an explicit branch (see prisma/seed-demo.js for the demo DB). */
  branchCode: string;
  currencyCode: string;
  /** Locale used for number and date formatting. */
  locale: string;
  /** Business time zone offset from UTC in hours — drives "start of this month" (lib/new-month.ts). */
  utcOffsetHours: number;
  /** IANA zone for the login-page clock; undefined = the visitor's own time zone. */
  timeZone: string | undefined;
  /** Label next to the login-page clock and on report schedules (e.g. "Kampala", "EAT"). */
  clockLabel: string;
  zoneAbbrev: string;
  emailPlaceholder: string;
  appDescription: string;
  /** Login-page marketing copy. */
  loginTagline: [string, string, string];
  loginBlurb: string;
  /** Small print under the login page's feature list. */
  loginFooter: string;
  /** Notice box under the sign-in button. */
  loginDataNote: string;
  /** Sample rows on the login-page preview card (amounts in the deployment's base currency). */
  previewDebtors: { name: string; amount: number; code: string; color: string }[];
  /** Placeholder examples in forms. */
  batchPlaceholder: string;
  debtorSearchPlaceholder: string;
  /** Balance thresholds (in the base currency) that split debtors into 4 bands for fair distribution. */
  balanceBands: [number, number, number];
  /** Explanation under the Branch card in Settings. */
  branchNote: string;
  /** Settings > Hosting card (shown instead of the standard hosting note when set). */
  hostingNote: string | null;
  /** Settings > commission rates: which client the aging-bucket commission applies to. */
  commissionClientHint: string;
  clientNamePlaceholder: string;
}

const UGANDA: Deployment = {
  demo: false,
  branchName: 'Uganda',
  branchCode: 'uganda',
  currencyCode: 'UGX',
  locale: 'en-UG',
  utcOffsetHours: 3,
  timeZone: 'Africa/Kampala',
  clockLabel: 'Kampala',
  zoneAbbrev: 'EAT',
  emailPlaceholder: 'yourname@wellcash.ug',
  appDescription:
    'Centralized debt collections platform for Wellcash Uganda — offline-first agent queue management, live admin oversight dashboard, and automated client reporting.',
  loginTagline: ['Every call logged.', 'Every shilling tracked.', 'One system.'],
  loginBlurb:
    'Replaces the Excel-and-OneDrive workflow with one offline-first platform, purpose-built for the Uganda branch — and ready to extend to any Wellcash country branch next.',
  loginFooter: 'Hosted internally · No client data leaves Wellcash infrastructure',
  loginDataNote:
    'Data stays on Wellcash infrastructure. Once signed in, the app keeps working offline — call logs sync when you reconnect.',
  previewDebtors: [
    { name: 'Nakato Josephine', amount: 2400000, code: 'PTP', color: '#16A34A' },
    { name: 'Mukasa Emmanuel', amount: 1200000, code: 'CB', color: '#1D4ED8' },
  ],
  batchPlaceholder: 'e.g. KCB-Aug-2026-Batch1',
  debtorSearchPlaceholder: 'e.g. Nakato Grace, or KCB-2024-0091',
  balanceBands: [500_000, 2_000_000, 5_000_000],
  branchNote:
    'Every record carries this branch field from day one, per the requirements doc — Uganda is the only value in use today, but the schema is ready if WellcashOps is adopted by other country branches.',
  hostingNote: null,
  commissionClientHint: '(currently KCB Mopesa)',
  clientNamePlaceholder: 'e.g. Airtel',
};

const DEMO: Deployment = {
  demo: true,
  branchName: 'Demo',
  branchCode: 'demo',
  currencyCode: 'USD',
  locale: 'en-US',
  utcOffsetHours: 0,
  timeZone: undefined,
  clockLabel: 'Local time',
  zoneAbbrev: 'UTC',
  emailPlaceholder: 'yourname@demo.wellcash.com',
  appDescription:
    'Centralized debt collections platform for Wellcash — offline-first agent queue management, live admin oversight dashboard, and automated client reporting.',
  loginTagline: ['Every call logged.', 'Every payment tracked.', 'One system.'],
  loginBlurb:
    'Replaces the Excel-and-OneDrive workflow with one offline-first platform, built to run any Wellcash country branch.',
  loginFooter: 'Demo environment · All data shown is fictional',
  loginDataNote:
    'Demo environment — all data shown is fictional. Once signed in, the app keeps working offline — call logs sync when you reconnect.',
  previewDebtors: [
    { name: 'Amina Hassan', amount: 2400, code: 'PTP', color: '#16A34A' },
    { name: 'Carlos Mabunda', amount: 1200, code: 'CB', color: '#1D4ED8' },
  ],
  batchPlaceholder: 'e.g. ClientA-Aug-2026-Batch1',
  debtorSearchPlaceholder: 'e.g. Amina Hassan, or LN-2026-000123',
  balanceBands: [150, 600, 1_500],
  branchNote:
    'Every record carries this branch field, so one WellcashOps platform can serve several country branches side by side.',
  hostingNote:
    'This demo runs on a hosted test environment and holds fictional data only. A production deployment keeps client data on a self-hosted PostgreSQL instance.',
  commissionClientHint: '(in this demo, Savanna Bank)',
  clientNamePlaceholder: 'e.g. Northwind Microfinance',
};

export const DEPLOYMENT: Deployment = process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ? DEMO : UGANDA;
