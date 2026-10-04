import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ModelGatewayError } from './model-gateway.ports';
import { tenantModelMode } from './model-config-compatibility';
import { tenantModelSettingsSchema, type TenantModelConfigPorts, type TenantModelRecord } from './tenant-model-config.service';

const tenantIdSchema = z.string().min(1).max(191).regex(/^[\w.:-]+$/u);
const recordSchema = z.object({
  tenantId: tenantIdSchema, revision: z.number().int().min(1).max(4294967295),
  mode: z.enum(['platform_managed', 'tenant_managed']).optional(),
  settings: tenantModelSettingsSchema.omit({ apiKey: true, expectedRevision: true, secretChange: true }).optional(),
  credentialsEncrypted: z.string().max(65535).regex(/^(?:|v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+)$/u).optional()
}).strict();
function checked(value: unknown): TenantModelRecord {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
  tenantModelMode(parsed.data);
  return parsed.data;
}
const select = { tenantId: true, mode: true, revision: true, settings: true, credentialsEncrypted: true } satisfies Prisma.AiTenantModelConfigurationSelect;
type TenantModelRepository = TenantModelConfigPorts['repository'];

/** Server-only storage port, not an authorization boundary. Its caller must use
 * TenantModelConfigService with fresh action authority. No startup migration,
 * plaintext import, provider fallback or test-success inference is performed.
 */
export class PrismaTenantModelConfigRepository implements TenantModelRepository {
  constructor(private readonly db: Pick<PrismaClient, 'aiTenantModelConfiguration' | 'systemParameterSet'>) {
    if ([db?.aiTenantModelConfiguration?.findUnique, db?.aiTenantModelConfiguration?.create,
      db?.aiTenantModelConfiguration?.updateMany, db?.systemParameterSet?.findFirst].some(method => typeof method !== 'function')) {
      throw new ModelGatewayError('CONFIG_INVALID');
    }
  }
  private tenant(value: string) {
    const parsed = tenantIdSchema.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    return parsed.data;
  }
  private async assertNoUnconvertedLegacy(tenantId: string) {
    const row = await this.db.systemParameterSet.findFirst({ where: { tenantId, module: 'system-rules', status: 'EFFECTIVE' },
      orderBy: [{ versionNo: 'desc' }, { updatedAt: 'desc' }], select: { content: true } });
    const content = row?.content;
    if (row && (!content || typeof content !== 'object' || Array.isArray(content))) throw new ModelGatewayError('CONFIG_INVALID');
    if (content && typeof content === 'object' && !Array.isArray(content) && content.aiModel != null) {
      // Legacy masked/unversioned settings cannot be interpreted as absence.
      // Preserve their original storage and require an explicit reviewed conversion.
      throw new ModelGatewayError('CREDENTIAL_UNAVAILABLE');
    }
  }
  async read(value: string): Promise<TenantModelRecord | null> {
    const tenantId = this.tenant(value);
    const row = await this.db.aiTenantModelConfiguration.findUnique({ where: { tenantId }, select });
    if (!row) { await this.assertNoUnconvertedLegacy(tenantId); return null; }
    if (row.tenantId !== tenantId) throw new ModelGatewayError('FORBIDDEN');
    return checked({ tenantId: row.tenantId, revision: row.revision, mode: row.mode,
      ...(row.settings !== null ? { settings: row.settings } : {}),
      ...(row.credentialsEncrypted !== null ? { credentialsEncrypted: row.credentialsEncrypted } : {}) });
  }
  async compareAndSwap(value: string, expectedRevision: number, nextValue: TenantModelRecord): Promise<boolean> {
    const tenantId = this.tenant(value), next = checked(nextValue);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 4294967295
      || next.revision !== expectedRevision + 1 || next.tenantId !== tenantId) throw new ModelGatewayError('CONFIG_INVALID');
    // Validation projects a detached snapshot before any asynchronous operation.
    const data = { mode: tenantModelMode(next), revision: next.revision,
      settings: next.settings ? { ...next.settings } : Prisma.DbNull,
      credentialsEncrypted: next.credentialsEncrypted ?? null };
    if (expectedRevision === 0) {
      await this.assertNoUnconvertedLegacy(tenantId);
      try { await this.db.aiTenantModelConfiguration.create({ data: { tenantId, ...data }, select }); return true; }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
        throw error; // uncertain commit is never an invitation to retry a write
      }
    }
    const result = await this.db.aiTenantModelConfiguration.updateMany({ where: { tenantId, revision: expectedRevision }, data });
    return result.count === 1;
  }
}
