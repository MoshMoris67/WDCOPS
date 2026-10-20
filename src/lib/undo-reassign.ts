import { Prisma } from '@prisma/client';
import { prisma } from './db';

interface UndoCandidate {
  assignmentId: string;
  debtorId: string;
  newAgentId: string | null;
  newAgentName: string | null;
  newAgentEmail: string | null;
  oldAgentId: string | null;
  oldAgentName: string | null;
  oldAgentEmail: string | null;
}

export interface UndoReassignmentResult {
  restoredCount: number;
  skippedCount: number;
}

export class UndoReassignmentError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409
  ) {
    super(message);
  }
}

export async function undoReassignment(
  fileId: string,
  batchId: string
): Promise<UndoReassignmentResult> {
  return prisma.$transaction(
    async (tx) => {
      const files = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "File"
      WHERE "id" = ${fileId} AND "isRecalled" = true
      FOR UPDATE
    `);
      if (files.length === 0)
        throw new UndoReassignmentError('Recall the file before undoing its redistribution', 400);

      const batches = await tx.$queryRaw<{ id: string; undoneAt: Date | null }[]>(Prisma.sql`
      SELECT "id", "undoneAt"
      FROM "ReassignmentBatch"
      WHERE "id" = ${batchId} AND "fileId" = ${fileId}
      FOR UPDATE
    `);
      const batch = batches[0];
      if (!batch) throw new UndoReassignmentError('Redistribution history not found', 404);
      if (batch.undoneAt)
        throw new UndoReassignmentError('This redistribution has already been undone', 409);

      const candidates = await tx.$queryRaw<UndoCandidate[]>(Prisma.sql`
      SELECT
        a."id" AS "assignmentId",
        a."debtorId" AS "debtorId",
        a."agentId" AS "newAgentId",
        a."agentName" AS "newAgentName",
        a."agentEmail" AS "newAgentEmail",
        a."reassignedFromId" AS "oldAgentId",
        a."reassignedFromName" AS "oldAgentName",
        a."reassignedFromEmail" AS "oldAgentEmail"
      FROM "Assignment" a
      JOIN "Debtor" d ON d."id" = a."debtorId"
      WHERE a."reassignmentBatchId" = ${batch.id}
        AND d."fileId" = ${fileId}
        AND d."assignedAgentId" IS NOT DISTINCT FROM a."agentId"
        AND (
          a."reassignedFromId" IS NULL
          OR EXISTS (SELECT 1 FROM "User" old_user WHERE old_user."id" = a."reassignedFromId")
        )
      FOR UPDATE OF d
    `);

      const candidateIds = candidates.map((candidate) => candidate.assignmentId);
      const assignmentsWithLaterHistory = candidateIds.length
        ? await tx.$queryRaw<{ assignmentId: string }[]>(Prisma.sql`
          SELECT original."id" AS "assignmentId"
          FROM "Assignment" original
          WHERE original."id" = ANY(${candidateIds}::text[])
            AND EXISTS (
              SELECT 1
              FROM "Assignment" later
              WHERE later."debtorId" = original."debtorId"
                AND later."assignedAt" > original."assignedAt"
                AND NOT EXISTS (
                  SELECT 1
                  FROM "ReassignmentBatch" later_batch
                  WHERE later_batch."id" = later."reassignmentBatchId"
                    AND later_batch."undoneAt" IS NOT NULL
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM "Assignment" reversed
                  JOIN "ReassignmentBatch" reversed_batch
                    ON reversed_batch."id" = reversed."reassignmentBatchId"
                  WHERE reversed."id" = later."reversesAssignmentId"
                    AND reversed_batch."undoneAt" IS NOT NULL
                )
            )
        `)
        : [];
      const laterHistoryIds = new Set(assignmentsWithLaterHistory.map((row) => row.assignmentId));
      const restorableCandidates = candidates.filter(
        (candidate) => !laterHistoryIds.has(candidate.assignmentId)
      );

      const updatesByPair = new Map<string, UndoCandidate[]>();
      for (const candidate of restorableCandidates) {
        const key = `${candidate.newAgentId}\0${candidate.oldAgentId ?? ''}`;
        const group = updatesByPair.get(key) ?? [];
        group.push(candidate);
        updatesByPair.set(key, group);
      }

      let updatedCount = 0;
      for (const group of updatesByPair.values()) {
        const first = group[0];
        for (let offset = 0; offset < group.length; offset += 1000) {
          const chunk = group.slice(offset, offset + 1000);
          const result = await tx.debtor.updateMany({
            where: {
              id: { in: chunk.map((row) => row.debtorId) },
              assignedAgentId: first.newAgentId,
            },
            data: { assignedAgentId: first.oldAgentId },
          });
          updatedCount += result.count;
          if (result.count !== chunk.length)
            throw new Error(
              'Assignments changed while undo was running; no changes were committed'
            );
        }
      }

      for (let offset = 0; offset < restorableCandidates.length; offset += 1000) {
        const chunk = restorableCandidates.slice(offset, offset + 1000);
        await tx.assignment.createMany({
          data: chunk.map((candidate) => ({
            debtorId: candidate.debtorId,
            agentId: candidate.oldAgentId,
            agentName: candidate.oldAgentName,
            agentEmail: candidate.oldAgentEmail,
            reassignedFromId: candidate.newAgentId,
            reassignedFromName: candidate.newAgentName,
            reassignedFromEmail: candidate.newAgentEmail,
            reversesAssignmentId: candidate.assignmentId,
          })),
        });
      }

      await tx.reassignmentBatch.update({
        where: { id: batch.id },
        data: { undoneAt: new Date() },
      });

      const totalCount = await tx.assignment.count({ where: { reassignmentBatchId: batch.id } });
      return {
        restoredCount: updatedCount,
        skippedCount: totalCount - updatedCount,
      };
    },
    { timeout: 60_000 }
  );
}
