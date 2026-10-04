import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ModelGatewayError, type GatewayContext } from './model-gateway.ports';
import { aiPersistenceScopeColumns } from './persistence-scope';
import { checkedTenantModelRecord, PrismaTenantModelConfigRepository } from './tenant-model-config.repository';
import { tenantModelMode } from './model-config-compatibility';
import { tenantModelCredentialReference, type TenantModelConfigPorts, type TenantModelRecord } from './tenant-model-config.service';

type Db = Pick<PrismaClient, '$transaction' | 'aiTenantModelConfiguration' | 'systemParameterSet' | 'aiScope' | 'aiProviderProfile'>;
type Repository = TenantModelConfigPorts['repository'];
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][\w.:-]*$/u);
const contextSchema = z.object({ tenantId: identifier, workspaceId: identifier, actorId: identifier }).strict();

/** Reuses config validation/CAS, but commits its DEFAULT Profile in the same
 * transaction. It is a server storage adapter, not a permission/dispatch grant.
 * Only the existing single-model tenant configuration is projected here.
 */
export class PrismaTenantModelProfileRepository implements Repository {
  private readonly records: PrismaTenantModelConfigRepository;
  constructor(private readonly db: Db, private readonly authorize: TenantModelConfigPorts['authorize']) {
    if ([db?.$transaction, db?.aiScope?.findFirst, db?.aiProviderProfile?.findFirst,
      db?.aiProviderProfile?.updateMany, db?.aiProviderProfile?.create, authorize]
      .some(method => typeof method !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
    this.records = new PrismaTenantModelConfigRepository(db);
  }
  read(tenantId: string) { return this.records.read(tenantId); }

  async compareAndSwap(tenantId: string, expectedRevision: number, value: TenantModelRecord, caller?: GatewayContext) {
    const parsed = contextSchema.safeParse(caller), next = checkedTenantModelRecord(value);
    if (!parsed.success || parsed.data.tenantId !== tenantId || next.tenantId !== tenantId
      || !Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 4294967295
      || next.revision !== expectedRevision + 1) throw new ModelGatewayError('CONFIG_INVALID');
    const context = parsed.data, mode = tenantModelMode(next);
    const current = async () => {
      try { await this.authorize(structuredClone(context), 'manage'); }
      catch { throw new ModelGatewayError('FORBIDDEN'); }
    };
    await current();
    try {
      return await this.db.$transaction(async tx => {
        // Config CAS is the common write lock for all saves/mode changes. The
        // existing config-only adapter is reused ONLY inside this transaction.
        const records = new PrismaTenantModelConfigRepository(tx);
        if (!await records.compareAndSwap(tenantId, expectedRevision, next)) return false;
        await current();
        const columns = aiPersistenceScopeColumns({ kind: 'tenant', tenantId });
        const scope = await tx.aiScope.findFirst({ where: columns });
        if (!scope || !/^[A-Za-z0-9][\w.:-]{0,35}$/u.test(scope.id)
          || Object.entries(columns).some(([key, expected]) => scope[key as keyof typeof columns] !== expected)) throw new ModelGatewayError('FORBIDDEN');
        const where = { scopeId: scope.id, scopeKind: 'TENANT' as const, role: 'DEFAULT' as const };
        const profile = await tx.aiProviderProfile.findFirst({ where });
        if (profile && (profile.serviceMode !== 'tenant_managed' || profile.configRevision !== expectedRevision)) throw new ModelGatewayError('CONFIG_INVALID');
        const enabled = mode === 'tenant_managed' && next.settings?.enabled === true && Boolean(next.credentialsEncrypted);
        const data = { configRevision: next.revision, credentialRef: tenantModelCredentialReference(tenantId, next.revision),
          enabled, disabledAt: enabled ? null : new Date(),
          ...(next.settings ? { model: next.settings.model, protocol: next.settings.protocol } : {}) };
        if (profile) {
          const updated = await tx.aiProviderProfile.updateMany({ where: { ...where, id: profile.id,
            serviceMode: 'tenant_managed', configRevision: expectedRevision }, data });
          if (updated.count !== 1) throw new ModelGatewayError('CONFIG_INVALID');
        } else if (next.settings) {
          await tx.aiProviderProfile.create({ data: { ...where, ...data, profileKey: 'default',
            serviceMode: 'tenant_managed', protocol: next.settings.protocol, provider: next.settings.protocol,
            model: next.settings.model, allowedCapabilities: [] } });
        }
        // Revocation during any preceding await aborts this transaction. These
        // are sequential fresh authority checks, NOT atomic business admission.
        await current();
        return true;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ModelGatewayError('CONFIG_INVALID');
      throw error; // no automatic retry on commit uncertainty or deadlock
    }
  }
}
