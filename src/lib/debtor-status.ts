import type { CallLog } from '@prisma/client';

/** Derives queue-facing status fields from a debtor's call logs, newest first. */
export function computeDebtorStatus(callLogsDesc: CallLog[]) {
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
