// Commission math for clients whose reconciliation files price a rate per aging bucket
// (currently just KCB Mopesa). Ported from a validated reference tool
// (wellcash-portfolio-dashboard-fixed.html) that already computes this correctly against
// real files — canonicalizeBucket below is close to a direct port of that tool's
// canonBucket(), adjusted for TypeScript and this app's bucket key naming.

import { prisma } from './db';

export type CanonicalBucket = 'B30' | 'B60' | 'B90' | 'B120' | 'WO';

export const BUCKET_ORDER: CanonicalBucket[] = ['B30', 'B60', 'B90', 'B120', 'WO'];

export const BUCKET_LABELS: Record<CanonicalBucket, string> = {
  B30: '30–59',
  B60: '60–89',
  B90: '90–120',
  B120: 'Above 120',
  WO: 'Written off',
};

// Fallback rates if a client hasn't configured CommissionRate rows for every bucket yet
// — matches the reference tool's own fallbacks and the rates the client stated directly:
// 30-59 → 4%, 60-89 → 7%, 90-120 → 9%, Above 120 / Written off → 10%.
export const DEFAULT_RATES: Record<CanonicalBucket, number> = {
  B30: 0.04,
  B60: 0.07,
  B90: 0.09,
  B120: 0.10,
  WO: 0.10,
};

/**
 * Maps a raw sheet/bucket label (as it actually appears in a client's file — "30-59",
 * "Before 90", "Above 120", "WO", etc.) to a canonical bucket key. Returns null for
 * anything unrecognized rather than guessing, so an admin can see it wasn't priced
 * rather than have it silently mispriced.
 *
 * "Before N" sheets are a client quirk seen in real KCB Mopesa files — a sub-listing of
 * loans about to cross into (or that just crossed into) a band, which duplicate-lists
 * some loans already present under their current band. Per the client's own commission
 * table, "Before 90" prices at the SAME rate as "60-89" (7%) and "Before 120" at the same
 * rate as "90-120" (9%) — i.e. "before N" belongs to the band ending at N, not the band
 * that starts at N. That's what the n<=60/n<=90/n<=120 thresholds below encode.
 */
export function canonicalizeBucket(raw: string | null | undefined): CanonicalBucket | null {
  if (!raw) return null;
  const upper = raw.toUpperCase().trim();
  const key = upper.replace(/[^A-Z0-9]/g, '');
  if (!key) return null;

  if (/WRITTENOFF|WRITEOFF|WRITEOFFS|^WO$|^WOFF$|^WRITTEN$/.test(key)) return 'WO';

  // Open-ended top band: "Above 120", "Over 120", "120+", ">120".
  if (
    /^(?:ABOVE|OVER|MORETHAN|GREATERTHAN|OLDERTHAN)\d+$/.test(key) ||
    /^\d+(?:PLUS|ANDABOVE|ANDOVER)$/.test(key) ||
    /^(?:>|>=)\s*\d+$/.test(upper) ||
    /^\d+\s*\+$/.test(upper)
  ) {
    return 'B120';
  }

  // "Before N" / "Up to N" / "Less than N" style — N is the upper edge of the band the
  // sheet is a preview of, so it belongs to whichever band ENDS at N.
  const beforeMatch = key.match(/^(?:BEFORE|UPTO|LESSTHAN|UNDER|BELOW|WITHIN)(\d+)$/);
  if (beforeMatch) {
    const n = Number(beforeMatch[1]);
    if (n <= 60) return 'B30';
    if (n <= 90) return 'B60';
    if (n <= 120) return 'B90';
    return 'B120';
  }

  // Explicit range: "30-59", "60 to 89", "90–120".
  const rangeMatch = upper.match(/(\d{1,3})\s*(?:-|–|—|TO|\/|–)\s*(\d{1,3})/);
  if (rangeMatch) {
    const lo = Number(rangeMatch[1]);
    if (lo >= 120) return 'B120';
    if (lo >= 90) return 'B90';
    if (lo >= 60) return 'B60';
    if (lo >= 30) return 'B30';
  }

  return null;
}

export interface ClientCommissionConfig {
  rateByBucket: Map<CanonicalBucket, number>;
  agentShare: number;
}

/**
 * Whether commission tracking is "on" for a client is decided entirely by whether they
 * have any CommissionRate rows at all (see Admin Settings) — zero rows means null here,
 * and every caller treats null as "skip commission math, behave exactly as before this
 * feature existed." A client with SOME but not all five buckets configured gets
 * DEFAULT_RATES filled in for the rest, same as the reference dashboard's own fallback —
 * lets an admin start tracking before every bucket's rate is confirmed.
 */
export async function loadClientCommissionConfig(clientId: string): Promise<ClientCommissionConfig | null> {
  const [client, rates] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { agentCommissionShare: true } }),
    prisma.commissionRate.findMany({ where: { clientId } }),
  ]);
  if (!client || rates.length === 0) return null;

  const rateByBucket = new Map<CanonicalBucket, number>();
  for (const bucket of BUCKET_ORDER) rateByBucket.set(bucket, DEFAULT_RATES[bucket]);
  for (const r of rates) {
    if (BUCKET_ORDER.includes(r.bucket as CanonicalBucket)) {
      rateByBucket.set(r.bucket as CanonicalBucket, r.rate);
    }
  }

  return { rateByBucket, agentShare: client.agentCommissionShare };
}

/** Prices one row's collected amount at its bucket's rate, and splits agent credit —
 * shared by both processReconciliationTick and processReconciliation (lib/reconciliation.ts)
 * so the two never compute this differently. Returns all-null when there's no config, no
 * bucket on the row, or the row's bucket doesn't canonicalize to anything recognized —
 * callers store these directly on ReconciliationEntry without further branching. */
export function priceRow(
  config: ClientCommissionConfig | null,
  bucketRaw: string | null,
  paidAmount: number,
  hasAssignedAgent: boolean
): { bucket: CanonicalBucket | null; companyCommission: number | null; agentCommission: number | null } {
  if (!config || !bucketRaw) return { bucket: null, companyCommission: null, agentCommission: null };
  const bucket = canonicalizeBucket(bucketRaw);
  if (!bucket) return { bucket: null, companyCommission: null, agentCommission: null };

  const rate = config.rateByBucket.get(bucket) ?? DEFAULT_RATES[bucket];
  const companyCommission = paidAmount * rate;
  const agentCommission = hasAssignedAgent ? companyCommission * config.agentShare : null;
  return { bucket, companyCommission, agentCommission };
}
