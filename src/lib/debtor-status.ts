import type { CallLog } from '@prisma/client';

type CallLogStatusFields = Pick<CallLog, 'dispositionCode' | 'createdAt' | 'promisedAmount' | 'promisedDate'>;

/** Derives queue-facing status fields from a debtor's call logs, newest first. Takes just
 *  the fields it actually needs (not the full CallLog row) so callers that fetch a lighter,
 *  DB-aggregated shape for many debtors at once (see debtor-aggregates.ts) can use this too. */
export function computeDebtorStatus(callLogsDesc: CallLogStatusFields[]) {
  const latest = callLogsDesc[0] ?? null;

  let naCount = 0;
  for (const log of callLogsDesc) {
    if (log.dispositionCode === 'NA') naCount++;
    else break;
  }

  const isPTP = latest?.dispositionCode === 'PTP';

  return {
    lastDisposition: latest?.dispositionCode ?? null,
    lastCallDate: latest?.createdAt ?? null,
    naCount,
    isStale: naCount >= 5,
    isPTP,
    activePTP: isPTP && latest ? { amount: latest.promisedAmount, date: latest.promisedDate } : null,
  };
}
