export const BALANCE_BANDS = [
  { key: 'band0_500k', label: '≤ 500K' },
  { key: 'band500k_2m', label: '500K–2M' },
  { key: 'band2m_5m', label: '2M–5M' },
  { key: 'band5m_plus', label: '5M+' },
] as const;

export type BandKey = (typeof BALANCE_BANDS)[number]['key'];

export function bandForBalance(balance: number): BandKey {
  if (balance <= 500_000) return 'band0_500k';
  if (balance <= 2_000_000) return 'band500k_2m';
  if (balance <= 5_000_000) return 'band2m_5m';
  return 'band5m_plus';
}

/**
 * Splits debtors into balance bands, then round-robins each band across the
 * agent list independently — so every agent gets a comparable mix of easier
 * and harder accounts (§8), not just an even total count.
 */
export function assignByBalanceBand<T extends { id: string; balance: number }>(
  debtors: T[],
  agentIds: string[]
): Map<string, string> {
  const assignment = new Map<string, string>();
  if (agentIds.length === 0) return assignment;

  const byBand = new Map<BandKey, T[]>();
  for (const band of BALANCE_BANDS) byBand.set(band.key, []);
  for (const debtor of debtors) byBand.get(bandForBalance(debtor.balance))!.push(debtor);

  for (const band of BALANCE_BANDS) {
    const bandDebtors = byBand.get(band.key)!;
    bandDebtors.forEach((debtor, i) => {
      assignment.set(debtor.id, agentIds[i % agentIds.length]);
    });
  }

  return assignment;
}

/**
 * Smooth weighted round-robin (the same balancing algorithm load balancers use):
 * each debtor goes to whichever agent has accrued the most "credit" so far, where
 * credit accrues by the agent's weight every tick and is spent on assignment. Over
 * many picks each agent's share converges to their weight's share of the total, so
 * a low-coverage agent (light weight) reliably gets fewer of the new accounts than
 * a caught-up one — without ever hitting exactly zero. Debtors are still
 * interleaved by balance band first, so nobody's "share" is just N accounts that
 * all happen to be the hardest ones.
 */
export function assignByCoverageWeight<T extends { id: string; balance: number }>(
  debtors: T[],
  agents: { id: string; weight: number }[]
): Map<string, string> {
  const assignment = new Map<string, string>();
  if (agents.length === 0 || debtors.length === 0) return assignment;

  const byBand = new Map<BandKey, T[]>();
  for (const band of BALANCE_BANDS) byBand.set(band.key, []);
  for (const debtor of debtors) byBand.get(bandForBalance(debtor.balance))!.push(debtor);

  const order: T[] = [];
  let more = true;
  while (more) {
    more = false;
    for (const band of BALANCE_BANDS) {
      const bucket = byBand.get(band.key)!;
      if (bucket.length > 0) {
        order.push(bucket.shift()!);
        more = true;
      }
    }
  }

  const totalWeight = agents.reduce((s, a) => s + a.weight, 0);
  const credit = new Map(agents.map((a) => [a.id, 0]));
  for (const debtor of order) {
    for (const a of agents) credit.set(a.id, credit.get(a.id)! + a.weight);
    let bestId = agents[0].id;
    let bestCredit = -Infinity;
    for (const a of agents) {
      const c = credit.get(a.id)!;
      if (c > bestCredit) {
        bestCredit = c;
        bestId = a.id;
      }
    }
    assignment.set(debtor.id, bestId);
    credit.set(bestId, credit.get(bestId)! - totalWeight);
  }

  return assignment;
}
