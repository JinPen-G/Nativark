/** Request-bound original AUTOMATION Task authority. Current automated use and
 * human observation are separate ports. The original source/policy, task action
 * grants and Core access remain mandatory; this leaf grants no user identity,
 * action policy, model budget, lease or business execution. */
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_EVENTS_DRAFT_VERSION, AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT,
  type AiBusinessEventDraft, type AiExecutionContext } from '@rental-os/shared';
import { hasEffectivePermission } from '../../../common/permission-match';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskRepository, AiTaskRepositoryError, aiTaskAccessFromContext,
  type AiTaskRepositoryAuthority, type AiTaskRepositoryOperation } from '../ai-task.repository';
import { aiPersistenceScopeColumns } from '../persistence-scope';
import { aiPersistedPlanToolsSchema } from '../runner/prisma-task-plan-input.source';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import type { CurrentPersistentTaskAuthorization } from '../runner/authorized-persistent-task-input.composition';
import type { BusinessFailureReadAuthority, FailureSource } from '../business-events/business-failure-read.authority';
import type { PrismaAutomationAuthority } from './prisma-automation.authority';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u), uuid = z.string().uuid();
const revision = z.number().int().min(1).max(4294967294), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.date().refine(value => Number.isFinite(value.getTime()));
export const automationTaskModelReferenceSchema = z.object({ inputRef: uuid, taskId: uuid, runId: uuid }).strict();
export type AutomationTaskModelReference = z.infer<typeof automationTaskModelReferenceSchema>;
const payloadSchema = z.object({ version: z.literal('automation-input-1'), trust: z.literal('untrusted_data'),
  purpose: z.literal('review_only'), mode: z.enum(['shadow', 'manual_confirmation']), event: z.unknown(),
  subject: z.object({ id: id.max(36), authorizationRevision: revision }).strict(),
  policy: z.object({ id: id.max(36), revision, sceneCode: id.max(64), sceneVersion: id.max(64) }).strict(),
  authorityHash: hash }).strict();
const readOperations: readonly AiTaskRepositoryOperation[] = ['read_metadata', 'read_events', 'read_step_terminal'];
const operations: readonly AiTaskRepositoryOperation[] = [...readOperations, 'claim_run', 'claim_recovery_run',
  'release_run', 'transition_task', 'takeover_run'];
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(structuredClone(value));
  if (!parsed.success) throw denied();
  return parsed.data;
};
const recordedHash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));
const principalHash = (context: AiExecutionContext) => requestFingerprint({ actor: context.actor,
  scope: context.scope, audience: context.audience, access: 'access' in context ? context.access : null });
const taskSelect = { id: true, scopeId: true, scopeKind: true, audience: true, ownerKind: true, ownerId: true,
  policyId: true, policyRevision: true, policyExpiresAt: true, sceneCode: true, sceneVersion: true,
  inputRef: true, inputRevision: true, inputHash: true, creationKey: true, creationFingerprint: true,
  traceId: true, contractVersion: true, status: true, revision: true, cancelRequestedAt: true, archivedAt: true } satisfies Prisma.AiTaskSelect;
const runSelect = { id: true, taskId: true, scopeId: true, sequence: true, actorKind: true, actorId: true,
  authorizedAt: true, createdAt: true, status: true, revision: true } satisfies Prisma.AiRunSelect;

/** The existing source already resolves the current registered subject, policy,
 * original human resource Guard, entitlement and all scope budget gates. No
 * mock/default resolver is supplied. Model-step publication remains subject to
 * that original source's registered tool gate. */
export interface AutomationTaskModelCurrentSource extends Pick<PrismaAutomationAuthority, 'input'> {}
export interface AutomationTaskModelAuthorityDependencies {
  db: PrismaClient;
  source: AutomationTaskModelCurrentSource;
  reads: Pick<BusinessFailureReadAuthority, 'current' | 'withEvent' | 'withOriginalEvent'>;
  original: AutomationTaskModelReference;
  clock?: () => Date;
}
export type AutomationTaskModelOrigin = {
  original: AutomationTaskModelReference; scopeId: string; scope: { tenantId: string; workspaceId: string };
  subjectId: string; authorizationRevision: number; policyId: string; policyRevision: number;
  expiresAt: string; sceneCode: string; sceneVersion: string; creationKey: string;
  inputHash: string; authorityHash: string; event: AiBusinessEventDraft;
  mode: 'shadow' | 'manual_confirmation'; bindingHash: string;
};
export type AutomationTaskModelCurrent = {
  origin: AutomationTaskModelOrigin; context: Extract<AiExecutionContext, { audience: 'automation' }>;
  source: FailureSource; sourceHash: string;
  plan: { revision: number; limits: z.infer<typeof aiTaskRunnerLimitsSchema>; expiresAt: string };
  authorizationKey: string;
};

export class AutomationTaskModelAuthority implements AiTaskRepositoryAuthority {
  readonly original: AutomationTaskModelReference;
  private readonly clock: () => Date;
  constructor(private readonly dependencies: AutomationTaskModelAuthorityDependencies) {
    const original = automationTaskModelReferenceSchema.safeParse(dependencies?.original);
    if (!original.success || typeof dependencies.db?.aiTask?.findFirst !== 'function'
      || typeof dependencies.db.aiRun?.findFirst !== 'function' || typeof dependencies.db.aiScope?.findFirst !== 'function'
      || typeof dependencies.db.aiAutomationInput?.findFirst !== 'function' || typeof dependencies.source?.input !== 'function'
      || typeof dependencies.reads?.current !== 'function' || typeof dependencies.reads.withEvent !== 'function'
      || typeof dependencies.reads.withOriginalEvent !== 'function') throw unavailable();
    this.original = Object.freeze(original.data);
    this.clock = dependencies.clock ?? (() => new Date());
  }
  private now() { return parse(date, this.clock()); }
  private async originalTarget() {
    const d = this.dependencies, human = await d.reads.current(), now = this.now();
    if (human.context.actor.kind !== 'user' || human.context.scope.kind !== 'workspace'
      || !['operator', 'staff'].includes(human.context.audience) || !('access' in human.context)) throw denied();
    const scope = human.scope, columns = aiPersistenceScopeColumns(human.context.scope);
    if (scope.tenantId !== human.context.scope.tenantId || scope.workspaceId !== human.context.scope.workspaceId) throw denied();
    const row = structuredClone(await d.db.aiAutomationInput.findFirst({ where: { id: this.original.inputRef, ...scope } }));
    if (!row || row.id !== this.original.inputRef || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId
      || row.inputRevision !== 1 || !revision.safeParse(row.reviewRevision).success
      || !['prepared', 'creation_unknown', 'linked'].includes(row.status) || !['open', 'closed'].includes(row.reviewStatus)
      || !date.safeParse(row.expiresAt).success || !hash.safeParse(row.inputHash).success
      || !hash.safeParse(row.authorityHash).success || requestFingerprint(row.payload) !== row.inputHash) throw denied();
    const payload = parse(payloadSchema, row.payload);
    if (payload.authorityHash !== row.authorityHash || payload.subject.id !== row.subjectId
      || payload.subject.authorizationRevision !== row.authorizationRevision || payload.policy.id !== row.policyId
      || payload.policy.revision !== row.policyRevision || payload.policy.sceneCode !== row.sceneCode
      || payload.policy.sceneVersion !== row.sceneVersion || row.creationKey !== requestFingerprint({ version: 'automation-creation-1',
        ...scope, policyId: row.policyId, policyRevision: row.policyRevision, eventId: row.eventId,
        sceneCode: row.sceneCode, sceneVersion: row.sceneVersion })) throw denied();
    const storedScope = await d.db.aiScope.findFirst({ where: { id: row.scopeId, ...columns } });
    if (!storedScope || storedScope.id !== row.scopeId
      || Object.entries(columns).some(([key, value]) => storedScope[key as keyof typeof storedScope] !== value)) throw denied();
    const event = structuredClone(await d.db.aiBusinessFailureOutbox.findFirst({ where: { id: row.eventId, ...scope } }));
    if (!event || event.id !== row.eventId || event.tenantId !== scope.tenantId || event.workspaceId !== scope.workspaceId
      || event.resourceRevision !== row.resourceRevision || event.deduplicationKey !== row.deduplicationKey) throw denied();
    const task = structuredClone(await d.db.aiTask.findFirst({ where: { id: this.original.taskId, scopeId: row.scopeId }, select: taskSelect }));
    const expected = { id: this.original.taskId, scopeId: row.scopeId, scopeKind: 'WORKSPACE', audience: 'AUTOMATION',
      ownerKind: 'AUTOMATION', ownerId: row.subjectId, policyId: row.policyId, policyRevision: row.policyRevision,
      inputRef: row.id, inputRevision: 1, inputHash: row.inputHash, creationKey: row.creationKey,
      sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, contractVersion: AI_TASK_DRAFT_VERSION, traceId: row.id };
    if (!task || Object.entries(expected).some(([key, value]) => task[key as keyof typeof task] !== value)
      || !date.safeParse(task.policyExpiresAt).success || task.policyExpiresAt!.getTime() !== row.expiresAt.getTime()
      || !revision.safeParse(task.revision).success || !AI_TASK_STATUSES_DRAFT.includes(task.status.toLowerCase() as typeof AI_TASK_STATUSES_DRAFT[number])) throw denied();
    const ownershipBindingKey = JSON.stringify([columns, 'automation', 'AUTOMATION', row.subjectId,
      [row.policyId, row.policyRevision, row.expiresAt.toISOString()]]);
    if (task.creationFingerprint !== requestFingerprint({ version: 'ai-task-creation-1', scope: columns,
      audience: 'AUTOMATION', ownerKind: 'AUTOMATION', ownerId: row.subjectId, authorizationBinding: ownershipBindingKey,
      sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, inputRef: row.id, inputRevision: 1, inputHash: row.inputHash })) throw denied();
    const run = structuredClone(await d.db.aiRun.findFirst({ where: { id: this.original.runId, scopeId: row.scopeId, taskId: task.id }, select: runSelect }));
    if (!run || run.id !== this.original.runId || run.taskId !== task.id || run.scopeId !== row.scopeId || run.sequence !== 1
      || run.actorKind !== 'AUTOMATION' || run.actorId !== row.subjectId || !date.safeParse(run.authorizedAt).success
      || !date.safeParse(run.createdAt).success || run.createdAt > now || run.createdAt >= row.expiresAt
      || run.authorizedAt > now || run.authorizedAt >= row.expiresAt || !revision.safeParse(run.revision).success
      || row.status === 'linked' && (row.taskId !== task.id || row.runId !== run.id)
      || row.status !== 'linked' && (row.taskId !== null || row.runId !== null)) throw denied();
    const binding = { ...expected, policyExpiresAt: row.expiresAt.toISOString(), creationFingerprint: task.creationFingerprint,
      subjectRevision: row.authorizationRevision, authorityHash: row.authorityHash, payload: row.payload,
      run: { id: run.id, scopeId: run.scopeId, taskId: run.taskId, actorKind: run.actorKind, actorId: run.actorId,
        // Claims update authorizedAt. The immutable creation time binds the
        // original Run without changing published material at each lease claim.
        sequence: run.sequence, createdAt: run.createdAt.toISOString() } };
    const humanHash = principalHash(human.context);
    if (principalHash((await d.reads.current()).context) !== humanHash) throw denied();
    return { row, payload, task, run, event, human, humanHash, columns, ownershipBindingKey,
      originHash: recordedHash(binding) };
  }
  private origin(target: Awaited<ReturnType<AutomationTaskModelAuthority['originalTarget']>>, event: AiBusinessEventDraft): AutomationTaskModelOrigin {
    const row = target.row;
    if (event.draftVersion !== AI_EVENTS_DRAFT_VERSION || requestFingerprint(event) !== requestFingerprint(target.payload.event)) throw denied();
    return { original: { ...this.original }, scopeId: row.scopeId, scope: { ...target.human.scope }, subjectId: row.subjectId,
      authorizationRevision: row.authorizationRevision, policyId: row.policyId, policyRevision: row.policyRevision,
      expiresAt: row.expiresAt.toISOString(), sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
      creationKey: row.creationKey, inputHash: row.inputHash, authorityHash: row.authorityHash, event: structuredClone(event),
      mode: target.payload.mode, bindingHash: target.originHash };
  }
  async withOriginalRead<T>(read: (origin: AutomationTaskModelOrigin) => Promise<T>,
    revalidate?: (origin: AutomationTaskModelOrigin) => Promise<void>): Promise<T> {
    const before = await this.originalTarget();
    const target = async (event: AiBusinessEventDraft) => {
      const current = await this.originalTarget();
      if (current.originHash !== before.originHash || current.humanHash !== before.humanHash) throw denied();
      return this.origin(current, event);
    };
    return this.dependencies.reads.withOriginalEvent(before.event, async event => {
      const result = await read(await target(event)); await target(event); return result;
    }, undefined, async event => { const original = await target(event); await revalidate?.(original); await target(event); });
  }
  /** Exact original owner projection exclusively for AiTaskResultRepository.
   * Current human Guard authorization encloses it. No automation context is
   * renewed or returned to a lease/executor, including after policy expiry. */
  async originalReadAccess(taskId: string, operation: AiTaskRepositoryOperation): Promise<ReturnType<typeof aiTaskAccessFromContext>> {
    if (taskId !== this.original.taskId || !readOperations.includes(operation)) throw denied();
    return this.withOriginalRead(async () => {
      const target = await this.originalTarget(), row = target.row;
      return { where: { id: taskId, scopeId: row.scopeId, scopeKind: 'WORKSPACE', audience: 'AUTOMATION',
        ownerKind: 'AUTOMATION', ownerId: row.subjectId, policyId: row.policyId, policyRevision: row.policyRevision,
        policyExpiresAt: row.expiresAt, inputRef: row.id, inputHash: row.inputHash, creationKey: row.creationKey, archivedAt: null },
        now: this.now(), authorizedAt: target.run.authorizedAt, actorKind: 'AUTOMATION', actorId: row.subjectId,
        bindingKey: requestFingerprint({ original: target.originHash, currentHuman: target.humanHash }),
        ownershipBindingKey: target.ownershipBindingKey, scope: target.columns, audience: 'AUTOMATION',
        actor: { kind: 'automation', subjectId: row.subjectId, policyId: row.policyId, policyRevision: row.policyRevision,
          expiresAt: row.expiresAt.toISOString() }, requestId: row.id };
    });
  }
  async inspectCurrent(operation: AiTaskRepositoryOperation = 'read_metadata'): Promise<AutomationTaskModelCurrent> {
    if (!operations.includes(operation)) throw denied();
    return this.inspectUse(operation);
  }
  /** Only the explicit first-start application consumes this pre-policy proof.
   * It still verifies the registered subject, original event, current human
   * resource access, plan and budget. It cannot resolve a runner operation. */
  inspectInitialStart(): Promise<AutomationTaskModelCurrent> { return this.inspectUse(); }
  private async inspectUse(operation?: AiTaskRepositoryOperation): Promise<AutomationTaskModelCurrent> {
    const d = this.dependencies, before = await this.originalTarget();
    const observe = async () => {
      const resolved = structuredClone(await d.source.input(this.original.inputRef));
      const current = await this.originalTarget(), snapshot = resolved.snapshot, context = snapshot.context;
      if (current.originHash !== before.originHash || current.humanHash !== before.humanHash || context.audience !== 'automation'
        || context.actor.kind !== 'automation' || context.scope.kind !== 'workspace' || !('access' in context)
        || context.actor.subjectId !== current.row.subjectId || context.actor.policyId !== current.row.policyId
        || context.actor.policyRevision !== current.row.policyRevision || context.actor.expiresAt !== current.row.expiresAt.toISOString()
        || context.scope.tenantId !== current.row.tenantId || context.scope.workspaceId !== current.row.workspaceId
        || resolved.row.id !== current.row.id || resolved.row.inputHash !== current.row.inputHash
        || snapshot.authorityHash !== current.row.authorityHash || snapshot.inputHash !== current.row.inputHash
        || snapshot.scopeId !== current.row.scopeId || snapshot.creationKey !== current.row.creationKey
        || current.row.reviewStatus !== 'open' || current.task.archivedAt !== null || current.task.cancelRequestedAt !== null) throw denied();
      const access = aiTaskAccessFromContext({ ...context, requestId: current.row.id }, current.task.id, this.now());
      const policyKey = operation === undefined ? undefined : { scopeId: current.row.scopeId, taskId: current.task.id, operation };
      const action = policyKey === undefined ? undefined
        : structuredClone(await d.db.aiTaskActionPolicy.findUnique({ where: { scopeId_taskId_operation: policyKey } }));
      if (policyKey && (!action || Object.entries(policyKey).some(([key, value]) => action[key as keyof typeof action] !== value)
        || !revision.safeParse(action.revision).success || !date.safeParse(action.expiresAt).success || action.expiresAt <= this.now()
        || !Array.isArray(action.requiredPermissions) || !action.requiredPermissions.length || action.requiredPermissions.length > 64
        || new Set(action.requiredPermissions).size !== action.requiredPermissions.length
        || action.requiredPermissions.some(permission => !id.safeParse(permission).success
          || !hasEffectivePermission(context.access.permissions, String(permission))))) throw denied();
      const planKey = { scopeId: current.row.scopeId, sceneCode: current.row.sceneCode, sceneVersion: current.row.sceneVersion };
      const plan = structuredClone(await d.db.aiTaskPlanPolicy.findFirst({ where: planKey }));
      if (!plan || Object.entries(planKey).some(([key, value]) => plan[key as keyof typeof plan] !== value)
        || plan.enabled !== true || !revision.safeParse(plan.revision).success || !date.safeParse(plan.expiresAt).success
        || plan.expiresAt <= this.now()) throw unavailable();
      const tools = aiPersistedPlanToolsSchema.parse(plan.allowedTools), limits = aiTaskRunnerLimitsSchema.parse(plan.limits);
      if (!tools.some(tool => tool.code === 'ai.model.text') || limits.maxStepMs > limits.maxTotalMs) throw unavailable();
      const source = await d.reads.withEvent(current.event, async value => structuredClone(value));
      const resource = source.resourceEvent ?? snapshot.payload.event;
      const origin = this.origin(current, resource as AiBusinessEventDraft);
      if (!source.failed || source.revision !== current.row.resourceRevision || source.orderId !== current.event.orderId
        || Date.parse(origin.expiresAt) <= this.now().getTime()) throw unavailable();
      return { origin, context: { ...context, requestId: current.row.id }, source,
        sourceHash: requestFingerprint(source), plan: { revision: plan.revision, limits, expiresAt: plan.expiresAt.toISOString() },
        authorizationKey: requestFingerprint({ original: current.originHash, access: access.bindingKey,
          ...(action ? { action: { ...policyKey, revision: action.revision, permissions: action.requiredPermissions,
            expiresAt: action.expiresAt.toISOString() } } : {}),
          plan: { ...planKey, revision: plan.revision, limits, tools, expiresAt: plan.expiresAt.toISOString() },
          source, authorityHash: current.row.authorityHash }) } as AutomationTaskModelCurrent;
    };
    const first = await observe(), last = await observe();
    if (first.authorizationKey !== last.authorizationKey || first.sourceHash !== last.sourceHash) throw denied();
    if (principalHash((await d.reads.current()).context) !== before.humanHash) throw denied();
    return last;
  }
  async resolve(taskId: string, operation: AiTaskRepositoryOperation): Promise<AiExecutionContext> {
    if (taskId !== this.original.taskId) throw denied();
    return (await this.inspectCurrent(operation)).context;
  }
  currentAuthorization(): CurrentPersistentTaskAuthorization {
    const scopes = new AiScopeRepository(this.dependencies.db, { resolve: () => this.resolve(this.original.taskId, 'read_metadata') }, this.clock);
    const tasks = new AiTaskRepository(this.dependencies.db, this, this.clock);
    return { scopes, authority: this, tasks, execution: { authorize: async taskId => {
      const current = await this.inspectCurrent('transition_task');
      if (taskId !== this.original.taskId) throw denied();
      return current.context;
    } } };
  }
}
