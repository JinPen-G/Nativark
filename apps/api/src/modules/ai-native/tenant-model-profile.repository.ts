import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ModelGatewayError, type GatewayContext } from './model-gateway.ports';
import { aiPersistenceScopeColumns } from './persistence-scope';
import { checkedTenantModelRecord, PrismaTenantModelConfigRepository, readLegacyModelConfiguration, type LegacyModelConfigurationBasis } from './tenant-model-config.repository';
import { tenantModelMode, tenantModelServiceEnabled, AiModelConfigurationResultUnknownError } from './model-config-compatibility';
import { tenantModelCredentialReference, type TenantModelConfigPorts, type TenantModelRecord } from './tenant-model-config.service';
import { capabilityNameSchema } from './capability-verification';
import type { AiProfileCapability } from './provider-profile.ports';
import { readModelConfigurationOperation, appendModelConfigurationOperation, type ModelConfigurationOperationWrite,
  type ModelConfigurationOperationDb } from './model-configuration-operation';

type Db = Pick<PrismaClient, '$transaction' | 'aiTenantModelConfiguration' | 'systemParameterSet' | 'aiScope' | 'aiProviderProfile'> & ModelConfigurationOperationDb;
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
  read(tenantId: string, legacy?: LegacyModelConfigurationBasis) { return this.records.read(tenantId, legacy); }
  async readLegacyState(tenantId: string) {
    const configured = await this.db.aiTenantModelConfiguration.findUnique({ where: { tenantId }, select: { tenantId: true } });
    if (configured && configured.tenantId !== tenantId) throw new ModelGatewayError('FORBIDDEN');
    return { configured: Boolean(configured), source: await readLegacyModelConfiguration(this.db, tenantId) };
  }

  async compareAndSwap(tenantId: string, expectedRevision: number, value: TenantModelRecord, caller?: GatewayContext,
    operation?: ModelConfigurationOperationWrite, legacy?: LegacyModelConfigurationBasis) {
    return this.commit(tenantId, expectedRevision, value, caller, undefined, operation, legacy);
  }

  async readOperation(caller: GatewayContext, operationKey: string, commandHash?: string) {
    const parsed = contextSchema.safeParse(structuredClone(caller));
    if (!parsed.success) throw new ModelGatewayError('FORBIDDEN');
    const context = parsed.data, action = commandHash === undefined ? 'read' as const : 'manage' as const;
    await this.authorize(structuredClone(context), action);
    const columns = aiPersistenceScopeColumns({ kind: 'tenant', tenantId: context.tenantId });
    const scope = await this.db.aiScope.findFirst({ where: columns });
    if (!scope || Object.entries(columns).some(([key, expected]) => scope[key as keyof typeof columns] !== expected)) throw new ModelGatewayError('FORBIDDEN');
    const result = await readModelConfigurationOperation(this.db, { scopeId: scope.id, scopeKind: 'TENANT',
      targetId: context.tenantId, actorId: context.actorId, workspaceId: context.workspaceId }, operationKey, commandHash);
    await this.authorize(structuredClone(context), action);
    return result;
  }

  async setAllowedCapabilities(caller: GatewayContext, expectedRevision: number, value: readonly AiProfileCapability[]) {
    const parsed = contextSchema.safeParse(caller), capabilities = z.array(capabilityNameSchema).max(8)
      .refine(items => new Set(items).size === items.length).safeParse(value);
    if (!parsed.success || !capabilities.success || !Number.isInteger(expectedRevision)
      || expectedRevision < 1 || expectedRevision >= 4294967295) throw new ModelGatewayError('CONFIG_INVALID');
    const context = parsed.data;
    try { await this.authorize(structuredClone(context), 'manage'); } catch { throw new ModelGatewayError('FORBIDDEN'); }
    const previous = await this.read(context.tenantId);
    if (!previous?.settings || previous.revision !== expectedRevision) throw new ModelGatewayError('CONFIG_INVALID');
    const next = { ...previous, revision: expectedRevision + 1 };
    if (!await this.commit(context.tenantId, expectedRevision, next, context, capabilities.data)) throw new ModelGatewayError('CONFIG_INVALID');
    return { revision: next.revision, allowedCapabilities: [...capabilities.data] };
  }

  private async commit(tenantId: string, expectedRevision: number, value: TenantModelRecord, caller?: GatewayContext,
    capabilities?: readonly AiProfileCapability[], operationValue?: ModelConfigurationOperationWrite, legacyValue?: LegacyModelConfigurationBasis) {
    const operation = structuredClone(operationValue);
    const legacy = structuredClone(legacyValue);
    if (operation && !this.db.aiModelConfigurationOperation?.create) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
    const parsed = contextSchema.safeParse(caller), next = checkedTenantModelRecord(value);
    if (!parsed.success || parsed.data.tenantId !== tenantId || next.tenantId !== tenantId
      || !Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 4294967295
      || next.revision !== expectedRevision + 1) throw new ModelGatewayError('CONFIG_INVALID');
    const context = parsed.data, mode = tenantModelMode(next);
    if (legacy && (expectedRevision !== 0 || !operation || mode !== 'tenant_managed' || tenantModelServiceEnabled(next))) throw new ModelGatewayError('CONFIG_INVALID');
    if (operation && (operation.expectedRevision !== expectedRevision || !('tenantId' in operation.result)
      || operation.result.tenantId !== tenantId || operation.result.configRevision !== next.revision
      || operation.result.mode !== mode || operation.result.enabled !== (tenantModelServiceEnabled(next)
        && (mode === 'platform_managed' || next.settings?.enabled === true)))) throw new ModelGatewayError('CONFIG_INVALID');
    const current = async () => {
      try { await this.authorize(structuredClone(context), 'manage'); }
      catch { throw new ModelGatewayError('FORBIDDEN'); }
    };
    await current();
    let callbackCompleted = false;
    try {
      const committed = await this.db.$transaction(async tx => {
        // Config CAS is the common write lock for all saves/mode changes. The
        // existing config-only adapter is reused ONLY inside this transaction.
        const records = new PrismaTenantModelConfigRepository(tx);
        if (!await records.compareAndSwap(tenantId, expectedRevision, next, undefined, undefined, legacy)) return false;
        await current();
        const columns = aiPersistenceScopeColumns({ kind: 'tenant', tenantId });
        const scope = await tx.aiScope.findFirst({ where: columns });
        if (!scope || !/^[A-Za-z0-9][\w.:-]{0,35}$/u.test(scope.id)
          || Object.entries(columns).some(([key, expected]) => scope[key as keyof typeof columns] !== expected)) throw new ModelGatewayError('FORBIDDEN');
        const where = { scopeId: scope.id, scopeKind: 'TENANT' as const, role: 'DEFAULT' as const };
        const profile = await tx.aiProviderProfile.findFirst({ where });
        if (profile && (profile.serviceMode !== 'tenant_managed' || profile.configRevision !== expectedRevision)) throw new ModelGatewayError('CONFIG_INVALID');
        const enabled = mode === 'tenant_managed' && tenantModelServiceEnabled(next) && next.settings?.enabled === true && Boolean(next.credentialsEncrypted);
        const data = { configRevision: next.revision, credentialRef: tenantModelCredentialReference(tenantId, next.revision),
          enabled, disabledAt: enabled ? null : new Date(),
          ...(capabilities === undefined ? {} : { allowedCapabilities: [...capabilities] }),
          ...(next.settings ? { model: next.settings.model, protocol: next.settings.protocol } : {}) };
        if (profile) {
          const updated = await tx.aiProviderProfile.updateMany({ where: { ...where, id: profile.id,
            serviceMode: 'tenant_managed', configRevision: expectedRevision }, data });
          if (updated.count !== 1) throw new ModelGatewayError('CONFIG_INVALID');
        } else if (next.settings) {
          await tx.aiProviderProfile.create({ data: { ...where, ...data, profileKey: 'default',
            serviceMode: 'tenant_managed', protocol: next.settings.protocol, provider: next.settings.protocol,
            model: next.settings.model, allowedCapabilities: [...(capabilities ?? [])] } });
        }
        // Revocation during any preceding await aborts this transaction. These
        // are sequential fresh authority checks, NOT atomic business admission.
        if (operation) await appendModelConfigurationOperation(tx, { scopeId: scope.id, scopeKind: 'TENANT',
          targetId: tenantId, actorId: context.actorId, workspaceId: context.workspaceId }, operation);
        if (legacy) await records.assertLegacySource(tenantId, legacy);
        await current();
        callbackCompleted = true;
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      if (committed) await current();
      return committed;
    } catch (error) {
      if (callbackCompleted) throw new AiModelConfigurationResultUnknownError();
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ModelGatewayError('CONFIG_INVALID');
      throw error; // no automatic retry on commit uncertainty or deadlock
    }
  }
}
