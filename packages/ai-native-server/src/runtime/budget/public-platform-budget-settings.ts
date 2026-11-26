/** Public platform budget configuration on the original ledger. The actual
 * SaaS ingress supplies current read/manage authority; this is not dispatch. */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { PlatformPrincipalAuthority } from '@rental-os/platform-server/principal';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { AiExecutionContext } from '@rental-os/platform-contracts/ai-gateway';
import { beginPlatformAiManagementTransaction, createPlatformAiManagementTransactions } from '../../platform-transactions';
import type { AiCurrentScopeAuthority } from '../ai-scope.repository';
import { createPublicBudgetLedger, BudgetError } from './public-budget-ledger';
import { createPlatformBudgetSettings } from './platform-budget-settings.service';
import type { BudgetLedgerDatabase } from './prisma-budget-ledger.repository';

export function createPublicPlatformBudgetSettings(input: {
  db: BudgetLedgerDatabase & Pick<PrismaClient, 'aiProviderProfile' | '$queryRaw'>;
  /** Exact fixed platform Profile chosen from the host's original configuration. */
  profileId: string;
  authority: AiCurrentScopeAuthority & { resolveRead(): Promise<AiExecutionContext> };
  principalAuthority: Pick<PlatformPrincipalAuthority<Prisma.TransactionClient>, 'lock'>;
  assertDataAvailable(database: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<void>;
  clock?: () => Date;
}) {
  if (typeof input?.authority?.resolve !== 'function' || typeof input.authority.resolveRead !== 'function'
    || typeof input.assertDataAvailable !== 'function') throw new BudgetError('UNAVAILABLE');
  const { db, profileId, clock } = input;
  const participant = createPlatformAiManagementTransactions<Prisma.TransactionClient>({
    principalAuthority: input.principalAuthority, requiredPermission: 'system:ai-provider:manage',
    assertDataAvailable: input.assertDataAvailable
  });
  const resolve = async (write: boolean) => {
    const current = () => write ? input.authority.resolve() : input.authority.resolveRead();
    await current();
    await input.assertDataAvailable(db);
    return current();
  };
  return createPlatformBudgetSettings({ db, profileId, clock, requireOperationKey: true,
    authority: { resolve: () => resolve(true), resolveRead: () => resolve(false) }, repository: target => createPublicBudgetLedger({
      db, clock,
      ...(target ? { settingsTransactions: { async beginSettings(tx, key, settings, operation) {
        if (settings.scope.kind !== 'platform' || key.scopeKind !== 'PLATFORM' || key.scopeId !== target.scopeId
          || operation?.kind !== 'platform' || operation.actorId !== target.actorId || settings.config.configId !== profileId)
          throw new BudgetError('FORBIDDEN');
        const lease = await beginPlatformAiManagementTransaction(tx, target.actorId, participant);
        try {
          // The original model save takes its principal lock before the same
          // Profile. Hold both across the budget CAS and original operation row.
          const rows = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`
            SELECT id FROM ai_provider_profiles WHERE id = ${profileId} AND scopeId = ${target.scopeId}
              AND scopeKind = 'PLATFORM' AND serviceMode = 'platform_managed' FOR UPDATE`);
          if (rows.length !== 1 || rows[0].id !== profileId) throw new BudgetError('UNAVAILABLE');
          const config = settings.config, revalidate = async () => {
            const current = await tx.aiProviderProfile.findFirst({ where: { id: profileId, scopeId: target.scopeId,
              scopeKind: 'PLATFORM', serviceMode: 'platform_managed' } });
            if (!current || current.id !== profileId || current.scopeId !== target.scopeId || current.scopeKind !== 'PLATFORM'
              || current.serviceMode !== 'platform_managed' || current.configRevision !== config.configRevision
              || current.protocol !== config.protocol || current.provider !== config.provider || current.model !== config.model
              || current.credentialRef !== config.credentialRef) throw new BudgetError('REVISION_CONFLICT');
            await lease.revalidate();
          };
          await revalidate();
          return { revalidate, close: lease.close };
        } catch (error) { lease.close(); throw error; }
      } } } : {})
    })
  });
}
