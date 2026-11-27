/** Exact public text verification scene. No caller prompt, supplier choice,
 * simulated capability or business tool is accepted by this registration. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import type { AiExecutionContext, AiGatewayConfigReferenceDraft } from '@rental-os/platform-contracts/ai-gateway';
import type { AiTaskRepositoryOperation } from '../task-persistence';
import { AI_PUBLIC_TEXT_SCENE, AI_PUBLIC_WORK_CENTER_PERMISSION } from '@rental-os/platform-contracts/ai-work-center';
import { AI_TEXT_MODEL_STEP_CODE, AI_TOOL_DRAFT_VERSION } from '@rental-os/platform-contracts/ai-task';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AiTaskRepositoryError } from '../task-errors';
import type { createPublicTenantTaskAuthority } from '../public-tenant-task-authority';
import { aiTaskRunnerLimitsSchema } from '../task-runner-resources';
import { aiPersistenceScopeColumns } from '../runtime/persistence-scope';
import { taskModelIdentity } from '../runtime/model-input/task-model-input-binding';
import { AI_RETENTION_POLICY } from '../privacy/retention-policy';

export const SCENE = AI_PUBLIC_TEXT_SCENE;
export const SCENE_VERSION = 'public-text-verification-1';
export const REQUEST_VERSION = 'public-text-original-1';
export const CALL_PRICE_VERSION = 'original-invocation-call-1';
export const sceneBinding = { sceneCode: SCENE, maxOutputTokens: 32, routeScene: 'chat' } as const;
export const step = { toolCode: AI_TEXT_MODEL_STEP_CODE, toolVersion: AI_TOOL_DRAFT_VERSION, operation: 'external_unknown' } as const;
export const admitsTool = (code: string, version: string) => code === step.toolCode && version === step.toolVersion;
export const permission = AI_PUBLIC_WORK_CENTER_PERMISSION;
export const workActions: readonly AiTaskRepositoryOperation[] = ['claim_run', 'transition_task'];
export const readActions: readonly AiTaskRepositoryOperation[] = ['read_metadata', 'read_step_terminal', 'claim_recovery_run', 'release_run'];
export const tools = [{ code: step.toolCode, version: step.toolVersion }];
export const retentionMs = AI_RETENTION_POLICY.conversationDays * 86400000;
export const leaseMs = 120000;
export const transactionOptions = { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 } as const;
export const entryPermission = (operation: AiTaskRepositoryOperation) =>
  workActions.includes(operation) || readActions.includes(operation) ? permission : undefined;
export const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
export const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
export const conflict = () => new AiTaskRepositoryError('AI_REVISION_CONFLICT');
export class WorkCenterUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  constructor() { super('AI_RESULT_UNKNOWN'); }
}
export type BoundAuthority = Awaited<ReturnType<ReturnType<typeof createPublicTenantTaskAuthority>['bind']>>;
export type Tx = Prisma.TransactionClient;
export const inputRequest = Object.freeze({ sceneCode: SCENE, input: Object.freeze({ capability: 'text' as const }) });
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const originalPayload = z.object({ command: z.object({ operationId: id, profileKey: id.max(64),
  profileFingerprint: z.string().regex(/^[a-f0-9]{64}$/u), capability: z.literal('text') }).strict(),
  configuration: z.unknown(), policyRevision: z.number().int().positive(), priceVersion: z.literal(CALL_PRICE_VERSION) }).strict();
export type TenantConfiguration = Extract<AiGatewayConfigReferenceDraft, { serviceMode: 'tenant_managed' }>;
export function tenant(context: AiExecutionContext) {
  if (context.audience !== 'operator' || context.actor.kind !== 'user' || context.scope.kind !== 'tenant'
    || !('access' in context) || context.access.dataScope !== 'all' || !hasEffectivePermission(context.access.permissions, permission)) throw denied();
  return { tenantId: context.scope.tenantId, ownerId: context.actor.userId };
}
export async function owner(db: Pick<PrismaClient, 'aiScope'>, context: AiExecutionContext) {
  const subject = tenant(context), columns = aiPersistenceScopeColumns({ kind: 'tenant', tenantId: subject.tenantId });
  const current = await db.aiScope.findFirst({ where: columns });
  if (!current || Object.entries(columns).some(([key, value]) => current[key as keyof typeof current] !== value)) throw unavailable();
  return { scopeId: current.id, ownerId: subject.ownerId, tenantId: subject.tenantId, binding: taskModelIdentity(context) };
}
export type Owner = Awaited<ReturnType<typeof owner>>;
export const policyKey = (scopeId: string) => ({ scopeId, sceneCode: SCENE, sceneVersion: SCENE_VERSION });
export async function policyRow(db: Pick<PrismaClient, 'aiTaskPlanPolicy'>, scopeId: string) {
  const key = policyKey(scopeId), row = await db.aiTaskPlanPolicy.findUnique({ where: { scopeId_sceneCode_sceneVersion: key } });
  if (!row) return null;
  const limits = aiTaskRunnerLimitsSchema.safeParse(row?.limits);
  if (row.scopeId !== scopeId || row.sceneCode !== SCENE || row.sceneVersion !== SCENE_VERSION
    || !Number.isInteger(row.revision) || row.revision < 1 || row.revision > 4294967294 || !(row.expiresAt instanceof Date)
    || !Number.isFinite(row.expiresAt.getTime()) || typeof row.enabled !== 'boolean'
    || !limits.success || limits.data.maxStepMs > limits.data.maxTotalMs
    || requestFingerprint(row.allowedTools) !== requestFingerprint(tools)) throw unavailable();
  return { revision: row.revision, enabled: row.enabled, expiresAt: row.expiresAt, limits: limits.data,
    hash: requestFingerprint({ ...key, revision: row.revision, enabled: row.enabled, expiresAt: row.expiresAt.toISOString(), limits: limits.data, tools }) };
}
export async function policy(db: Pick<PrismaClient, 'aiTaskPlanPolicy'>, scopeId: string, now: Date) {
  const row = await policyRow(db, scopeId);
  if (!row?.enabled || row.expiresAt <= now) throw unavailable();
  return row;
}
export type ScenePolicy = Awaited<ReturnType<typeof policy>>;
export type SceneInput = z.infer<typeof originalPayload> & { configuration: TenantConfiguration };
export const creationKey = (inputRef: string) => `scene-request:${inputRef}`;
export const registrationRef = (inputRef: string) => `text-check:${inputRef}`;
