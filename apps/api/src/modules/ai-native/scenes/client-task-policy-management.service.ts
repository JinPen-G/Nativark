import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { z } from 'zod';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { clientTaskSceneSchema, type AiClientTaskScene } from './client-task.authority';
import type { AuthService } from '../../auth/auth.service';
import { PrismaTaskPlanPolicyRepository } from '../runner/prisma-task-plan-policy.repository';
import { TASK_TEXT_MODEL_TOOL } from '../model-input/task-model-input';

const keySchema = z.object({ channel: z.enum(['wechat_miniprogram', 'web', 'app']),
  customerType: z.enum(['personal', 'corporate']) }).strict();
const changeSchema = keySchema.extend({ operationKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  expectedRevision: z.number().int().min(0).max(4294967293), enabled: z.boolean(), allowCreate: z.boolean(),
  allowRead: z.boolean(), allowExecute: z.boolean(), allowRequestInput: z.boolean().optional(),
  allowSubmitInput: z.boolean().optional(), allowResumeInput: z.boolean().optional(),
  allowCancel: z.boolean().optional(),
  expiresAt: z.string().datetime({ offset: true }) }).strict();
const observationSchema = keySchema.extend({ operationKey: changeSchema.shape.operationKey }).strict();
const snapshotSchema = keySchema.extend({ id: z.string().uuid(), tenantId: z.string(), workspaceId: z.string(),
  sceneCode: z.string(), sceneVersion: z.string(), enabled: z.boolean(), allowCreate: z.boolean(), allowRead: z.boolean(),
  allowExecute: z.boolean(), allowRequestInput: z.boolean().optional().default(false),
  allowSubmitInput: z.boolean().optional().default(false), allowResumeInput: z.boolean().optional().default(false),
  allowCancel: z.boolean().optional().default(false),
  revision: z.number().int().min(1).max(4294967294), expiresAt: z.string().datetime({ offset: true }) }).strict();
const auditSchema = z.object({ version: z.literal('client-task-policy-management-1'), operationKey: changeSchema.shape.operationKey,
  commandHash: z.string().regex(/^[a-f0-9]{64}$/u), actorId: z.string(), before: snapshotSchema.nullable(),
  result: snapshotSchema, recordedAt: z.string().datetime({ offset: true }) }).strict();
const action = 'ai_client_task_policy_change';
type Db = Pick<PrismaClient, '$transaction' | 'aiClientTaskPolicy' | 'operationLog'>;
type Manager = { tenantId: string; workspaceId: string; actorId: string; sessionBinding: string };
const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const parsed = schema.safeParse(structuredClone(input));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  return parsed.data;
};

/** Server configuration lifecycle only. Original system-parameter permission,
 * scoped CAS and the existing audit log are mandatory. This does not publish a
 * model plan, validate a provider, grant dispatch or register a production route.
 */
export class HumanClientTaskPolicyManagementService {
  private readonly scene: AiClientTaskScene;
  constructor(private readonly db: Db, private readonly guard: Pick<ApiAuthGuard, 'canActivate'>,
    private readonly credentials: AiOrderRouteCredentialSource, scene: AiClientTaskScene,
    private readonly clock: () => Date = () => new Date()) {
    this.scene = Object.freeze(parse(clientTaskSceneSchema, scene));
    if (![db?.$transaction, db?.aiClientTaskPolicy?.findUnique, db?.operationLog?.findFirst,
      guard?.canActivate, credentials?.current].every(method => typeof method === 'function'))
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  private async manager(): Promise<Manager> {
    try {
      const credential = structuredClone(await this.credentials.current());
      if (credential.audience !== 'operator' || typeof credential.authorization !== 'string'
        || credential.authorization.length > 8192 || !credential.authorization.startsWith('Bearer ')) throw Error();
      return await runWithRequestIdentity({}, async () => {
        const route = '/api/platform/system-rules/aiModel';
        const request = { url: route, originalUrl: route, method: 'PUT',
          headers: { authorization: credential.authorization }, query: {}, user: undefined as unknown };
        if (await this.guard.canActivate(new ExecutionContextHost([request])) !== true) throw Error();
        const user = z.object({ id: z.string().min(1), tenantId: z.string().min(1), isActive: z.literal(true),
          isSaasAdmin: z.boolean().optional() }).parse(request.user);
        const identity = structuredClone(getRequestIdentity());
        if (!identity || identity.isSaasAdmin || user.isSaasAdmin || identity.staffApi || !identity.workspaceId
          || identity.userId !== user.id || identity.tenantId !== user.tenantId) throw Error();
        return { tenantId: identity.tenantId, workspaceId: identity.workspaceId, actorId: user.id,
          sessionBinding: requestFingerprint(identity) };
      });
    } catch { throw new AiTaskRepositoryError('AI_ACCESS_DENIED'); }
  }
  private async recheck(before: Manager) {
    const current = await this.manager();
    if (requestFingerprint(before) !== requestFingerprint(current)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }
  private key(manager: Manager, key: z.infer<typeof keySchema>) {
    return { tenantId: manager.tenantId, workspaceId: manager.workspaceId, ...key, ...this.scene };
  }
  private snapshot(row: Prisma.AiClientTaskPolicyGetPayload<object>) {
    return parse(snapshotSchema, { id: row.id, tenantId: row.tenantId, workspaceId: row.workspaceId,
      channel: row.channel, customerType: row.customerType, sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
      enabled: row.enabled, allowCreate: row.allowCreate, allowRead: row.allowRead, allowExecute: row.allowExecute,
      allowRequestInput: row.allowRequestInput, allowSubmitInput: row.allowSubmitInput, allowResumeInput: row.allowResumeInput,
      allowCancel: row.allowCancel,
      revision: row.revision, expiresAt: row.expiresAt.toISOString() });
  }
  private receiptId(manager: Manager, key: z.infer<typeof keySchema>, operationKey: string) {
    // The audit table's primary key is the persistent idempotency constraint.
    // Keys are namespaced by scope, actor, scene, channel and original operation.
    return requestFingerprint({ action, key: this.key(manager, key), actorId: manager.actorId, operationKey });
  }
  private async receipt(db: Pick<Prisma.TransactionClient, 'operationLog'>, manager: Manager,
    key: z.infer<typeof keySchema>, operationKey: string) {
    const row = await db.operationLog.findFirst({ where: { id: this.receiptId(manager, key, operationKey),
      tenantId: manager.tenantId, workspaceId: manager.workspaceId, userId: manager.actorId, action } });
    if (!row) return null;
    const detail = parse(auditSchema, row.detail);
    if (row.id !== this.receiptId(manager, key, operationKey) || row.tenantId !== manager.tenantId
      || row.workspaceId !== manager.workspaceId || row.userId !== manager.actorId || row.action !== action
      || detail.actorId !== manager.actorId || detail.operationKey !== operationKey
      || Object.entries(this.key(manager, key)).some(([name, value]) => detail.result[name as keyof typeof detail.result] !== value)
      || detail.before && (detail.before.id !== detail.result.id || detail.before.revision + 1 !== detail.result.revision
        || Object.entries(this.key(manager, key)).some(([name, value]) => detail.before![name as keyof typeof detail.before] !== value)))
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return detail;
  }
  async read(value: unknown) {
    const key = parse(keySchema, value), manager = await this.manager();
    const row = await this.db.aiClientTaskPolicy.findUnique({ where: { tenantId_workspaceId_channel_customerType_sceneCode_sceneVersion: this.key(manager, key) } });
    if (row && Object.entries(this.key(manager, key)).some(([name, expected]) => row[name as keyof typeof row] !== expected))
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const result = row ? this.snapshot(row) : null;
    await this.recheck(manager);
    return { state: row ? 'configured' as const : 'not_configured' as const, policy: result, execution: 'not_attested' as const };
  }
  async operation(value: unknown) {
    const input = parse(observationSchema, value), manager = await this.manager();
    const receipt = await this.receipt(this.db, manager, { channel: input.channel, customerType: input.customerType }, input.operationKey);
    await this.recheck(manager);
    return receipt ? { state: 'observed' as const, operationKey: input.operationKey, result: receipt.result,
      recordedAt: receipt.recordedAt, retryable: false as const, execution: 'not_attested' as const }
      : { state: 'not_observed' as const, operationKey: input.operationKey, retryable: false as const, execution: 'not_attested' as const };
  }
  async change(value: unknown) {
    const input = parse(changeSchema, value), key = { channel: input.channel, customerType: input.customerType }, manager = await this.manager();
    const commandHash = requestFingerprint({ key: this.key(manager, key), actorId: manager.actorId, input });
    const existing = await this.receipt(this.db, manager, key, input.operationKey);
    if (existing) {
      if (existing.commandHash !== commandHash) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
      await this.recheck(manager);
      return { state: 'observed' as const, operationKey: input.operationKey, result: existing.result,
        recordedAt: existing.recordedAt, execution: 'not_attested' as const, retryable: false as const };
    }
    const expiresAt = new Date(input.expiresAt), now = this.clock();
    if (!Number.isFinite(now.getTime()) || expiresAt <= now || expiresAt.getTime() - now.getTime() > 90 * 86400000)
      throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    try {
      const receipt = await this.db.$transaction(async tx => {
        const policyKey = this.key(manager, key);
        const previous = await tx.aiClientTaskPolicy.findUnique({ where: { tenantId_workspaceId_channel_customerType_sceneCode_sceneVersion: policyKey } });
        if ((previous?.revision ?? 0) !== input.expectedRevision
          || previous && Object.entries(policyKey).some(([name, expected]) => previous[name as keyof typeof previous] !== expected))
          throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        const before = previous ? this.snapshot(previous) : null;
        const result = parse(snapshotSchema, { id: previous?.id ?? randomUUID(), ...policyKey, enabled: input.enabled,
          allowCreate: input.allowCreate, allowRead: input.allowRead, allowExecute: input.allowExecute,
          allowRequestInput: input.allowRequestInput ?? false, allowSubmitInput: input.allowSubmitInput ?? false,
          allowResumeInput: input.allowResumeInput ?? false,
          allowCancel: input.allowCancel ?? false,
          revision: input.expectedRevision + 1, expiresAt: expiresAt.toISOString() });
        const data = { enabled: result.enabled, allowCreate: result.allowCreate, allowRead: result.allowRead,
          allowExecute: result.allowExecute, allowRequestInput: result.allowRequestInput,
          allowSubmitInput: result.allowSubmitInput, allowResumeInput: result.allowResumeInput,
          allowCancel: result.allowCancel,
          revision: result.revision, expiresAt };
        await this.recheck(manager);
        if (!previous) await tx.aiClientTaskPolicy.create({ data: { id: result.id, ...policyKey, ...data } });
        else {
          const changed = await tx.aiClientTaskPolicy.updateMany({ where: { id: previous.id, ...policyKey, revision: input.expectedRevision }, data });
          if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        }
        await this.recheck(manager);
        if (expiresAt <= this.clock()) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const detail = { version: 'client-task-policy-management-1' as const, operationKey: input.operationKey,
          commandHash, actorId: manager.actorId, before, result, recordedAt: this.clock().toISOString() };
        await tx.operationLog.create({ data: { id: this.receiptId(manager, key, input.operationKey), tenantId: manager.tenantId,
          workspaceId: manager.workspaceId, userId: manager.actorId, action, detail } });
        await this.recheck(manager);
        return detail;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
      await this.recheck(manager);
      return { state: 'observed' as const, operationKey: input.operationKey, result: receipt.result,
        recordedAt: receipt.recordedAt, execution: 'not_attested' as const, retryable: false as const };
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      // A failed COMMIT response is not proof of rollback. Only operation() may
      // observe the original audit; this service never automatically resends.
      return { state: 'unknown' as const, operationKey: input.operationKey, retryable: false as const,
        execution: 'not_attested' as const, nextAction: 'read_original_policy_operation' as const };
    }
  }
}

/** Explicit, inert server assembly. The request credential is kept only for this
 * call and destroyed in finally; neither a tenant ID nor manager identity may
 * arrive in policy commands. This is not an AppModule or HTTP registration. */
export function createClientTaskPolicyManagementApplication(input: {
  db: Db; guard: Pick<ApiAuthGuard, 'canActivate'>; scene: AiClientTaskScene;
  enabled?: boolean; clock?: () => Date;
  /** The existing workspace plan-policy producer, with actual current Auth.
   * Management is separate from the customer execution gate and model budget. */
  modelPlan?: { db: ConstructorParameters<typeof PrismaTaskPlanPolicyRepository>[0];
    auth: Pick<AuthService, 'resolveAccessContext'> };
}) {
  const scene = Object.freeze(parse(clientTaskSceneSchema, input.scene)), enabled = input.enabled === true;
  const modelPlan = input.modelPlan ? { db: input.modelPlan.db, auth: input.modelPlan.auth } : undefined;
  const credentialSchema = z.object({ authorization: z.string().min(1).max(8192),
    requestId: z.string().min(1).max(191), audience: z.literal('operator') }).strict();
  const call = async <T>(request: unknown, consume: (service: HumanClientTaskPolicyManagementService,
    credentials: AiOrderRouteCredentialSource) => Promise<T>) => {
    if (!enabled) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    let credential: z.infer<typeof credentialSchema> | undefined = parse(credentialSchema, request);
    const credentials: AiOrderRouteCredentialSource = { current: async () => {
      if (!credential) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return structuredClone(credential);
    } };
    const service = new HumanClientTaskPolicyManagementService(input.db, input.guard, credentials, scene, input.clock);
    try { return await consume(service, credentials); }
    finally { credential = undefined; }
  };
  const plan = (credentials: AiOrderRouteCredentialSource) => {
    if (!modelPlan || !Object.is(modelPlan.db, input.db) || typeof modelPlan.auth?.resolveAccessContext !== 'function')
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return new PrismaTaskPlanPolicyRepository(modelPlan.db, { auth: modelPlan.auth, credentials, guard: input.guard,
      scene: { code: scene.sceneCode, version: scene.sceneVersion }, tool: TASK_TEXT_MODEL_TOOL }, input.clock);
  };
  return Object.freeze({
    // No caller-controlled scope/scene/tool or automatic plan enablement. A plan
    // update neither grants customer execution nor validates a provider/budget.
    readModelPlan: (request: unknown) => call(request, async (_service, credentials) => ({
      ...await plan(credentials).read(), execution: 'not_attested' as const })),
    changeModelPlan: (request: unknown, value: unknown) => {
      const command = structuredClone(value);
      return call(request, async (_service, credentials) => ({ ...await plan(credentials).put(command),
        execution: 'not_attested' as const }));
    },
    read: (request: unknown, value: unknown) => call(request, service => service.read(structuredClone(value))),
    change: (request: unknown, value: unknown) => call(request, service => service.change(structuredClone(value))),
    operation: (request: unknown, value: unknown) => call(request, service => service.operation(structuredClone(value)))
  });
}
