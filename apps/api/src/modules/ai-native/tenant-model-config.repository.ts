import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ModelGatewayError } from './model-gateway.ports';
import { tenantModelMode } from './model-config-compatibility';
import { tenantModelSettingsSchema, type TenantModelConfigPorts, type TenantModelRecord } from './tenant-model-config.service';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { AiModelConfigurationRevisionConflictError } from './model-config-compatibility';
import type { GatewayContext } from './model-gateway.ports';
import type { ModelConfigurationOperationWrite } from './model-configuration-operation';
import { SECRET_BOX_ENVELOPE_PATTERN } from '../../common/secret-box';

export type LegacyModelConfigurationSource = { id: string; tenantId: string; module: string; status: string;
  versionNo: number; updatedAt: Date; content: Prisma.JsonValue };
export type LegacyModelConfigurationBasis = { parameterSetId: string; versionNo: number; hash: string };
/** Private source, never exported through the management read. Unknown or
 * masked keys remain data, not credentials; this function performs no import. */
export async function readLegacyModelConfiguration(db: Pick<PrismaClient, 'systemParameterSet'>, tenantId: string): Promise<LegacyModelConfigurationSource | null> {
  const row = structuredClone(await db.systemParameterSet.findFirst({ where: { tenantId, module: 'system-rules', status: 'EFFECTIVE' },
    orderBy: [{ versionNo: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true, tenantId: true, module: true, status: true, versionNo: true, updatedAt: true, content: true } }));
  if (!row) return null;
  if (row.tenantId !== tenantId || row.module !== 'system-rules' || row.status !== 'EFFECTIVE'
    || !Number.isInteger(row.versionNo) || row.versionNo < 1 || row.versionNo > 2147483647
    || !row.id || !(row.updatedAt instanceof Date) || !Number.isFinite(row.updatedAt.getTime())
    || !row.content || typeof row.content !== 'object' || Array.isArray(row.content)
    || Buffer.byteLength(JSON.stringify(row.content), 'utf8') > 1048576) throw new ModelGatewayError('CONFIG_INVALID');
  return row.content.aiModel == null ? null : row;
}

const tenantIdSchema = z.string().min(1).max(191).regex(/^[\w.:-]+$/u);
const recordSchema = z.object({
  tenantId: tenantIdSchema, revision: z.number().int().min(1).max(4294967295),
  mode: z.enum(['platform_managed', 'tenant_managed']).optional(),
  serviceEnabled: z.boolean().optional(),
  settings: tenantModelSettingsSchema.omit({ apiKey: true, expectedRevision: true, secretChange: true }).optional(),
  credentialsEncrypted: z.string().max(65535).refine(value => value === '' || SECRET_BOX_ENVELOPE_PATTERN.test(value)).optional()
}).strict();
export function checkedTenantModelRecord(value: unknown): TenantModelRecord {
  const parsed = recordSchema.safeParse(value);
  if (!parsed.success) throw new ModelGatewayError('CONFIG_INVALID');
  tenantModelMode(parsed.data);
  return parsed.data;
}
const select = { tenantId: true, mode: true, revision: true, serviceEnabled: true, settings: true, credentialsEncrypted: true } satisfies Prisma.AiTenantModelConfigurationSelect;
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
  async assertLegacySource(tenantId: string, basis: LegacyModelConfigurationBasis) {
    const current = await readLegacyModelConfiguration(this.db, tenantId);
    if (!current || current.id !== basis.parameterSetId || current.versionNo !== basis.versionNo
      || requestFingerprint(current) !== basis.hash) throw new AiModelConfigurationRevisionConflictError();
  }
  private async assertNoUnconvertedLegacy(tenantId: string, basis?: LegacyModelConfigurationBasis) {
    if (basis) return this.assertLegacySource(tenantId, basis);
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
  async read(value: string, legacy?: LegacyModelConfigurationBasis): Promise<TenantModelRecord | null> {
    const tenantId = this.tenant(value);
    const row = await this.db.aiTenantModelConfiguration.findUnique({ where: { tenantId }, select });
    if (!row) { await this.assertNoUnconvertedLegacy(tenantId, legacy); return null; }
    if (row.tenantId !== tenantId) throw new ModelGatewayError('FORBIDDEN');
    return checkedTenantModelRecord({ tenantId: row.tenantId, revision: row.revision, mode: row.mode,
      ...(row.serviceEnabled != null ? { serviceEnabled: row.serviceEnabled } : {}),
      ...(row.settings !== null ? { settings: row.settings } : {}),
      ...(row.credentialsEncrypted !== null ? { credentialsEncrypted: row.credentialsEncrypted } : {}) });
  }
  async compareAndSwap(value: string, expectedRevision: number, nextValue: TenantModelRecord, _caller?: GatewayContext,
    _operation?: ModelConfigurationOperationWrite, legacy?: LegacyModelConfigurationBasis): Promise<boolean> {
    const tenantId = this.tenant(value), next = checkedTenantModelRecord(nextValue);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 4294967295
      || next.revision !== expectedRevision + 1 || next.tenantId !== tenantId) throw new ModelGatewayError('CONFIG_INVALID');
    // Validation projects a detached snapshot before any asynchronous operation.
    const data = { mode: tenantModelMode(next), revision: next.revision,
      serviceEnabled: next.serviceEnabled ?? null,
      settings: next.settings ? { ...next.settings } : Prisma.DbNull,
      credentialsEncrypted: next.credentialsEncrypted ?? null };
    if (expectedRevision === 0) {
      await this.assertNoUnconvertedLegacy(tenantId, legacy);
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
