/** Original config receipts only. Never dispatch, authenticate a provider or
 * reconstruct a secret from an audit record. The caller supplies current real
 * authority; writes belong inside its existing config/Profile/Vault txn. */
import type { Prisma, PrismaClient } from '@prisma/client';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { AI_USAGE_DRAFT_SCHEMAS, type AiTenantModelSettingsSummaryDraft, type AiPlatformModelSettingsSaveDraft,
  type AiModelConfigurationOperationDraft } from '@rental-os/shared';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from './model-gateway.ports';
import { AiModelConfigurationRevisionConflictError } from './model-config-compatibility';

export const modelConfigurationOperationKey = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
type Result = AiTenantModelSettingsSummaryDraft | AiPlatformModelSettingsSaveDraft;
export type ModelConfigurationOperationWrite = { operationKey: string; expectedRevision: number; commandHash: string; result: Result };
export type ModelConfigurationOperationOwner = { scopeId: string; scopeKind: 'TENANT' | 'PLATFORM'; targetId: string; actorId: string; workspaceId: string | null };
export type ModelConfigurationOperationDb = Partial<Pick<PrismaClient, 'aiModelConfigurationOperation'>>;
const ajv = new Ajv({ strict: true }); addFormats(ajv);
const validTenant = ajv.compile<AiTenantModelSettingsSummaryDraft>(AI_USAGE_DRAFT_SCHEMAS.AiTenantModelSettingsSummaryDraft);
const validPlatform = ajv.compile<AiPlatformModelSettingsSaveDraft>(AI_USAGE_DRAFT_SCHEMAS.AiPlatformModelSettingsSaveDraft);
ajv.addSchema(AI_USAGE_DRAFT_SCHEMAS.AiTenantModelSettingsSummaryDraft, 'urn:rental:model-operation:tenant');
ajv.addSchema(AI_USAGE_DRAFT_SCHEMAS.AiPlatformModelSettingsSaveDraft, 'urn:rental:model-operation:platform');
export const validModelConfigurationOperation = ajv.compile<AiModelConfigurationOperationDraft>(JSON.parse(JSON.stringify(
  AI_USAGE_DRAFT_SCHEMAS.AiModelConfigurationOperationDraft)
  .replaceAll('#/components/schemas/AiTenantModelSettingsSummaryDraft', 'urn:rental:model-operation:tenant')
  .replaceAll('#/components/schemas/AiPlatformModelSettingsSaveDraft', 'urn:rental:model-operation:platform')));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const revision = z.number().int().min(0).max(4294967294);
function checkedResult(owner: ModelConfigurationOperationOwner, result: unknown, expectedRevision: number): Result {
  if (!revision.safeParse(expectedRevision).success) throw new ModelGatewayError('CONFIG_INVALID');
  if (owner.scopeKind === 'TENANT' && validTenant(result) && result.tenantId === owner.targetId
    && result.configId === owner.targetId && result.configRevision === expectedRevision + 1) return structuredClone(result);
  if (owner.scopeKind === 'PLATFORM' && validPlatform(result) && result.profileId === owner.targetId
    && result.revision === expectedRevision + 1) return structuredClone(result);
  throw new ModelGatewayError('CONFIG_INVALID');
}
export async function readModelConfigurationOperation(db: ModelConfigurationOperationDb, owner: ModelConfigurationOperationOwner,
  key: string, commandHash?: string): Promise<AiModelConfigurationOperationDraft> {
  if (!modelConfigurationOperationKey.safeParse(key).success) throw new ModelGatewayError('INVALID_REQUEST');
  if (!db.aiModelConfigurationOperation?.findUnique) throw new ModelGatewayError('PROVIDER_UNAVAILABLE');
  const row = structuredClone(await db.aiModelConfigurationOperation.findUnique({ where: { scopeId_scopeKind_targetId_operationKey: {
    scopeId: owner.scopeId, scopeKind: owner.scopeKind, targetId: owner.targetId, operationKey: key } } }));
  const base = { operationKey: key, automaticRetry: false as const, execution: 'not_granted' as const,
    observation: 'original_configuration_save' as const };
  // Even another current manager must not learn the original author's result.
  if (!row || row.actorId !== owner.actorId || row.workspaceId !== owner.workspaceId) {
    if (row && commandHash !== undefined) throw new AiModelConfigurationRevisionConflictError();
    return { ...base, state: 'unknown', result: null };
  }
  if (row.scopeId !== owner.scopeId || row.scopeKind !== owner.scopeKind || row.targetId !== owner.targetId || row.operationKey !== key
    || !hash.safeParse(row.commandHash).success || commandHash !== undefined && commandHash !== row.commandHash
    || !(row.recordedAt instanceof Date) || !Number.isFinite(row.recordedAt.getTime())) throw new AiModelConfigurationRevisionConflictError();
  const result = checkedResult(owner, row.result, row.expectedRevision);
  if (row.resultRevision !== row.expectedRevision + 1 || row.resultHash !== requestFingerprint(result)) throw new ModelGatewayError('CONFIG_INVALID');
  return { ...base, state: 'recorded', expectedRevision: row.expectedRevision, resultRevision: row.resultRevision,
    recordedAt: row.recordedAt.toISOString(), result };
}
export async function appendModelConfigurationOperation(tx: Pick<Prisma.TransactionClient, 'aiModelConfigurationOperation'>,
  owner: ModelConfigurationOperationOwner, value: ModelConfigurationOperationWrite) {
  const command = structuredClone(value);
  if (!tx.aiModelConfigurationOperation?.create || !modelConfigurationOperationKey.safeParse(command.operationKey).success
    || !hash.safeParse(command.commandHash).success) throw new ModelGatewayError('CONFIG_INVALID');
  const result = checkedResult(owner, command.result, command.expectedRevision);
  await tx.aiModelConfigurationOperation.create({ data: { ...owner, operationKey: command.operationKey,
    expectedRevision: command.expectedRevision, resultRevision: command.expectedRevision + 1,
    commandHash: command.commandHash, result: JSON.parse(JSON.stringify(result)), resultHash: requestFingerprint(result) } });
}
