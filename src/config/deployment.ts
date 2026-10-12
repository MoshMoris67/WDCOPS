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
  /** Sample rows on the login-page preview card. */
  previewDebtors: { name: string; balance: string; code: string; color: string }[];
  /** Placeholder examples in forms. */
  batchPlaceholder: string;
  debtorSearchPlaceholder: string;
  /** Explanation under the Branch card in Settings. */
  branchNote: string;
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
  previewDebtors: [
    { name: 'Nakato Josephine', balance: 'UGX 2.4M', code: 'PTP', color: '#16A34A' },
    { name: 'Mukasa Emmanuel', balance: 'UGX 1.2M', code: 'CB', color: '#1D4ED8' },
  ],
  batchPlaceholder: 'e.g. KCB-Aug-2026-Batch1',
  debtorSearchPlaceholder: 'e.g. Nakato Grace, or KCB-2024-0091',
  branchNote:
    'Every record carries this branch field from day one, per the requirements doc — Uganda is the only value in use today, but the schema is ready if WellcashOps is adopted by other country branches.',
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
  previewDebtors: [
    { name: 'Amina Hassan', balance: 'USD 2.4K', code: 'PTP', color: '#16A34A' },
    { name: 'Carlos Mabunda', balance: 'USD 1.2K', code: 'CB', color: '#1D4ED8' },
  ],
  batchPlaceholder: 'e.g. ClientA-Aug-2026-Batch1',
  debtorSearchPlaceholder: 'e.g. Amina Hassan, or LN-2026-000123',
  branchNote:
    'Every record carries this branch field, so one WellcashOps platform can serve several country branches side by side.',
};

export const DEPLOYMENT: Deployment = process.env.NEXT_PUBLIC_DEMO_MODE === 'true' ? DEMO : UGANDA;
