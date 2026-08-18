import Dexie, { type EntityTable } from 'dexie';

export interface PendingCallLog {
  localId?: number;
  debtorId: string;
  debtorName: string;
  dispositionCode: string;
  note: string | null;
  promisedAmount: number | null;
  promisedDate: string | null;
  queuedAt: string;
}

const db = new Dexie('wellcashops-offline') as Dexie & {
  pendingCallLogs: EntityTable<PendingCallLog, 'localId'>;
};

db.version(1).stores({
  pendingCallLogs: '++localId, debtorId, queuedAt',
});

export { db };
