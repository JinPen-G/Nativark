/** Public persisted model configuration. Reuses the original encrypted settings,
 * Profile CAS and operation receipts; the host supplies current action authority
 * and an explicit same-transaction participant. No HTTP or model dispatch starts. */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { SecretBox } from '@rental-os/platform-server/secret-box';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { ModelGatewayError } from '@rental-os/platform-server/ai-gateway';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AiScopeRepository, type AiCurrentScopeAuthority } from './runtime/ai-scope.repository';
import { aiPersistenceScopeColumns } from './runtime/persistence-scope';
import { AiModelConfigurationResultUnknownError } from './runtime/model-config-compatibility';
import { TenantModelConfigService, type TenantModelConfigPorts } from './runtime/tenant-model-config.service';
import { PrismaTenantModelProfileRepository } from './configuration/tenant-model-profile.repository';
import { PrismaPlatformModelConnection, type PlatformConnectionAuthority } from './configuration/platform-model-connection';
import { beginTenantConfigurationTransaction, type TenantConfigurationContext,
  type TenantConfigurationTransactionParticipant, type AiConfigurationTransactionLease } from './tenant-configuration-transactions';
import { beginPlatformAiManagementTransaction, type PlatformAiManagementTransactionParticipant } from './platform-transactions';

export type { TenantConfigurationContext, TenantConfigurationTransactionParticipant } from './tenant-configuration-transactions';
export type { TenantModelConfigPorts } from './runtime/tenant-model-config.service';
export type { PlatformConnectionAuthority } from './configuration/platform-model-connection';

type ScopeDatabase = Pick<PrismaClient, '$transaction' | 'aiScope'>;
async function registerScope(db: ScopeDatabase, columns: ReturnType<typeof aiPersistenceScopeColumns>,
  begin: (transaction: Prisma.TransactionClient) => Promise<AiConfigurationTransactionLease>, current: () => Promise<void>) {
  await current();
  let callbackCompleted = false;
  try {
    await db.$transaction(async transaction => {
      const lease = await begin(transaction);
      try {
        const row = await transaction.aiScope.upsert({ where: { scopeKey: columns.scopeKey },
          create: { id: randomUUID(), ...columns }, update: {},
          select: { id: true, kind: true, scopeKey: true, tenantId: true, workspaceId: true } });
        if (!row || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(row.id)
          || Object.entries(columns).some(([key, value]) => row[key as keyof typeof row] !== value))
          throw new ModelGatewayError('FORBIDDEN');
        await current();
        await lease.revalidate();
        callbackCompleted = true;
      } finally { lease.close(); }
    }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    await current();
  } catch (error) {
    if (callbackCompleted) throw new AiModelConfigurationResultUnknownError();
    throw error;
  }
}

export function createPublicTenantModelConfiguration<Context extends TenantConfigurationContext>(input: {
  db: ConstructorParameters<typeof PrismaTenantModelProfileRepository>[0] & ScopeDatabase;
  authorize: TenantModelConfigPorts<Context>['authorize'];
  secrets: SecretBox;
  transactionParticipant: TenantConfigurationTransactionParticipant<Prisma.TransactionClient, Context>;
}) {
  if (typeof input?.authorize !== 'function' || typeof input.transactionParticipant?.begin !== 'function')
    throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
  const begin = (transaction: Prisma.TransactionClient, context: Context) =>
    beginTenantConfigurationTransaction(transaction, context, input.transactionParticipant);
  const configuration = new TenantModelConfigService<Context>({ authorize: input.authorize,
    repository: new PrismaTenantModelProfileRepository<Context>(input.db, input.authorize, begin) }, input.secrets);
  return Object.freeze({ configuration, async registerScope(value: Context) {
    const context = Object.freeze(structuredClone(value));
    const current = () => input.authorize(context, 'manage');
    // Configuration belongs to the tenant. A Core's workspace scope registration
    // stays in that Core's existing admission path and cannot be fabricated here.
    await registerScope(input.db, aiPersistenceScopeColumns({ kind: 'tenant', tenantId: context.tenantId }),
      transaction => begin(transaction, context), current);
  } });
}

export function createPublicPlatformModelConfiguration(input: {
  db: ConstructorParameters<typeof PrismaPlatformModelConnection>[0] & ScopeDatabase;
  authority: PlatformConnectionAuthority & AiCurrentScopeAuthority & { resolveRead(): ReturnType<AiCurrentScopeAuthority['resolve']> };
  secrets: SecretBox;
  transactionParticipant: PlatformAiManagementTransactionParticipant<Prisma.TransactionClient>;
}) {
  if (typeof input?.transactionParticipant?.begin !== 'function' || typeof input.authority?.resolveRead !== 'function')
    throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
  const begin = (transaction: Prisma.TransactionClient, actorId: string) =>
    beginPlatformAiManagementTransaction(transaction, actorId, input.transactionParticipant);
  const scopes = new AiScopeRepository(input.db, input.authority);
  const configuration = new PrismaPlatformModelConnection(input.db, scopes, input.authority, input.secrets,
    new AiScopeRepository(input.db, { resolve: () => input.authority.resolveRead() }), begin);
  return Object.freeze({ configuration, async registerScope() {
    const resolve = async () => {
      const context = structuredClone(await input.authority.resolve());
      if (context.actor.kind !== 'saas_admin' || context.scope.kind !== 'platform' || context.audience !== 'operator')
        throw new ModelGatewayError('FORBIDDEN');
      const { requestId: _, authorizedAt: __, ...stable } = context;
      return { actorId: context.actor.userId, binding: requestFingerprint(stable) };
    };
    const before = await resolve();
    await registerScope(input.db, aiPersistenceScopeColumns({ kind: 'platform' }),
      transaction => begin(transaction, before.actorId), async () => {
        if ((await resolve()).binding !== before.binding) throw new ModelGatewayError('FORBIDDEN');
      });
  } });
}
