import { randomUUID } from 'node:crypto';
import { Module, type DynamicModule } from '@nestjs/common';
import { z } from 'zod';
import { AI_INSPECTION_TASK_POLICY_OPERATIONS } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../common/request-identity';
import { AiTaskRepositoryError, aiTaskAccessFromContext } from './ai-task.repository';
import { AiScopeRepository } from './ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from './task-current-identity.authority';
import { PrismaTaskActionPolicyRepository } from './prisma-task-action-policy.repository';
import { originalIdentityHash } from './task-request/original-request.authority';
import { freezeOriginalInput } from './task-request/original-request.validation';
import { InspectionActionAuthority } from './inspection-assist/inspection-action.authority';
import { InspectionRecognitionTaskApplication, type InspectionRecognitionTaskDependencies } from './inspection-assist/inspection-recognition-task.application';
import { inspectionId, inspectionTargetSchema } from './inspection-assist/inspection-assist.validation';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

// These policies only enable the existing candidate runtime, never inspection
// submission, approval or an arbitrary business/model tool.
const operations = AI_INSPECTION_TASK_POLICY_OPERATIONS;
const referenceSchema = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId,
  inputId: inspectionId, expectedRevision: z.number().int().min(1).max(999) }).strict();
const base = z.object({ reference: referenceSchema, operation: z.enum(operations) }).strict();
const revision = z.number().int().min(1).max(4294967293);
const configure = base.extend({ expectedRevision: revision.nullable() }).strict();
const clear = base.extend({ expectedRevision: revision }).strict();
type Request = { headers: { authorization?: unknown } };
export type StaffInspectionTaskPolicyOptions = {
  enabled: boolean;
  /** Trusted installation selection, not a request permission list. */
  operations: readonly (typeof operations)[number][];
  ttlMs: number;
};
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

/** Explicit opt-in issuance for the SAME staff owner and original inspection.
 * The original pickup/return bind permission authorizes candidate work only.
 * It does not authorize configuring platform policies or submitting Core.
 * Real creation/source/Guard/identity are reconstructed from shared dependencies,
 * not supplied by a caller's authorized:true or taskId. No automatic seed. */
export function composeStaffInspectionTaskPolicies(dependencies: InspectionRecognitionTaskDependencies,
  options: StaffInspectionTaskPolicyOptions) {
  const selected = freezeOriginalInput(z.object({ enabled: z.literal(true),
    operations: z.array(z.enum(operations)).min(1).max(operations.length)
      .refine(values => new Set(values).size === values.length),
    ttlMs: z.number().int().min(1).max(120000) }).strict().parse(structuredClone(options)));
  const server = { ...dependencies, model: { ...dependencies.model }, inspection: { ...dependencies.inspection },
    limits: structuredClone(dependencies.limits) };
  if (server.enabled !== true) throw unavailable();
  const source = new InspectionRecognitionTaskApplication(server);
  const { db, auth, guard } = server.model, clock = server.model.clock ?? (() => new Date());
  const use = (request: Request, value: unknown, mode: 'read' | 'configure' | 'clear', signal?: AbortSignal) => {
    const schema = mode === 'read' ? base : mode === 'configure' ? configure : clear;
    const parsed = schema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const command = freezeOriginalInput(parsed.data);
    if (!selected.operations.includes(command.operation)) throw unavailable();
    const authorization = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u)
      .safeParse(request?.headers?.authorization);
    if (!authorization.success) throw denied();
    const currentRequest = freezeOriginalInput({ headers: { authorization: authorization.data } });
    return runWithRequestIdentity({}, async () => {
      let active = true;
      const close = () => { active = false; };
      signal?.addEventListener('abort', close, { once: true });
      try {
      if (signal?.aborted) throw denied();
      const credentials = { current: async () => {
        if (!active || signal?.aborted) throw denied();
        return { authorization: authorization.data, audience: 'staff' as const, requestId };
      } }, requestId = randomUUID();
      const scopes = new AiScopeRepository(db, new AiTaskCurrentIdentityAuthority(auth, credentials, clock), clock);
      const resource = new InspectionActionAuthority(guard, credentials);
      let expected: string | undefined;
      const resolve = async () => {
        const before = await scopes.resolveCurrent(), context = before.context;
        if (before.scope.kind !== 'WORKSPACE' || context.scope.kind !== 'workspace'
          || context.audience !== 'staff' || context.actor.kind !== 'user') throw denied();
        const receipt = await source.readCreation(currentRequest, command.reference, signal);
        if (receipt.state !== 'observed' || !receipt.task) throw unavailable();
        const taskId = receipt.task.taskId, runId = receipt.task.runId;
        await resource.withAction(command.reference, 'bind', async actor => {
          if (context.actor.kind !== 'user' || actor.ownerId !== context.actor.userId
            || actor.audience !== 'staff' || actor.tenantId !== before.scope.tenantId
            || actor.workspaceId !== before.scope.workspaceId) throw denied();
        });
        const access = aiTaskAccessFromContext(context, taskId, clock());
        const task = await db.aiTask.findFirst({ where: { AND: [access.where, { scopeId: before.scope.id }] } });
        const run = await db.aiRun.findFirst({ where: { id: runId, taskId, scopeId: before.scope.id,
          actorKind: access.actorKind, actorId: access.actorId } });
        if (!task || task.id !== taskId || task.scopeId !== before.scope.id || task.ownerKind !== 'USER'
          || task.ownerId !== access.actorId || task.audience !== 'STAFF' || task.archivedAt !== null
          || task.inputRef !== command.reference.inputId || task.inputRevision !== command.reference.expectedRevision
          || !run || run.id !== runId || run.sequence !== 1) throw denied();
        const plan = structuredClone(await db.aiTaskPlanPolicy.findFirst({ where: {
          scopeId: before.scope.id, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion } }));
        if (!plan || !plan.enabled || plan.scopeId !== before.scope.id || plan.sceneCode !== task.sceneCode
          || plan.sceneVersion !== task.sceneVersion || !(plan.expiresAt instanceof Date)
          || !Number.isFinite(plan.expiresAt.getTime()) || plan.expiresAt <= clock()) throw unavailable();
        const permissions = ['rental-os:order:view', `rental-os:order:${command.reference.stage}`];
        if (!('access' in context) || permissions.some(code => !context.access.permissions.includes(code))) throw denied();
        const after = await scopes.resolveCurrent();
        if (after.scope.id !== before.scope.id || originalIdentityHash(after.context) !== originalIdentityHash(context)) throw denied();
        const binding = requestFingerprint({ identity: originalIdentityHash(context), scopeId: before.scope.id,
          taskId, runId, inputHash: task.inputHash, inputRevision: task.inputRevision, reference: command.reference,
          scene: { code: task.sceneCode, version: task.sceneVersion }, plan });
        if (expected !== undefined && binding !== expected) throw denied();
        expected = binding;
        return { context: after.context, taskId, permissions, expiresAt: plan.expiresAt };
      };
      const original = await resolve();
      const repository = new PrismaTaskActionPolicyRepository(db, scopes, {
        async resolve(taskId, action) {
          if (taskId !== original.taskId || action !== 'configure_action_policy') throw denied();
          return (await resolve()).context;
        }
      }, clock);
      // Save exact CAS evidence with the policy, not from a later current-row
      // read. This records neither inspection submission nor a new model grant.
      const result = mode === 'read' ? await repository.read(original.taskId, command.operation)
        : mode === 'clear' ? await repository.clear(original.taskId, command.operation, clear.parse(command).expectedRevision, true)
          : await repository.put({ taskId: original.taskId, operation: command.operation,
            requiredPermissions: original.permissions,
            expiresAt: new Date(Math.min(original.expiresAt.getTime(), clock().getTime() + selected.ttlMs)) },
          configure.parse(command).expectedRevision, true);
      try { await resolve(); }
      catch (error) {
        if (mode !== 'read') throw Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN', retryable: false });
        throw error;
      }
      return freezeOriginalInput({ result, purpose: 'original_inspection_candidate_runtime_only' as const,
        approval: 'not_granted' as const, inspectionSubmission: 'not_attempted' as const });
      } finally { signal?.removeEventListener('abort', close); close(); }
    });
  };
  return Object.freeze({ read: (request: Request, value: unknown, signal?: AbortSignal) => use(request, value, 'read', signal),
    configure: (request: Request, value: unknown, signal?: AbortSignal) => use(request, value, 'configure', signal),
    clear: (request: Request, value: unknown, signal?: AbortSignal) => use(request, value, 'clear', signal) });
}

export const AI_STAFF_INSPECTION_TASK_POLICIES = Symbol('AI_STAFF_INSPECTION_TASK_POLICIES');
@Module({})
export class StaffInspectionTaskPolicyModule {
  static register(dependencies: InspectionRecognitionTaskDependencies, options?: StaffInspectionTaskPolicyOptions): DynamicModule {
    if (options?.enabled !== true) return { module: StaffInspectionTaskPolicyModule, providers: [], exports: [] };
    return { module: StaffInspectionTaskPolicyModule, providers: [{ provide: AI_STAFF_INSPECTION_TASK_POLICIES,
      useValue: composeStaffInspectionTaskPolicies(dependencies, options) }], exports: [AI_STAFF_INSPECTION_TASK_POLICIES] };
  }
}
