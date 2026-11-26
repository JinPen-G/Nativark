/** Public credit decisions reuse the original credit rows. Only the current
 * platform principal and server-held target may participate in the write. */
import { HttpException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AiCreditRequest } from '@rental-os/platform-contracts/ai-finance';
import type { PlatformPrincipalAuthority } from '@rental-os/platform-server/principal';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { beginPlatformAiManagementTransaction, createPlatformAiManagementTransactions } from '../../platform-transactions';
import { PLATFORM_AI_MODEL_MANAGE } from '../../configuration/platform-model-settings-policy';
import { decidePlatformCredit, decisionSchema, fail, platformCreditQueueInput, platformCreditReceiptInput,
  readPlatformCreditQueue, readPlatformCreditReceipt, type AiCreditDecisionTarget } from './platform-credit-administration';

export function createPublicPlatformCredit(input: {
  db: Pick<PrismaClient, '$transaction' | 'aiTenantAiCreditRequest'>;
  actorId: string;
  recheck(): Promise<void>;
  principals: Pick<PlatformPrincipalAuthority<Prisma.TransactionClient>, 'lock'>;
  assertDataAvailable(db: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<void>;
}) {
  const { db, actorId, recheck } = input;
  async function write(work: (tx: Prisma.TransactionClient) => Promise<AiCreditRequest>, target: AiCreditDecisionTarget) {
    const participant = createPlatformAiManagementTransactions<Prisma.TransactionClient>({
      principalAuthority: input.principals, requiredPermission: PLATFORM_AI_MODEL_MANAGE,
      targetTenantId: target.tenantId, assertDataAvailable: input.assertDataAvailable
    });
    let completed = false;
    try {
      return await db.$transaction(async tx => {
        const lease = await beginPlatformAiManagementTransaction(tx, actorId, participant);
        try {
          const result = await work(tx);
          if (target.enabling) {
            // The same principal lease already holds both Tenant parents in
            // order. An old decision is readable even if its target is frozen.
            const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>(prismaRuntime.sql`
              SELECT id, status FROM Tenant WHERE id = ${target.tenantId} FOR UPDATE`);
            if (rows.length !== 1 || rows[0].id !== target.tenantId || rows[0].status.toLowerCase() !== 'active')
              fail('AI_ACCESS_DENIED', 403);
          }
          await recheck();
          await lease.revalidate();
          completed = true;
          return result;
        } finally { lease.close(); }
      }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (!completed && error instanceof HttpException) throw error;
      if (!completed && error instanceof Error && 'code' in error && error.code === 'FORBIDDEN') fail('AI_ACCESS_DENIED', 403);
      fail('AI_RESULT_UNKNOWN');
    }
  }

  return {
    read: (command: unknown) => readPlatformCreditQueue(db, platformCreditQueueInput.parse(command)),
    receipt: (command: unknown) => readPlatformCreditReceipt(db, actorId, platformCreditReceiptInput.parse(command)),
    decide: (command: unknown) => decidePlatformCredit(db, actorId, decisionSchema.parse(command), recheck, write)
  };
}
