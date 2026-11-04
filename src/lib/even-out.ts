import { prisma } from './db';
import { writeAssignment } from './assignment';
import { bandForBalance, BALANCE_BANDS, type BandKey } from './distribution';

export interface EvenOutDebtor {
  id: string;
  balance: number;
  assignedAgentId: string;
  called: boolean;
  paid: boolean;
}

export interface EvenOutMove {
  debtorId: string;
  fromAgentId: string;
  toAgentId: string;
}

export interface EvenOutPlan {
  moves: EvenOutMove[];
  before: Map<string, number>;
  after: Map<string, number>;
  targets: Map<string, number>;
  /** Total headcount still above target because the surplus agents had nothing safe left to give. */
  shortfall: number;
}

/**
 * Plans the moves that level a file's per-agent headcount across the agents who already
 * hold debtors on it. Pure — no database access — so it can be dry-run and tested.
 *
 * Same safety rules as rebalanceFileForNewAgent: a debtor with any payment recorded is never
 * moved; never-called accounts go first, then called-but-uncollected ones. Within a donor the
 * movable accounts are interleaved by balance band, so what a receiver picks up is a mix of
 * bands rather than one donor's easiest or hardest accounts.
 */
export function planEvenOut(debtors: EvenOutDebtor[]): EvenOutPlan {
  const before = new Map<string, number>();
  for (const d of debtors) before.set(d.assignedAgentId, (before.get(d.assignedAgentId) ?? 0) + 1);

  const agentIds = [...before.keys()];
  const targets = new Map<string, number>();
  const after = new Map(before);
  const moves: EvenOutMove[] = [];
  if (agentIds.length < 2) {
    for (const id of agentIds) targets.set(id, before.get(id)!);
    return { moves, before, after, targets, shortfall: 0 };
  }

  // floor(total / n) each; the remainder's +1 goes to whoever already holds the most, so the
  // fewest accounts have to move.
  const base = Math.floor(debtors.length / agentIds.length);
  const remainder = debtors.length - base * agentIds.length;
  [...agentIds]
    .sort((a, b) => before.get(b)! - before.get(a)!)
    .forEach((id, i) => targets.set(id, base + (i < remainder ? 1 : 0)));

  // Per donor: never-called pool, then called-unpaid pool, each interleaved by band.
  const pools = new Map<string, { never: EvenOutDebtor[]; unpaid: EvenOutDebtor[] }>();
  for (const id of agentIds) pools.set(id, { never: [], unpaid: [] });
  for (const d of debtors) {
    if (d.paid) continue;
    pools.get(d.assignedAgentId)![d.called ? 'unpaid' : 'never'].push(d);
  }
  const interleave = (list: EvenOutDebtor[]): EvenOutDebtor[] => {
    const byBand = new Map<BandKey, EvenOutDebtor[]>();
    for (const b of BALANCE_BANDS) byBand.set(b.key, []);
    for (const d of list) byBand.get(bandForBalance(d.balance))!.push(d);
    const out: EvenOutDebtor[] = [];
    let more = true;
    while (more) {
      more = false;
      for (const b of BALANCE_BANDS) {
        const bucket = byBand.get(b.key)!;
        if (bucket.length > 0) {
          out.push(bucket.shift()!);
          more = true;
        }
      }
    }
    return out.reverse(); // pop() takes from the end
  };
  for (const p of pools.values()) {
    p.never = interleave(p.never);
    p.unpaid = interleave(p.unpaid);
  }

  const surplus = (id: string) => after.get(id)! - targets.get(id)!;
  for (;;) {
    let receiver: string | null = null;
    for (const id of agentIds) if (surplus(id) < 0 && (!receiver || surplus(id) < surplus(receiver))) receiver = id;
    if (!receiver) break;

    let donor: string | null = null;
    for (const id of agentIds) {
      const p = pools.get(id)!;
      if (surplus(id) > 0 && p.never.length + p.unpaid.length > 0 && (!donor || surplus(id) > surplus(donor))) donor = id;
    }
    if (!donor) break; // nobody above target has anything safe left to move

    const p = pools.get(donor)!;
    const debtor = p.never.length > 0 ? p.never.pop()! : p.unpaid.pop()!;
    moves.push({ debtorId: debtor.id, fromAgentId: donor, toAgentId: receiver });
    after.set(donor, after.get(donor)! - 1);
    after.set(receiver, after.get(receiver)! + 1);
  }

  const shortfall = agentIds.reduce((s, id) => s + Math.max(0, surplus(id)), 0);
  return { moves, before, after, targets, shortfall };
}

export async function loadEvenOutDebtors(fileId: string): Promise<EvenOutDebtor[]> {
  const rows = await prisma.debtor.findMany({
    where: { fileId, assignedAgentId: { not: null } },
    select: { id: true, balance: true, assignedAgentId: true, cumulativePaid: true, callLogs: { select: { id: true }, take: 1 } },
  });
  return rows.map((r) => ({
    id: r.id,
    balance: r.balance,
    assignedAgentId: r.assignedAgentId!,
    called: r.callLogs.length > 0,
    paid: r.cumulativePaid > 0,
  }));
}

/**
 * Applies a plan as one ReassignmentBatch, so it shows up in the file's redistribution
 * history and can be undone the same way as a roster change (lib/undo-reassign.ts).
 */
export async function applyEvenOut(fileId: string, moves: EvenOutMove[]): Promise<string | null> {
  if (moves.length === 0) return null;
  const assignment = new Map(moves.map((m) => [m.debtorId, m.toAgentId]));
  const reassignedFrom = new Map<string, string | null>(moves.map((m) => [m.debtorId, m.fromAgentId]));
  return prisma.$transaction(
    async (tx) => {
      const batch = await tx.reassignmentBatch.create({ data: { fileId } });
      await writeAssignment(tx, assignment, reassignedFrom, batch.id);
      return batch.id;
    },
    { timeout: 120_000 }
  );
}
