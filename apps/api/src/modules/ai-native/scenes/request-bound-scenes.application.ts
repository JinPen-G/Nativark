import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { PrismaQuoteSelectionRepository, type HumanQuoteSelectionDependencies } from '../task-request/prisma-quote-selection.repository';
import { composeAiOriginalScenes, type AiOriginalSceneDependencies } from './original-scenes.composition';
import { composeHumanQuoteOrder, composeSelectedQuoteTaskApplication, type SelectedQuoteTaskConfiguration, type HumanQuoteOrderDependencies } from './human-quote-order.composition';
import { composeAiOriginalSceneModel, composeOriginalSceneClarificationSource, type AiOriginalSceneModelDependencies, type AiOriginalSceneRunDependencies } from './original-scene-model.composition';
import { waitForTaskApplicationDependency, type AiTaskApplicationHost } from '../runner/prisma-task-application';
import { composeFormalApprovedOrderReprepareServices, type FormalApprovedOrderReprepareConfiguration } from '../approval-execution/formal-approved-order-reprepare.composition';
import { composePersistedTaskCenter } from '../task-center.composition';
import { composeAiTaskCenterScene } from '../task-center-scene.composition';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { AiOriginalSceneRecoveryService } from './original-scene-recovery.service';
import { composeTaskSettingsHost, type AiSettingsTask } from '../runner/settings-task-host.composition';
import { composeApprovedSettingsApplication } from '../approval-execution/approved-settings-application.composition';
import { aiTaskRunPlanSchema } from '../runner/prisma-task-run-evidence.repository';
import { settingsChangeReferenceSchema } from '../../rental-core/approved-settings-change.validation';
import { prepareSettingsChangeSchema } from '../../rental-core/approved-settings-change.validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ApprovedSettingsRouteAuthority } from '../../rental-core/approved-settings-route.authority';
import { AiTaskCreationRepository } from '../ai-task-creation.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { AiScopeRepository } from '../ai-scope.repository';
import { PrismaSubscriptionBudgetReader } from '../budget/prisma-subscription-budget-reader';
import { aiPersistedPlanToolsSchema } from '../runner/prisma-task-plan-input.source';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { composeAiSettingsBusinessConsumer } from './settings-business-consumer.composition';
import type { ApprovedSettingsApplicationDependencies } from '../approval-execution/approved-settings-task.authority';
import { originalRequestReferenceSchema, freezeOriginalInput } from '../task-request/original-request.validation';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { composePersistedTaskCallGateway, composePersistedTaskGateway, composePersistedTaskAccountingRecovery,
  type PersistedTaskCallGatewayDependencies, type PersistedTaskGatewayDependencies } from '../task-model-gateway.composition';
import { BudgetError } from '../budget/budget.ports';
import { presentTaskBudgetUsageRecord } from '../budget/task-budget-usage.reader';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import type { AiTaskInputSource } from '../task-input/task-input.ports';
import { parseQuoteSelection } from '../task-request/quote-selection.validation';
import { composeTaskActionPolicyManagement } from '../task-action-policy-management.composition';
import { taskActionPolicyOperations, type AiTaskActionPolicyMutation } from '../prisma-task-action-policy.repository';
import { PrismaTaskTakeoverRepository } from '../runner/prisma-task-takeover.repository';
import { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import { PrismaTaskPlanPolicyRepository } from '../runner/prisma-task-plan-policy.repository';
import { PrismaTaskRecoverySnapshotRepository } from '../runner/prisma-task-recovery-snapshot.repository';
import { AI_TASK_RECOVERY_READ_VERSION, AI_APPROVED_SETTINGS_TOOL_CODE, AI_TOOL_DRAFT_VERSION,
  isAiTaskInputSubmissionDraft, type AiSceneModelRecoverySnapshotReadResponse, type AiOriginalTaskAccountingResponseDraft } from '@rental-os/shared';
import { PrismaTaskInputRepository, readTaskModelRunOrigin } from '../task-input/prisma-task-input.repository';
import { AiOriginalSceneResultService } from './original-scene-result.service';
import { composeOriginalSceneKnowledge, type AiOriginalSceneKnowledgeOptions } from './original-scene-knowledge';
import { gatewayTextIntentBindingSchema } from '../gateway-intent';
import { composePersistedReadonlyBusinessTaskHost } from '../runner/persisted-catalog-runner.composition';

export type AiSceneHttpRequest = { headers: { authorization?: unknown } };
export type AiSceneRequestOptions = { enabled: boolean; audience: 'operator' | 'staff' };
export type AiOriginalTaskActionPolicyOptions = AiSceneRequestOptions & {
  /** Explicit server configuration. No client permission lists or automatic
   * action-policy creation. The current owner must also pass config Guard. */
  templates: readonly Pick<AiTaskActionPolicyMutation, 'operation' | 'requiredPermissions'>[];
  ttlMs: number;
};
export type AiScenePlanPolicyConfiguration = AiSceneRequestOptions & {
  scenes: readonly { scene: { code: string; version: string };
    tools: NonNullable<ConstructorParameters<typeof PrismaTaskPlanPolicyRepository>[1]['tools']> }[];
};
export type RequestBoundOriginalSceneDependencies = Omit<AiOriginalSceneDependencies, 'credentials'>;
export type RequestBoundOriginalSceneModelDependencies = Omit<AiOriginalSceneModelDependencies, 'credentials'>;
export type AiSettingsTaskRequestOptions = AiSceneRequestOptions & { host: AiTaskApplicationHost; task: AiSettingsTask };
/** Original business change preparation, before any Task exists. */
export function composeRequestBoundSettingsChanges(
  dependencies: Omit<ApprovedSettingsApplicationDependencies, 'credentials'>, options: AiSceneRequestOptions) {
  if (options.audience !== 'operator') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const call = bindRequests(dependencies, options, composeApprovedSettingsApplication);
  const read = prepareSettingsChangeSchema.pick({ changeKey: true });
  return Object.freeze({
    readCurrent: (request: AiSceneHttpRequest) => call(request, {}, app => app.readCurrent()),
    prepare: (request: AiSceneHttpRequest, value: unknown) => {
      const parsed = prepareSettingsChangeSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, freezeOriginalInput(parsed.data), async (app, command) => {
        const change = await app.prepareChange(command);
        return freezeOriginalInput({ change, task: 'not_created' as const, approval: 'not_granted' as const,
          activeSettings: 'not_modified' as const });
      });
    },
    readReceipt: (request: AiSceneHttpRequest, value: unknown) => {
      const parsed = read.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, freezeOriginalInput(parsed.data), (app, command) => app.readChangeReceipt(command));
    }
  });
}
export type AiSceneModelRequestOptions = AiSceneRequestOptions & {
  host: AiTaskApplicationHost;
  runServices: (dependencies: AiOriginalSceneModelDependencies) => AiOriginalSceneRunDependencies;
  /** Server-only business assembly. Never copied from a request body. */
  quoteTask?: { dependencies: RequestBoundQuoteOrderDependencies; configuration: SelectedQuoteTaskConfiguration };
  /** Server-only settings task assembly. It is never derived from a model or request body. */
  settingsTask?: { dependencies: Omit<ApprovedSettingsApplicationDependencies, 'credentials'>;
    configuration: { host: AiTaskApplicationHost; task: AiSettingsTask } };
};
export type RequestBoundQuoteSelectionDependencies = RequestBoundOriginalSceneDependencies & Omit<HumanQuoteSelectionDependencies, 'credentials' | 'originals'>;
export type RequestBoundQuoteOrderDependencies = RequestBoundOriginalSceneDependencies & Omit<HumanQuoteOrderDependencies, 'credentials' | 'originals'>;
const optionsSchema = z.object({ enabled: z.literal(true), audience: z.enum(['operator', 'staff']) }).strict();
const bearerSchema = z.string().min(1).max(8192).regex(/^Bearer [A-Za-z0-9._~+/-]+=*$/u);

/** Resolve the existing snapshot only from an authorized original reference.
 * This is not a run claim or business receipt. Keep its persisted cursor intact. */
async function readOriginalTaskSnapshot(scenes: Pick<ReturnType<typeof composeAiOriginalScenes>, 'requests' | 'readTaskReceipt'>,
  events: ReturnType<typeof composePersistedTaskCenter>['events'], value: unknown) {
  const parsed = originalRequestReferenceSchema.safeParse(structuredClone(value));
  if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const reference = freezeOriginalInput(parsed.data);
  const original = await scenes.requests.readHistorical(reference);
  const task = await scenes.readTaskReceipt(reference.inputRef);
  if (task.state !== 'observed' || original.receipt.state === 'revoked') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const snapshot = structuredClone(await events.readSnapshot({ taskId: task.taskId }));
  const after = await scenes.requests.readHistorical(reference);
  const latest = await scenes.readTaskReceipt(reference.inputRef);
  if (after.receipt.state === 'revoked' || originalIdentityHash(original.context) !== originalIdentityHash(after.context)
    || original.receipt.contentHash !== after.receipt.contentHash || latest.state !== 'observed'
    || latest.taskId !== task.taskId || latest.runId !== task.runId || latest.revision !== task.revision
    || snapshot.taskId !== task.taskId || snapshot.revision !== task.revision) {
    throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }
  return freezeOriginalInput(snapshot);
}

function bindRequests<D extends object, A>(dependencies: D, options: AiSceneRequestOptions,
  compose: (input: D & { credentials: AiTaskCredentialSource }, command: unknown) => A | Promise<A>) {
  const parsed = optionsSchema.safeParse(options);
  if (!parsed.success || 'credentials' in dependencies || 'originals' in dependencies) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const server = { ...dependencies }, { audience } = parsed.data;
  return async <R>(request: AiSceneHttpRequest, value: unknown, consume: (app: A, command: unknown) => Promise<R>): Promise<R> => {
    const header = bearerSchema.safeParse(request?.headers?.authorization);
    if (!header.success) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const command = structuredClone(value), credential = Object.freeze({ authorization: header.data, audience, requestId: randomUUID() });
    let active = true;
    try {
      return await runWithRequestIdentity({}, async () => consume(await compose({ ...server, credentials: {
        current: async () => {
          if (!active) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          return { ...credential };
        }
      } }, command), command));
    } finally { active = false; }
  };
}

/** Core-prepared immutable change -> existing metadata creation repository.
 * Neither creation nor receipt observation publishes a plan or grants actions. */
export function composeRequestBoundSettingsTaskCreation(
  dependencies: Omit<ApprovedSettingsApplicationDependencies, 'credentials'>, options: AiSceneRequestOptions) {
  const scene = freezeOriginalInput(z.object({ code: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    version: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict().parse(structuredClone(dependencies.scene)));
  const schema = z.object({ creationKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    changeKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
  const call = bindRequests({ ...dependencies, scene }, options, input => input);
  const use = (request: AiSceneHttpRequest, value: unknown, creating: boolean) => {
    const parsed = schema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return call(request, parsed.data, async (input, value) => {
      const command = schema.parse(value), clock = input.clock ?? (() => new Date());
      const scopes = new AiScopeRepository(input.db, new AiTaskCurrentIdentityAuthority(input.auth, input.credentials, clock), clock);
      const route = new ApprovedSettingsRouteAuthority(input.guard, input.credentials);
      const app = composeApprovedSettingsApplication(input);
      const entitlements = new PrismaSubscriptionBudgetReader(input.db, input.subscriptions, clock);
      let expectedPolicy: string | undefined;
      const read = () => route.withAuthorization(creating ? 'write' : 'read', async (actor, revalidate) => {
        const before = await scopes.resolveCurrent();
        if (before.scope.kind !== 'WORKSPACE' || before.context.actor.kind !== 'user'
          || before.context.actor.userId !== actor.actorId || before.scope.tenantId !== actor.tenantId
          || before.scope.workspaceId !== actor.workspaceId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const original = structuredClone(await app.readChangeReceipt({ changeKey: command.changeKey }));
        if (original.state !== 'prepared_not_approved') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const row = structuredClone(await input.db.rentalApprovedSettingsChange.findFirst({ where: { id: original.change.changeId, ...actor } }));
        if (!row || row.changeKey !== command.changeKey || row.changeHash !== original.change.changeHash)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        if (creating) {
          if (!(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt <= clock())
            throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const current = structuredClone(await input.core.readVersionedBusinessSettings(actor.tenantId));
          const workspace = structuredClone(await input.db.businessWorkspace.findFirst({ where: { id: actor.workspaceId, tenantId: actor.tenantId } }));
          if (current.settingsRevision !== row.baseRevision || requestFingerprint(current.settings) !== row.baseSettingsHash
            || !workspace || workspace.status !== 'ACTIVE' || workspace.categoryVersionId !== row.categoryVersionId
            || workspace.categoryAdoptionRevision !== row.categoryAdoptionRevision) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          const policy = structuredClone(await input.db.aiTaskPlanPolicy.findFirst({ where: { scopeId: before.scope.id, sceneCode: scene.code, sceneVersion: scene.version } }));
          const tools = aiPersistedPlanToolsSchema.safeParse(structuredClone(policy?.allowedTools));
          const limits = aiTaskRunnerLimitsSchema.safeParse(structuredClone(policy?.limits));
          if (!policy || policy.scopeId !== before.scope.id || policy.sceneCode !== scene.code || policy.sceneVersion !== scene.version
            || !Number.isInteger(policy.revision) || policy.revision < 1 || policy.revision > 4294967294
            || policy.enabled !== true || !(policy.expiresAt instanceof Date) || !Number.isFinite(policy.expiresAt.getTime())
            || policy.expiresAt <= clock() || !tools.success || !limits.success
            || !tools.data.some(tool => tool.code === AI_APPROVED_SETTINGS_TOOL_CODE)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const entitlement = await entitlements.read(actor.tenantId, 'ai.native.use');
          if (entitlement.entitlements.length !== 1 || entitlement.entitlements[0].code !== 'ai.native.use'
            || entitlement.entitlements[0].available !== true) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
          const hash = requestFingerprint({ scene, scopeId: before.scope.id, policyRevision: policy.revision,
            tools: tools.data, limits: limits.data, expiresAt: policy.expiresAt.toISOString(), entitlement });
          if (expectedPolicy !== undefined && expectedPolicy !== hash) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          expectedPolicy = hash;
        }
        await revalidate();
        const after = await scopes.resolveCurrent();
        if (before.scope.id !== after.scope.id || originalIdentityHash(before.context) !== originalIdentityHash(after.context))
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return { context: after.context, change: original.change };
      });
      const original = await read();
      const resolveOriginal = async (sceneCode: string, inputRef: string) => {
        if (sceneCode !== scene.code || inputRef !== original.change.changeId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const current = await read();
        if (original.change.changeId !== current.change.changeId || original.change.changeHash !== current.change.changeHash
          || originalIdentityHash(original.context) !== originalIdentityHash(current.context)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return { context: current.context, sceneCode: scene.code, sceneVersion: scene.version,
          // The immutable change row is revision one. Its business baseRevision
          // is already hash-bound and must not become a fabricated input revision.
          inputRef: current.change.changeId, inputRevision: 1, inputHash: current.change.changeHash };
      };
      const repository = creating ? new AiTaskCreationRepository(input.db, { resolve: async (sceneCode, inputRef) =>
        ({ ...await resolveOriginal(sceneCode, inputRef), creationAllowed: true as const }) }, clock)
        : AiTaskCreationRepository.receiptReader(input.db, { resolve: resolveOriginal }, clock);
      const target = { creationKey: command.creationKey, sceneCode: scene.code, inputRef: original.change.changeId };
      let receipt;
      try { receipt = creating && repository instanceof AiTaskCreationRepository
        ? await repository.create(target) : await repository.readCreation(target); }
      catch (error) {
        if (creating && error instanceof AiTaskRepositoryError && error.code === 'AI_STORAGE_UNAVAILABLE') {
          // The repository cannot prove a failed transaction reply was uncommitted.
          throw Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN', retryable: false });
        }
        throw error;
      }
      return freezeOriginalInput({ original: { changeId: original.change.changeId, changeHash: original.change.changeHash },
        receipt, execution: 'not_attested' as const, approval: 'not_granted' as const });
    });
  };
  return Object.freeze({
    create: (request: AiSceneHttpRequest, value: unknown) => use(request, value, true),
    read: (request: AiSceneHttpRequest, value: unknown) => use(request, value, false)
  });
}

/** Current original creation receipt -> explicit owner policy management/start.
 * No policy seed, caller permission list, lease or direct business commit. */
export function composeRequestBoundSettingsTaskControls(
  dependencies: Omit<ApprovedSettingsApplicationDependencies, 'credentials'>,
  options: AiOriginalTaskActionPolicyOptions & { host: AiTaskApplicationHost }) {
  if (options.audience !== 'operator') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const templates = freezeOriginalInput(z.array(z.object({
    operation: z.string().refine(value => taskActionPolicyOperations.includes(value)),
    requiredPermissions: z.array(z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)).min(1).max(64)
      .refine(values => new Set(values).size === values.length)
  }).strict()).min(1).max(taskActionPolicyOperations.length).parse(structuredClone(options.templates)));
  if (new Set(templates.map(row => row.operation)).size !== templates.length) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const ttlMs = z.number().int().min(1).max(120000).parse(options.ttlMs);
  const host = Object.freeze(structuredClone(options.host)), scene = freezeOriginalInput(structuredClone(dependencies.scene));
  const creation = composeRequestBoundSettingsTaskCreation({ ...dependencies, scene }, { enabled: options.enabled, audience: options.audience });
  const reference = z.object({ creationKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    changeKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
  const readSchema = reference.extend({ operation: z.string() }).strict();
  const writeSchema = readSchema.extend({ expectedRevision: z.number().int().min(1).max(4294967294).nullable() }).strict();
  const clearSchema = readSchema.extend({ expectedRevision: z.number().int().min(1).max(4294967293) }).strict();
  const cancellationSchema = reference.extend({ expectedRevision: z.number().int().min(1).max(4294967293) }).strict();
  const call = bindRequests({ ...dependencies, scene }, { enabled: options.enabled, audience: options.audience }, input => ({
    input, policies: composeTaskActionPolicyManagement(input), settings: composeApprovedSettingsApplication(input),
    clock: input.clock ?? (() => new Date())
  }));
  type Root = { input: ApprovedSettingsApplicationDependencies; policies: ReturnType<typeof composeTaskActionPolicyManagement>;
    settings: ReturnType<typeof composeApprovedSettingsApplication>; clock: () => Date };
  const target = async (root: Root, request: AiSceneHttpRequest, input: z.infer<typeof reference>) => {
    const before = await creation.read(request, input);
    if (!('task' in before.receipt) || before.receipt.state !== 'observed' || !before.receipt.task)
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const task = before.receipt.task;
    const change = await root.settings.readChangeReceipt({ changeKey: input.changeKey });
    if (change.state !== 'prepared_not_approved' || change.change.changeId !== before.original.changeId
      || change.change.changeHash !== before.original.changeHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const verify = async () => {
      const after = await creation.read(request, input);
      if (!('task' in after.receipt) || after.receipt.state !== 'observed' || !after.receipt.task
        || after.receipt.task.taskId !== task.taskId || after.receipt.task.runId !== task.runId
        || requestFingerprint(after.original) !== requestFingerprint(before.original))
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    };
    return { task, change: change.change, verify };
  };
  const policy = (request: AiSceneHttpRequest, value: unknown, mode: 'read' | 'configure' | 'clear') => {
    const schema = mode === 'read' ? readSchema : mode === 'configure' ? writeSchema : clearSchema;
    const parsed = schema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return call(request, parsed.data, async (root, value) => {
      const input = schema.parse(value), template = templates.find(row => row.operation === input.operation);
      if (!template) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const found = await target(root, request, reference.parse({ creationKey: input.creationKey, changeKey: input.changeKey }));
      const operation = template.operation as AiTaskActionPolicyMutation['operation'];
      let receipt;
      if (mode === 'read') receipt = await root.policies.read(found.task.taskId, operation);
      else if (mode === 'clear') receipt = await root.policies.clear(found.task.taskId, operation, clearSchema.parse(value).expectedRevision);
      else {
        const now = root.clock().getTime(), expiresAt = Math.min(Date.parse(found.change.expiresAt), now + ttlMs);
        if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        receipt = await root.policies.put({ taskId: found.task.taskId, operation, requiredPermissions: template.requiredPermissions,
          expiresAt: new Date(expiresAt) }, writeSchema.parse(value).expectedRevision);
      }
      await found.verify();
      return freezeOriginalInput({ receipt, semantics: 'policy_not_approval_or_dispatch' as const });
    });
  };
  const cancellation = (request: AiSceneHttpRequest, value: unknown,
    mode: 'request' | 'settle_unstarted' | 'read_request' | 'read_settlement') => {
    const parsed = cancellationSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return call(request, parsed.data, async (root, value) => {
      const command = cancellationSchema.parse(value), found = await target(root, request,
        reference.parse({ creationKey: command.creationKey, changeKey: command.changeKey }));
      const authorization = composePersistedTaskAuthorization(root.input);
      const transitions = new AiTaskTransitionRepository(root.input.db, authorization.authority, root.clock);
      const input = { taskId: found.task.taskId, expectedRevision: command.expectedRevision };
      const receipt = mode === 'read_request' ? await transitions.readCancellationReceipt(input)
        : mode === 'read_settlement' ? await transitions.readCancellationSettlementReceipt(input)
          : mode === 'request' ? await transitions.transition({ ...input, to: 'cancel_requested', reason: 'cancel_requested' })
            : await transitions.settleUnstartedCancellation({ ...input, to: 'cancelled', reason: 'cancel_settled' }, found.task.runId);
      await found.verify();
      return freezeOriginalInput({ receipt, cancellation: 'not_business_rollback' as const,
        automaticRetry: false as const, financialRelease: 'not_performed' as const });
    });
  };
  return Object.freeze({
    requestCancellation: (request: AiSceneHttpRequest, value: unknown) => cancellation(request, value, 'request'),
    settleUnstartedCancellation: (request: AiSceneHttpRequest, value: unknown) => cancellation(request, value, 'settle_unstarted'),
    readCancellation: (request: AiSceneHttpRequest, value: unknown) => cancellation(request, value, 'read_request'),
    readCancellationSettlement: (request: AiSceneHttpRequest, value: unknown) => cancellation(request, value, 'read_settlement'),
    readPolicy: (request: AiSceneHttpRequest, value: unknown) => policy(request, value, 'read'),
    configurePolicy: (request: AiSceneHttpRequest, value: unknown) => policy(request, value, 'configure'),
    clearPolicy: (request: AiSceneHttpRequest, value: unknown) => policy(request, value, 'clear'),
    start(request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) {
      const parsed = reference.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, parsed.data, async (root, value) => {
        const input = reference.parse(value), found = await target(root, request, input);
        const authorization = composePersistedTaskAuthorization(root.input);
        const access = await authorization.tasks.resolveAccess(found.task.taskId, 'read_metadata');
        const metadata = await root.input.db.aiTask.findFirst({ where: access.where });
        if (!metadata || metadata.sceneCode !== scene.code || metadata.sceneVersion !== scene.version
          || metadata.inputRef !== found.change.changeId || metadata.inputHash !== found.change.changeHash)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const policy = structuredClone(await root.input.db.aiTaskPlanPolicy.findFirst({ where: {
          scopeId: metadata.scopeId, sceneCode: scene.code, sceneVersion: scene.version } }));
        const tools = aiPersistedPlanToolsSchema.safeParse(policy?.allowedTools);
        const limits = aiTaskRunnerLimitsSchema.safeParse(policy?.limits);
        if (!policy?.enabled || policy.scopeId !== metadata.scopeId || policy.sceneCode !== scene.code
          || policy.sceneVersion !== scene.version || !policy.expiresAt
          || !Number.isFinite(new Date(policy.expiresAt).getTime()) || new Date(policy.expiresAt).getTime() <= root.clock().getTime()
          || !tools.success || !limits.success
          || !tools.data.some(tool => tool.code === AI_APPROVED_SETTINGS_TOOL_CODE)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const hostRoot = composeTaskSettingsHost({ ...root.input, host, task: { taskId: found.task.taskId, runId: found.task.runId,
          registrationRef: `settings-change:${found.change.changeHash}`, change: { changeId: found.change.changeId, changeHash: found.change.changeHash },
          limits: limits.data } });
        const result = await hostRoot.application.start({ taskId: found.task.taskId, runId: found.task.runId }, signal);
        await found.verify();
        return freezeOriginalInput(result);
      });
    }
  });
}

/** Independent real notification-settings runner/approval consumer. No model
 * execution dependency or caller-selected task/holder/plan enters this root. */
export function composeRequestBoundSettingsTask(dependencies: Omit<ApprovedSettingsApplicationDependencies, 'credentials'>,
  options: AiSettingsTaskRequestOptions) {
  const host = Object.freeze(structuredClone(options.host)), task = freezeOriginalInput(structuredClone(options.task));
  const scene = freezeOriginalInput(structuredClone(dependencies.scene));
  const call = bindRequests({ ...dependencies, scene }, { enabled: options.enabled, audience: options.audience }, (input, value) => {
    if (!value || typeof value !== 'object' || !('taskId' in value) || value.taskId !== task.taskId
      || 'runId' in value && value.runId !== task.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const settingsHost = composeTaskSettingsHost({ ...input, host, task });
    return { settingsHost };
  });
  return Object.freeze({
    startSettingsTask: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (root, command) => root.settingsHost.application.start(command, signal)),
    readSettingsConfirmation: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (root, command) => root.settingsHost.application.readConfirmation(command)),
    decideSettingsProposal: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (root, command) => root.settingsHost.settings.application.decide(command)),
    readSettingsDecision: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (root, command) => root.settingsHost.settings.application.readDecisionReceipt(command)),
    continueSettingsConfirmation: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (root, command) => root.settingsHost.application.continueOriginalConfirmation(command, signal)),
    reconcileSettingsTask: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (root, command) => root.settingsHost.application.reconcileOriginal(command, signal)),
    cancelSettingsTask: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (root, command) => root.settingsHost.application.requestCancelOriginal(command))
  });
}

/** Recover the server binding from the original published input/plan, not from
 * caller limits, a latest-run lookup or today's settings. This never creates a
 * task/plan; an unpublished task still needs the original explicit producer. */
export function composeRequestBoundPersistedSettingsTask(
  dependencies: Omit<ApprovedSettingsApplicationDependencies, 'credentials'>,
  options: AiSceneRequestOptions & { host: AiTaskApplicationHost }) {
  const host = Object.freeze(structuredClone(options.host)), scene = freezeOriginalInput(structuredClone(dependencies.scene));
  const selector = z.object({ taskId: z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    runId: z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).optional() }).passthrough();
  const call = bindRequests({ ...dependencies, scene }, { enabled: options.enabled, audience: options.audience }, async (input, value) => {
    const command = selector.safeParse(value);
    if (!command.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const authorization = composePersistedTaskAuthorization(input);
    const read = async () => {
      const access = await authorization.tasks.resolveAccess(command.data.taskId, 'read_metadata');
      const task = await input.db.aiTask.findFirst({ where: access.where });
      if (!task || task.sceneCode !== scene.code || task.sceneVersion !== scene.version
        || access.scope.kind !== 'WORKSPACE' || !access.scope.tenantId || !access.scope.workspaceId)
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const key = { scopeId: task.scopeId, taskId: task.id };
      const runs = await input.db.aiRun.findMany({ where: { ...key, actorKind: access.actorKind, actorId: access.actorId }, take: 2 });
      const run = runs[0];
      if (runs.length !== 1 || !run || run.sequence !== 1 || run.taskId !== task.id || run.scopeId !== task.scopeId
        || run.inputReceiptId != null || run.resourceOriginRunId != null
        || run.actorKind !== access.actorKind || run.actorId !== access.actorId
        || command.data.runId !== undefined && run.id !== command.data.runId)
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const planRow = await input.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { ...key, runId: run.id } } });
      const plan = aiTaskRunPlanSchema.safeParse(structuredClone(planRow?.payload));
      if (!planRow || planRow.scopeId !== key.scopeId || planRow.taskId !== key.taskId || planRow.runId !== run.id
        || !plan.success || plan.data.taskId !== task.id || plan.data.runId !== run.id
        || requestFingerprint(plan.data) !== planRow.planHash || plan.data.steps.length !== 1
        || plan.data.steps[0].toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE
        || plan.data.steps[0].toolVersion !== AI_TOOL_DRAFT_VERSION || plan.data.steps[0].operation !== 'idempotent')
        throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const registered = plan.data.steps[0].registrationRef;
      const saved = await input.db.aiTaskActionInput.findFirst({ where: { ...key, runId: run.id, registrationRef: registered } });
      const change = settingsChangeReferenceSchema.safeParse(structuredClone(saved?.payload));
      if (!saved || saved.scopeId !== key.scopeId || saved.taskId !== key.taskId || saved.runId !== run.id
        || !z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u).safeParse(saved.id).success
        || !Number.isInteger(saved.policyRevision) || saved.policyRevision < 1 || saved.policyRevision > 4294967294
        || !(saved.expiresAt instanceof Date) || !Number.isFinite(saved.expiresAt.getTime())
        || saved.registrationRef !== registered || saved.toolCode !== AI_APPROVED_SETTINGS_TOOL_CODE
        || saved.toolVersion !== AI_TOOL_DRAFT_VERSION || !change.success || requestFingerprint(change.data) !== saved.fingerprint)
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const row = await input.db.rentalApprovedSettingsChange.findFirst({ where: { id: change.data.changeId,
        tenantId: access.scope.tenantId, workspaceId: access.scope.workspaceId, actorId: access.actorId } });
      if (!row || row.changeHash !== change.data.changeHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      // The existing Core historical reader checks the original material hash,
      // owner, tenant/workspace and current route permission, even after expiry.
      const receipt = await composeApprovedSettingsApplication(input).readChangeReceipt({ changeKey: row.changeKey });
      if (receipt.state !== 'prepared_not_approved' || receipt.change.changeId !== change.data.changeId
        || receipt.change.changeHash !== change.data.changeHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      if ((await authorization.tasks.resolveAccess(task.id, 'read_metadata')).bindingKey !== access.bindingKey)
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { binding: requestFingerprint({ identity: access.bindingKey, scopeId: key.scopeId, taskId: task.id, runId: run.id,
        scene, planHash: planRow.planHash, inputId: saved.id, inputHash: saved.fingerprint, change: change.data }),
        task: { taskId: task.id, runId: run.id, registrationRef: registered, change: change.data, limits: plan.data.limits } };
    };
    const before = await read(), settingsHost = composeTaskSettingsHost({ ...input, host, task: before.task });
    return { settingsHost, verify: async () => {
      if ((await read()).binding !== before.binding) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    } };
  });
  const use = <R>(request: AiSceneHttpRequest, value: unknown,
    consume: (root: ReturnType<typeof composeTaskSettingsHost>, command: unknown) => Promise<R>) =>
    call(request, value, async (root, command) => { const result = await consume(root.settingsHost, command); await root.verify(); return result; });
  return Object.freeze({
    startSettingsTask: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      use(request, value, (root, command) => root.application.start(command, signal)),
    readSettingsConfirmation: (request: AiSceneHttpRequest, value: unknown) =>
      use(request, value, (root, command) => root.application.readConfirmation(command)),
    decideSettingsProposal: (request: AiSceneHttpRequest, value: unknown) =>
      use(request, value, (root, command) => root.settings.application.decide(command)),
    readSettingsDecision: (request: AiSceneHttpRequest, value: unknown) =>
      use(request, value, (root, command) => root.settings.application.readDecisionReceipt(command)),
    continueSettingsConfirmation: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      use(request, value, (root, command) => root.application.continueOriginalConfirmation(command, signal)),
    reconcileSettingsTask: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      use(request, value, (root, command) => root.application.reconcileOriginal(command, signal)),
    cancelSettingsTask: (request: AiSceneHttpRequest, value: unknown) =>
      use(request, value, (root, command) => root.application.requestCancelOriginal(command))
  });
}

/** Human-owned plan configuration, not task ownership or dispatch authority.
 * The scene/tool registry is fixed by the server and never taken from a body. */
export function composeRequestBoundScenePlanPolicies(dependencies: RequestBoundOriginalSceneDependencies,
  options: AiScenePlanPolicyConfiguration) {
  if (options.audience !== 'operator') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const scenes = freezeOriginalInput(structuredClone(options.scenes));
  if (!Array.isArray(scenes) || !scenes.length || scenes.length > 32
    || scenes.some(row => !row?.scene || !Array.isArray(row.tools) || !row.tools.length || row.tools.length > 16)
    || new Set(scenes.map(row => row.scene.code)).size !== scenes.length) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const readSchema = z.object({ sceneCode: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
  const changeSchema = readSchema.extend({ change: z.unknown() }).strict();
  const call = bindRequests(dependencies, { enabled: options.enabled, audience: 'operator' }, input => ({
    repository(code: string) {
      const selected = scenes.find(row => row.scene.code === code);
      if (!selected) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      return new PrismaTaskPlanPolicyRepository(input.db, { auth: input.auth, credentials: input.credentials,
        guard: input.guard, scene: selected.scene, tool: selected.tools[0], tools: selected.tools, audit: true }, input.clock);
    }
  }));
  return Object.freeze({
    read(request: AiSceneHttpRequest, value: unknown) {
      const parsed = readSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, parsed.data, async (root, command) => {
        const input = readSchema.parse(command);
        return { sceneCode: input.sceneCode, ...await root.repository(input.sceneCode).read(),
          execution: 'not_attested' as const, taskActionPolicy: 'not_granted' as const };
      });
    },
    change(request: AiSceneHttpRequest, value: unknown) {
      const parsed = changeSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, parsed.data, async (root, command) => {
        const input = changeSchema.parse(command);
        return { sceneCode: input.sceneCode, ...await root.repository(input.sceneCode).put(input.change),
          execution: 'not_attested' as const, taskActionPolicy: 'not_granted' as const };
      });
    },
  });
}

/** Original operator scenes can now configure their own execution policies
 * through the existing config authority/CAS repository. This does not grant
 * staff/client/automation policies, business approval or dispatch ownership. */
export function composeRequestBoundOriginalTaskActionPolicies(
  dependencies: RequestBoundOriginalSceneDependencies, options: AiOriginalTaskActionPolicyOptions) {
  if (options.audience !== 'operator') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const operation = z.string().refine(value => taskActionPolicyOperations.includes(value));
  const permission = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
  const templates = freezeOriginalInput(z.array(z.object({ operation,
    requiredPermissions: z.array(permission).min(1).max(64).refine(value => new Set(value).size === value.length)
  }).strict()).min(1).max(taskActionPolicyOperations.length).parse(structuredClone(options.templates)));
  if (new Set(templates.map(template => template.operation)).size !== templates.length) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  const ttlMs = z.number().int().min(1).max(120000).parse(options.ttlMs);
  const readSchema = z.object({ original: originalRequestReferenceSchema, operation }).strict();
  const configureSchema = readSchema.extend({ expectedRevision: z.number().int().min(1).max(4294967294).nullable() }).strict();
  const clearSchema = readSchema.extend({ expectedRevision: z.number().int().min(1).max(4294967293) }).strict();
  const call = bindRequests(dependencies, { enabled: options.enabled, audience: 'operator' }, input => ({
    scenes: composeAiOriginalScenes(input), policies: composeTaskActionPolicyManagement(input), clock: input.clock ?? (() => new Date())
  }));
  type Root = { scenes: ReturnType<typeof composeAiOriginalScenes>;
    policies: ReturnType<typeof composeTaskActionPolicyManagement>; clock: () => Date };
  const target = async (root: Root, original: z.infer<typeof originalRequestReferenceSchema>, selected: string) => {
    const template = templates.find(value => value.operation === selected);
    if (!template) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const before = await root.scenes.requests.readHistorical(original);
    const task = await root.scenes.readTaskReceipt(original.inputRef);
    if (before.receipt.state === 'revoked' || task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    const verify = async () => {
      const current = await root.scenes.requests.readHistorical(original), latest = await root.scenes.readTaskReceipt(original.inputRef);
      if (current.receipt.state === 'revoked' || current.receipt.contentHash !== before.receipt.contentHash
        || originalIdentityHash(current.context) !== originalIdentityHash(before.context)
        || latest.state !== 'observed' || latest.taskId !== task.taskId || latest.runId !== task.runId || latest.revision !== task.revision)
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    };
    await verify();
    return { taskId: task.taskId, template, expiresAt: before.receipt.expiresAt, verify };
  };
  return Object.freeze({
    clear(request: AiSceneHttpRequest, value: unknown) {
      const parsed = clearSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, parsed.data, async (root, command) => {
        const input = clearSchema.parse(command), found = await target(root, input.original, input.operation);
        const policy = await root.policies.clear(found.taskId,
          found.template.operation as AiTaskActionPolicyMutation['operation'], input.expectedRevision);
        await found.verify();
        return { original: input.original, state: 'revoked' as const, policy, retryable: false as const,
          semantics: 'new_task_actions_denied_not_remote_rollback' as const };
      });
    },
    configure(request: AiSceneHttpRequest, value: unknown) {
      const parsed = configureSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, parsed.data, async (root, command) => {
        const input = configureSchema.parse(command), found = await target(root, input.original, input.operation);
        // Current manager + current original-resource access can authorize
        // another short observation window after the creation input expires.
        // That must not refresh input, execution, takeover or approval rights.
        const observation = ['read_metadata', 'read_events', 'read_step_terminal'].includes(found.template.operation);
        const now = root.clock().getTime(), expiry = observation ? now + ttlMs : Math.min(Date.parse(found.expiresAt), now + ttlMs);
        if (!Number.isFinite(expiry) || expiry <= now) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const policy = await root.policies.put({ taskId: found.taskId,
          operation: found.template.operation as AiTaskActionPolicyMutation['operation'],
          requiredPermissions: found.template.requiredPermissions, expiresAt: new Date(expiry) }, input.expectedRevision);
        await found.verify();
        return { original: input.original, state: 'configured' as const, policy, retryable: false as const,
          semantics: 'action_policy_not_dispatch_or_business_approval' as const };
      });
    },
    read(request: AiSceneHttpRequest, value: unknown) {
      const parsed = readSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, parsed.data, async (root, command) => {
        const input = readSchema.parse(command), found = await target(root, input.original, input.operation);
        const policy = await root.policies.read(found.taskId, found.template.operation as AiTaskActionPolicyMutation['operation']);
        await found.verify();
        return { original: input.original, state: policy.state, policy: policy.state === 'observed' ? policy.policy : null,
          retryable: false as const, semantics: 'action_policy_not_dispatch_or_business_approval' as const };
      });
    },
  });
}

/** Read an original takeover receipt without constructing a model, Gateway,
 * budget admission or runner. Current original-resource and action permissions
 * remain mandatory; a later clarification does not replace the referenced run. */
export function composeRequestBoundOriginalTaskRecoveryReaders(
  dependencies: RequestBoundOriginalSceneDependencies, options: AiSceneRequestOptions,
  results?: { policy: ConstructorParameters<typeof AiOriginalSceneResultService>[3]; knowledge?: AiOriginalSceneKnowledgeOptions }) {
  const resultPolicy = results ? freezeOriginalInput(gatewayTextIntentBindingSchema.parse(structuredClone(results.policy))) : undefined;
  const knowledgeOptions = results?.knowledge;
  const snapshotSchema = z.object({ original: originalRequestReferenceSchema,
    runId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u) }).strict();
  const cancellationSchema = z.object({ original: originalRequestReferenceSchema,
    expectedRevision: z.number().int().min(1).max(4294967294) }).strict();
  const answerSchema = z.object({ original: originalRequestReferenceSchema, submission: z.unknown() }).strict();
  const schema = z.object({ original: originalRequestReferenceSchema,
    runId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    expectedTaskRevision: z.number().int().min(1).max(4294967294),
    expectedRunRevision: z.number().int().min(1).max(4294967294),
    expectedFencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict();
  const call = bindRequests(dependencies, options, input => {
    const authorization = composePersistedTaskAuthorization(input);
    const scenes = composeAiOriginalScenes(input);
    // The current formal root must not construct a model/Gateway merely to
    // reconnect. Keep the existing repositories and source-bound consumer.
    const persistedCenter = composePersistedTaskCenter({ ...input, usageDb: input.db });
    // Construct knowledge services only for actual result/source reads. These
    // still revalidate current ACL/consent; absence never means trusted content.
    const resultReader = () => {
      if (!resultPolicy) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const knowledge = knowledgeOptions ? composeOriginalSceneKnowledge(knowledgeOptions, input, input.clock ?? (() => new Date())) : undefined;
      return new AiOriginalSceneResultService(input.db, authorization.tasks, scenes, resultPolicy, input.clock, knowledge);
    };
    const pending = async (value: unknown) => {
      const reference = originalRequestReferenceSchema.parse(structuredClone(value));
      if (!resultPolicy) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const scene = input.creationRules.find(rule => rule.sceneCode === resultPolicy.sceneCode);
      if (!scene) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const task = await scenes.readTaskReceipt(reference.inputRef);
      if (task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const { source } = composeOriginalSceneClarificationSource({ db: input.db, tasks: authorization.tasks, scenes,
        scene: { code: scene.sceneCode, version: scene.sceneVersion }, gatewayScene: resultPolicy,
        results: { read: command => resultReader().read(command) } });
      return PrismaTaskInputRepository.pendingReader(input.db, authorization.tasks, source, input.clock).readPending(task.taskId);
    };
    const center = composeAiTaskCenterScene({ list: persistedCenter.list, events: persistedCenter.events,
      usage: persistedCenter.usage, scenes, ...(resultPolicy ? { input: { read: pending } } : {}), modelResults: {
        read: value => resultReader().read(value), reopenSource: value => resultReader().reopenSource(value)
      } });
    return { scenes, center, resultReader, tasks: authorization.tasks, db: input.db,
      answers: () => PrismaTaskInputRepository.receiptReader(input.db, authorization.tasks, input.clock),
      inputCancellation: () => PrismaTaskInputRepository.releasedCancellationWitness(input.db, authorization.tasks, input.clock),
      snapshots: new PrismaTaskRecoverySnapshotRepository(input.db, authorization.tasks),
      transitions: new AiTaskTransitionRepository(input.db, authorization.authority, input.clock),
      takeovers: new PrismaTaskTakeoverRepository(input.db, authorization.authority, input.clock) };
  });
  const cancellation = (request: AiSceneHttpRequest, value: unknown, settled: boolean) => {
    const parsed = cancellationSchema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return call(request, parsed.data, async (root, command) => {
      const input = cancellationSchema.parse(command), before = await root.scenes.requests.readHistorical(input.original);
      const task = await root.scenes.readTaskReceipt(input.original.inputRef);
      if (before.receipt.state === 'revoked' || task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const reference = { taskId: task.taskId, expectedRevision: input.expectedRevision };
      const receipt = settled ? await root.transitions.readCancellationSettlementReceipt(reference)
        : await root.transitions.readCancellationReceipt(reference);
      const after = await root.scenes.requests.readHistorical(input.original);
      const latest = await root.scenes.readTaskReceipt(input.original.inputRef);
      if (after.receipt.state === 'revoked' || after.receipt.contentHash !== before.receipt.contentHash
        || originalIdentityHash(after.context) !== originalIdentityHash(before.context)
        || latest.state !== 'observed' || latest.taskId !== task.taskId || latest.runId !== task.runId)
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return freezeOriginalInput({ original: input.original, receipt,
        execution: 'read_only_no_lease_or_dispatch' as const });
    });
  };
  return Object.freeze({
    readTaskPage: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (root, command) => root.center.readPage(command)),
    readTaskEvents: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (root, command) => root.center.readEvents(command)),
    readTaskReconnect: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (root, command) => root.center.readReconnect(command)),
    readTaskUsage: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (root, command) => root.center.readUsage(command)),
    readTaskScene: (request: AiSceneHttpRequest, value: unknown) => waitForTaskApplicationDependency(
      () => call(request, value, (root, command) => root.center.readScene(command)), false),
    readInput: (request: AiSceneHttpRequest, value: unknown) => waitForTaskApplicationDependency(
      () => call(request, value, async (root, command) => (await root.center.readInput({ original: command })).input), false),
    readAnswer(request: AiSceneHttpRequest, value: unknown) {
      const parsed = answerSchema.safeParse(structuredClone(value));
      if (!parsed.success || !isAiTaskInputSubmissionDraft(parsed.data.submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, parsed.data, async (root, command) => {
        const input = answerSchema.parse(command);
        if (!isAiTaskInputSubmissionDraft(input.submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
        const before = await root.scenes.requests.readHistorical(input.original);
        const task = await root.scenes.readTaskReceipt(input.original.inputRef);
        if (before.receipt.state === 'revoked' || task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        if (input.submission.taskId !== task.taskId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const receipt = await root.answers().readSubmission(input.submission);
        if (receipt.state === 'observed') {
          const access = await root.tasks.resolveAccess(task.taskId, 'read_metadata');
          await root.db.$transaction(async tx => {
            const row = await tx.aiTask.findFirst({ where: access.where });
            if (!row || row.inputRef !== input.original.inputRef || row.inputHash !== before.receipt.contentHash)
              throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
            await readTaskModelRunOrigin(tx, access, { scopeId: row.scopeId, taskId: task.taskId, runId: receipt.runId,
              originRunId: task.runId, registrationRef: `scene-model:${input.original.inputRef}` });
          });
          if ((await root.tasks.resolveAccess(task.taskId, 'read_metadata')).bindingKey !== access.bindingKey)
            throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        }
        const after = await root.scenes.requests.readHistorical(input.original);
        const latest = await root.scenes.readTaskReceipt(input.original.inputRef);
        if (after.receipt.state === 'revoked' || after.receipt.contentHash !== before.receipt.contentHash
          || originalIdentityHash(after.context) !== originalIdentityHash(before.context)
          || latest.state !== 'observed' || latest.taskId !== task.taskId || latest.runId !== task.runId)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return freezeOriginalInput(receipt);
      });
    },
    readModelResult(request: AiSceneHttpRequest, value: unknown) {
      return call(request, value, (root, command) => root.resultReader().read(command));
    },
    reopenModelSource(request: AiSceneHttpRequest, value: unknown) {
      return call(request, value, (root, command) => root.resultReader().reopenSource(command));
    },
    reopenOpeningModelSource(request: AiSceneHttpRequest, value: unknown) {
      return call(request, value, (root, command) => root.resultReader().reopenOpeningSection(command));
    },
    readRecoverySnapshot(request: AiSceneHttpRequest, value: unknown) {
      const parsed = snapshotSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, parsed.data, async (root, command) => {
        const input = snapshotSchema.parse(command), before = await root.scenes.requests.readHistorical(input.original);
        const task = await root.scenes.readTaskReceipt(input.original.inputRef);
        if (before.receipt.state === 'revoked' || task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const snapshot = await root.snapshots.read({ taskId: task.taskId, runId: input.runId });
        const after = await root.scenes.requests.readHistorical(input.original);
        const latest = await root.scenes.readTaskReceipt(input.original.inputRef);
        if (after.receipt.state === 'revoked' || after.receipt.contentHash !== before.receipt.contentHash
          || originalIdentityHash(after.context) !== originalIdentityHash(before.context)
          || latest.state !== 'observed' || latest.taskId !== task.taskId || latest.runId !== task.runId
          || snapshot.task.taskId !== task.taskId || snapshot.run.runId !== input.runId)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const response: AiSceneModelRecoverySnapshotReadResponse = { contractVersion: AI_TASK_RECOVERY_READ_VERSION,
          original: input.original, snapshot,
          execution: 'read_only_no_lease_or_dispatch' as const,
          resources: 'task_cumulative_not_new_allowance' as const };
        if (Buffer.byteLength(JSON.stringify(response), 'utf8') > 524288) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        return freezeOriginalInput(response);
      });
    },
    /** Stopping original work must not construct a fresh financial/model
     * admission. Only record the current authorized cancellation intent;
     * settlement still requires the existing runner/input witness. */
    requestCancellationIntent(request: AiSceneHttpRequest, value: unknown) {
      const parsed = cancellationSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, parsed.data, async (root, command) => {
        const input = cancellationSchema.parse(command), before = await root.scenes.requests.readHistorical(input.original);
        const task = await root.scenes.readTaskReceipt(input.original.inputRef);
        if (before.receipt.state === 'revoked' || task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const receipt = await root.transitions.transition({ taskId: task.taskId, expectedRevision: input.expectedRevision,
          to: 'cancel_requested', reason: 'cancel_requested' });
        const after = await root.scenes.requests.readHistorical(input.original);
        const latest = await root.scenes.readTaskReceipt(input.original.inputRef);
        if (after.receipt.state === 'revoked' || after.receipt.contentHash !== before.receipt.contentHash
          || originalIdentityHash(after.context) !== originalIdentityHash(before.context)
          || latest.state !== 'observed' || latest.taskId !== task.taskId || latest.runId !== task.runId)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return freezeOriginalInput({ receipt, cancellation: 'requested_not_rollback' as const,
          settlement: null, settlementState: 'not_attempted' as const });
      });
    },
    /** This does not cancel started work or release any financial reservation. */
    settleUnstartedCancellation(request: AiSceneHttpRequest, value: unknown) {
      const parsed = cancellationSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, parsed.data, async (root, command) => {
        const input = cancellationSchema.parse(command), before = await root.scenes.requests.readHistorical(input.original);
        const task = await root.scenes.readTaskReceipt(input.original.inputRef);
        if (before.receipt.state === 'revoked' || task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const receipt = await root.transitions.settleUnstartedCancellation({ taskId: task.taskId,
          expectedRevision: input.expectedRevision, to: 'cancelled', reason: 'cancel_settled' }, task.runId);
        const after = await root.scenes.requests.readHistorical(input.original);
        const latest = await root.scenes.readTaskReceipt(input.original.inputRef);
        if (after.receipt.state === 'revoked' || after.receipt.contentHash !== before.receipt.contentHash
          || originalIdentityHash(after.context) !== originalIdentityHash(before.context)
          || latest.state !== 'observed' || latest.taskId !== task.taskId || latest.runId !== task.runId)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return freezeOriginalInput({ original: input.original, receipt,
          cancellation: 'unstarted_task_cancelled_not_business_rollback' as const, automaticRetry: false as const });
      });
    },
    readCancellationReceipt: (request: AiSceneHttpRequest, value: unknown) => cancellation(request, value, false),
    /** Close only the original released, fully measured clarification wait.
     * Its persisted witness is checked under the aggregate task CAS lock. */
    settleReleasedInputCancellation(request: AiSceneHttpRequest, value: unknown) {
      const parsed = cancellationSchema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, parsed.data, async (root, command) => {
        const input = cancellationSchema.parse(command), before = await root.scenes.requests.readHistorical(input.original);
        const task = await root.scenes.readTaskReceipt(input.original.inputRef);
        if (before.receipt.state === 'revoked' || task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const receipt = await root.transitions.settleInputCancellation({ taskId: task.taskId,
          expectedRevision: input.expectedRevision, to: 'cancelled', reason: 'cancel_settled' }, root.inputCancellation());
        const after = await root.scenes.requests.readHistorical(input.original);
        const latest = await root.scenes.readTaskReceipt(input.original.inputRef);
        if (after.receipt.state === 'revoked' || after.receipt.contentHash !== before.receipt.contentHash
          || originalIdentityHash(after.context) !== originalIdentityHash(before.context)
          || latest.state !== 'observed' || latest.taskId !== task.taskId || latest.runId !== task.runId)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return freezeOriginalInput({ original: input.original, receipt,
          cancellation: 'released_input_wait_cancelled_not_business_rollback' as const,
          resourceRelease: 'not_attempted' as const, automaticRetry: false as const });
      });
    },
    readCancellationSettlementReceipt: (request: AiSceneHttpRequest, value: unknown) => cancellation(request, value, true),
    readTakeoverReceipt(request: AiSceneHttpRequest, value: unknown) {
      const parsed = schema.safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      return call(request, parsed.data, async (root, command) => {
        const input = schema.parse(command);
        const before = await root.scenes.requests.readHistorical(input.original);
        const task = await root.scenes.readTaskReceipt(input.original.inputRef);
        if (before.receipt.state === 'revoked' || task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const { original: _reference, ...generation } = input;
        const receipt = await root.takeovers.readReceipt({ ...generation, taskId: task.taskId });
        const after = await root.scenes.requests.readHistorical(input.original);
        const latest = await root.scenes.readTaskReceipt(input.original.inputRef);
        if (after.receipt.state === 'revoked' || after.receipt.contentHash !== before.receipt.contentHash
          || originalIdentityHash(after.context) !== originalIdentityHash(before.context)
          || latest.state !== 'observed' || latest.taskId !== task.taskId || latest.runId !== task.runId)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return freezeOriginalInput({ original: input.original, receipt,
          execution: 'read_only_no_lease_or_dispatch' as const });
      });
    },
  });
}

/** Original-operation consumer; transport accepts only original ref + callId,
 * never a model-selected tool, actor, reservation or execution grant. Resolve
 * pricing from the owned persisted call, never the current model selection.
 * Accounting may close an old balance but cannot start/resume a run or dispatch.
 * Unknown dispatch/usage remains with the same ledger's evidence checks. */
export function composeRequestBoundOriginalTaskAccounting(
  dependencies: RequestBoundOriginalSceneDependencies, options: AiSceneRequestOptions) {
  const schema = z.object({ original: originalRequestReferenceSchema,
    callId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u) }).strict();
  const call = bindRequests(dependencies, options, input => input);
  const use = (request: AiSceneHttpRequest, value: unknown, operation: 'read' | 'releaseUnsent' | 'reconcile',
    signal?: AbortSignal): Promise<AiOriginalTaskAccountingResponseDraft> => {
    const parsed = schema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return call(request, parsed.data, async (input, raw) => {
      const command = schema.parse(raw), scenes = composeAiOriginalScenes(input);
      const original = await scenes.requests.readHistorical(command.original);
      const task = await scenes.readTaskReceipt(command.original.inputRef);
      if (original.receipt.state === 'revoked' || task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const authorization = composePersistedTaskAuthorization(input);
      const current = await authorization.authority.resolve(task.taskId, 'read_step_terminal');
      const scope = await authorization.scopes.resolveCurrent();
      if (scope.scope.kind !== 'WORKSPACE' || current.actor.kind !== 'user'
        || originalIdentityHash(current) !== originalIdentityHash(original.context)
        || originalIdentityHash(scope.context) !== originalIdentityHash(current)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const invocation = await input.db.aiGatewayInvocation.findUnique({ where: {
        scopeId_callId: { scopeId: scope.scope.id, callId: command.callId } },
        select: { id: true, scopeId: true, taskId: true, actorId: true, callId: true, priceVersion: true } });
      if (!invocation || invocation.scopeId !== scope.scope.id || invocation.taskId !== task.taskId
        || invocation.actorId !== current.actor.userId || invocation.callId !== command.callId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const reservation = await input.db.aiBudgetReservation.findUnique({ where: {
        scopeId_scopeKind_callId: { scopeId: scope.scope.id, scopeKind: 'WORKSPACE', callId: command.callId } },
        select: { id: true, scopeId: true, scopeKind: true, tenantId: true, workspaceId: true, actorId: true,
          callId: true, priceVersion: true, unitKind: true } });
      // No replacement reserve when an acknowledgement or link is missing.
      if (!reservation) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      if (reservation.scopeId !== scope.scope.id || reservation.scopeKind !== 'WORKSPACE'
        || reservation.tenantId !== scope.scope.tenantId || reservation.workspaceId !== scope.scope.workspaceId
        || reservation.actorId !== current.actor.userId || reservation.callId !== invocation.callId
        || reservation.priceVersion !== invocation.priceVersion || !['calls', 'tokens', 'money'].includes(reservation.unitKind))
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const verify = async () => {
        const latest = await scenes.requests.readHistorical(command.original);
        const latestTask = await scenes.readTaskReceipt(command.original.inputRef);
        const authority = await authorization.authority.resolve(task.taskId, 'read_step_terminal');
        if (latest.receipt.state === 'revoked' || latest.receipt.contentHash !== original.receipt.contentHash
          || originalIdentityHash(latest.context) !== originalIdentityHash(original.context)
          || originalIdentityHash(authority) !== originalIdentityHash(current)
          || latestTask.state !== 'observed' || latestTask.taskId !== task.taskId || latestTask.runId !== task.runId)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      };
      let returnedMutation = false;
      try {
        await verify();
        if (signal?.aborted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        const recovery = composePersistedTaskAccountingRecovery({ db: input.db, auth: input.auth,
          credentials: input.credentials, subscriptions: input.subscriptions, guard: input.guard,
          taskId: task.taskId, clock: input.clock, pricing: {
            kind: reservation.unitKind === 'calls' ? 'calls' : 'recorded', priceVersion: invocation.priceVersion } });
        const record = operation === 'read' ? await recovery.readCall({ callId: invocation.callId })
          : await recovery[operation]({ reservationId: reservation.id });
        returnedMutation = operation !== 'read';
        await verify();
        if (record.id !== reservation.id || record.callId !== invocation.callId) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        return freezeOriginalInput({ draftVersion: command.original.draftVersion, original: command.original,
          taskId: task.taskId, record: presentTaskBudgetUsageRecord(invocation, record), execution: 'not_invoked' as const,
          accounting: operation === 'read' ? 'observed' as const : 'original_operation_only' as const,
          automaticRetry: false as const, businessExecution: 'not_inferred_from_usage' as const, admission: 'not_granted' as const });
      } catch (error) {
        if (returnedMutation || error instanceof BudgetError && error.code === 'PENDING_RECONCILIATION')
          throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        if (error instanceof BudgetError) throw new AiTaskRepositoryError(error.code === 'FORBIDDEN'
          ? 'AI_ACCESS_DENIED' : error.code === 'INVALID' ? 'AI_INVALID_INPUT' : 'AI_RESOURCE_UNAVAILABLE');
        throw error;
      }
    });
  };
  return Object.freeze({ read: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => use(request, value, 'read', signal),
    releaseUnsent: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => use(request, value, 'releaseUnsent', signal),
    reconcile: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => use(request, value, 'reconcile', signal) });
}

export type RequestBoundPersistedOriginalSceneModelDependencies =
  Omit<RequestBoundOriginalSceneModelDependencies, 'runtime' | 'priceVersion' | 'kind'> & {
    /** Server-owned configuration. No request may choose a provider or task. */
    gateway: Pick<PersistedTaskCallGatewayDependencies,
      'secrets' | 'platformProfileId' | 'routeScene' | 'callPriceVersion' | 'adapters' | 'audit'>
      | Pick<PersistedTaskGatewayDependencies,
        'secrets' | 'platformProfileId' | 'routeScene' | 'pricing' | 'adapters' | 'audit'>;
  };

/** Formal original-reference model actions. Resolve the current original task
 * before constructing its real persisted Gateway/financial evidence producer.
 * The existing scene input, continuation, plan, runner and result consumers
 * remain the only execution chain. Construction does not call or claim work.
 * Business-only task-center readers remain in the existing scene entrypoint.
 */
export function composeRequestBoundPersistedOriginalSceneModel(
  dependencies: RequestBoundPersistedOriginalSceneModelDependencies,
  options: AiSceneRequestOptions & { host: AiTaskApplicationHost;
    clock?: AiOriginalSceneRunDependencies['clock']; monotonic?: AiOriginalSceneRunDependencies['monotonic'];
    /** Server configuration only. Absence preserves the original single model. */
    orderReadChain?: { enabled: true; inputSource?: AiTaskInputSource; answerRoundTrip?: true } }) {
  if (!dependencies.gateway || dependencies.gateway.routeScene !== dependencies.gatewayScene.routeScene
    || 'runtime' in dependencies || 'priceVersion' in dependencies || 'kind' in dependencies
    || 'runServices' in options) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const { host, clock, monotonic, orderReadChain, ...requestOptions } = options;
  if (orderReadChain && (orderReadChain.enabled !== true || dependencies.scene.code !== 'order_explanation'
    || orderReadChain.answerRoundTrip !== undefined && orderReadChain.answerRoundTrip !== true
    || dependencies.gatewayScene.orderExplainTool !== true || dependencies.gatewayScene.structuredOutput
    || orderReadChain.inputSource !== undefined && (typeof orderReadChain.inputSource?.resolve !== 'function'
      || typeof orderReadChain.inputSource?.validateAnswers !== 'function'))) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const orderSource = orderReadChain?.inputSource ? Object.freeze({
    resolve: orderReadChain.inputSource.resolve.bind(orderReadChain.inputSource),
    validateAnswers: orderReadChain.inputSource.validateAnswers.bind(orderReadChain.inputSource)
  }) : undefined;
  const answerRoundTrip = orderReadChain?.answerRoundTrip === true;
  const serverHost = freezeOriginalInput(structuredClone(host));
  const { gateway, ...sceneDependencies } = dependencies;
  const recoveryReaders = composeRequestBoundOriginalTaskRecoveryReaders(sceneDependencies, requestOptions,
    { policy: dependencies.gatewayScene, knowledge: dependencies.knowledge });
  const accounting = composeRequestBoundOriginalTaskAccounting(sceneDependencies, requestOptions);
  if ('pricing' in gateway && 'callPriceVersion' in gateway) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const serverGateway = Object.freeze({ ...gateway, adapters: Object.freeze([...gateway.adapters]),
    ...('pricing' in gateway ? { pricing: freezeOriginalInput(structuredClone(gateway.pricing)) } : {}) });
  const call = bindRequests(sceneDependencies, requestOptions, async (input, command) => {
    const raw = command && typeof command === 'object' && 'original' in command ? command.original : command;
    const parsed = originalRequestReferenceSchema.safeParse(raw);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const reference = freezeOriginalInput(parsed.data), scenes = composeAiOriginalScenes(input);
    const original = await scenes.requests.readHistorical(reference);
    // Historical chain reads retain current read authority, not a new-effect
    // grant. start() still resolves the live original policy during preparation.
    if (!orderReadChain) await scenes.requests.resolve(original.receipt.sceneCode, reference.inputRef);
    const task = await scenes.readTaskReceipt(reference.inputRef);
    if (task.state !== 'observed' || original.receipt.state === 'revoked'
      || original.request.sceneCode !== input.scene.code || original.receipt.sceneVersion !== input.scene.version) {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    const gatewayDependencies = { ...serverGateway, db: input.db, auth: input.auth,
      credentials: input.credentials, subscriptions: input.subscriptions, guard: input.guard,
      taskId: task.taskId, clock: input.clock };
    const persisted = 'pricing' in serverGateway
      ? composePersistedTaskGateway({ ...gatewayDependencies, pricing: serverGateway.pricing! })
      : composePersistedTaskCallGateway({ ...gatewayDependencies, callPriceVersion: serverGateway.callPriceVersion });
    const model = composeAiOriginalSceneModel({ ...input, runtime: persisted.runtime, priceVersion: persisted.priceVersion });
    const orderApplication = orderReadChain ? model.createModelOrderApplication(serverHost, {
      inputSource: orderSource, financialEvidence: persisted.financialEvidence, clock, monotonic },
      answerRoundTrip ? { answerRoundTrip: true } : undefined) : undefined;
    // Clarification and quote actions retain separate protocols. Control and
    // receipts belong to this original chain, never the single-model fallback.
    // Unsupported actions reject, never silently run the old single-model host.
    const unsupported = async (): Promise<never> => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
    const application = orderApplication ? { ...orderApplication,
      readInput: unsupported, refreshInput: unsupported, resume: unsupported,
      continueAnswer: unsupported, readQuotePreparation: unsupported, confirmClarifiedQuote: unsupported,
      readClarifiedQuoteReceipt: unsupported,
      reconcile: orderApplication.recover, readExecution: orderApplication.readScene }
      : model.createApplication(serverHost, { inputSource: 'original_scene',
        financialEvidence: persisted.financialEvidence, clock, monotonic });
    const after = await scenes.requests.readHistorical(reference), latest = await scenes.readTaskReceipt(reference.inputRef);
    if (after.receipt.state === 'revoked' || originalIdentityHash(original.context) !== originalIdentityHash(after.context)
      || original.receipt.contentHash !== after.receipt.contentHash || latest.state !== 'observed'
      || latest.taskId !== task.taskId || latest.runId !== task.runId || latest.revision !== task.revision) {
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    return Object.freeze({ ...application,
      readModelResult: orderApplication ? orderApplication.readModelResult : model.readModelResult,
      reopenModelSource: orderApplication ? orderApplication.reopenOrderSource : model.reopenModelSource,
      readOrderResult: orderApplication?.readOrderResult ?? unsupported,
      readTaskScene: orderApplication?.readScene ?? unsupported,
      readNextSteps: orderApplication?.readNextSteps ?? unsupported,
      readTakeoverReceipt: orderApplication?.readTakeoverReceipt ?? unsupported,
      readCancellationReceipt: orderApplication?.readCancellationReceipt ?? unsupported,
      settleUnstartedCancellation: orderApplication?.settleUnstartedCancellation ?? unsupported,
      readCancellationSettlementReceipt: orderApplication?.readCancellationSettlementReceipt ?? unsupported,
      readPreparation: orderApplication?.readPreparation ?? unsupported,
      resumePrepared: orderApplication?.resumePrepared ?? unsupported,
      readTaskSnapshot: (value: unknown) => readOriginalTaskSnapshot(scenes, composePersistedTaskCenter(input).events, value) });
  });
  return Object.freeze({
    readOriginalAccounting: accounting.read,
    releaseOriginalUnsentAccounting: accounting.releaseUnsent,
    reconcileOriginalAccounting: accounting.reconcile,
    readTaskPage: recoveryReaders.readTaskPage,
    readTaskEvents: recoveryReaders.readTaskEvents,
    readTaskReconnect: recoveryReaders.readTaskReconnect,
    readTaskUsage: recoveryReaders.readTaskUsage,
    readRecoverySnapshot: recoveryReaders.readRecoverySnapshot,
    requestCancellationIntent: recoveryReaders.requestCancellationIntent,
    settleReleasedInputCancellation: recoveryReaders.settleReleasedInputCancellation,
    readTakeoverReceipt: recoveryReaders.readTakeoverReceipt,
    settleUnstartedCancellation: recoveryReaders.settleUnstartedCancellation,
    readCancellationReceipt: recoveryReaders.readCancellationReceipt,
    readCancellationSettlementReceipt: recoveryReaders.readCancellationSettlementReceipt,
    readOrderReadChainTakeoverReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTakeoverReceipt(command)),
    readOrderReadChainCancellationReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readCancellationReceipt(command)),
    settleOrderReadChainUnstartedCancellation: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.settleUnstartedCancellation(command)),
    readOrderReadChainCancellationSettlementReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readCancellationSettlementReceipt(command)),
    ...(orderReadChain ? {
      readOrderResult: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readOrderResult(command)),
      readTaskScene: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTaskScene(command)),
      readNextSteps: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readNextSteps(command)),
      readPreparation: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readPreparation(command)),
      resumePrepared: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => call(request, value, (app, command) => app.resumePrepared(command, signal)),
      readTaskSnapshot: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTaskSnapshot(command))
    } : {}),
    start: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, async (app, command) => await app.start(command, signal)),
    readInput: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readInput(command)),
    refreshInput: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.refreshInput(command)),
    resume: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.resume(command, signal)),
    readAnswer: recoveryReaders.readAnswer,
    readModelResult: recoveryReaders.readModelResult,
    reopenModelSource: recoveryReaders.reopenModelSource,
    reopenOpeningModelSource: recoveryReaders.reopenOpeningModelSource,
    readOrderReadChainAnswer: (request: AiSceneHttpRequest, value: unknown) => call(request, value, async (app, command) => await app.readAnswer(command)),
    readOrderReadChainModelResult: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readModelResult(command)),
    reopenOrderReadChainSource: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reopenModelSource(command)),
    readQuotePreparation: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readQuotePreparation(command)),
    confirmClarifiedQuote: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.confirmClarifiedQuote(command)),
    readClarifiedQuoteReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readClarifiedQuoteReceipt(command)),
    continueAnswer: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.continueAnswer(command, signal)),
    reconcile: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, async (app, command) => await app.reconcile(command, signal)),
    recover: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, async (app, command) => await app.recover(command, signal)),
    readExecution: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readExecution(command)),
    takeover: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, async (app, command) => await app.takeover(command, signal)),
    requestCancel: (request: AiSceneHttpRequest, value: unknown) => call(request, value, async (app, command) => await app.requestCancel(command))
  });
}

export function composeRequestBoundOriginalSceneModel(dependencies: RequestBoundOriginalSceneModelDependencies,
  options: AiSceneModelRequestOptions) {
  const { host, runServices, quoteTask, settingsTask, ...requestOptions } = options;
  if (typeof runServices !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  if (quoteTask && ('credentials' in quoteTask.dependencies || 'originals' in quoteTask.dependencies
    || quoteTask.dependencies.db !== dependencies.db || quoteTask.dependencies.auth !== dependencies.auth
    || quoteTask.dependencies.guard !== dependencies.guard || quoteTask.dependencies.core !== dependencies.core)) {
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  if (settingsTask && ('credentials' in settingsTask.dependencies
    || settingsTask.dependencies.db !== dependencies.db || settingsTask.dependencies.auth !== dependencies.auth
    || settingsTask.dependencies.guard !== dependencies.guard || settingsTask.dependencies.core !== dependencies.core)) {
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  const business = quoteTask ? { dependencies: { ...quoteTask.dependencies }, configuration: {
    ...quoteTask.configuration, host: structuredClone(quoteTask.configuration.host),
    limits: structuredClone(quoteTask.configuration.limits) } } : undefined;
  const settingsBusiness = settingsTask ? { dependencies: { ...settingsTask.dependencies,
    scene: structuredClone(settingsTask.dependencies.scene) }, configuration: {
    host: structuredClone(settingsTask.configuration.host), task: structuredClone(settingsTask.configuration.task) } } : undefined;
  const settingsRequests = settingsBusiness ? composeRequestBoundSettingsTask(settingsBusiness.dependencies,
    { ...requestOptions, ...settingsBusiness.configuration }) : undefined;
  const requireSettingsRequests = () => {
    if (!settingsRequests) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return settingsRequests;
  };
  const serverHost = Object.freeze(structuredClone(host));
  const recoveryReaders = composeRequestBoundOriginalTaskRecoveryReaders(dependencies, requestOptions,
    { policy: dependencies.gatewayScene, knowledge: dependencies.knowledge });
  const call = bindRequests(dependencies, requestOptions, input => {
    const model = composeAiOriginalSceneModel(input);
    // A business-only read must not construct model execution dependencies.
    // Resolve them only for an actual model action or pending-input read.
    let application: ReturnType<typeof model.createApplication> | undefined;
    const modelApplication = () => application ??= model.createApplication(serverHost, runServices(input));
    const persisted = composePersistedTaskCenter({ ...input, usageDb: input.db });
    const quote = business ? composeQuoteTaskCenterReaders({ ...business.dependencies,
      credentials: input.credentials, originals: model.scenes.requests }, business.configuration) : {};
    const settingsHost = settingsBusiness ? composeTaskSettingsHost({ ...settingsBusiness.dependencies,
      credentials: input.credentials, host: settingsBusiness.configuration.host, task: settingsBusiness.configuration.task }) : undefined;
    const settings = settingsHost && settingsBusiness ? composeAiSettingsBusinessConsumer({ ...settingsBusiness.dependencies,
      credentials: input.credentials, settingsHost }) : undefined;
    const center = composeAiTaskCenterScene({ list: persisted.list, events: persisted.events, usage: persisted.usage,
      ...quote, ...(settings ? { settings } : {}),
      scenes: model.scenes, modelResults: { read: model.readModelResult, reopenSource: model.reopenModelSource },
      input: { read: value => modelApplication().readInput(value) } });
    return { model, get application() { return modelApplication(); }, center,
      readTaskSnapshot: (value: unknown) => readOriginalTaskSnapshot(model.scenes, persisted.events, value) };
  });
  return Object.freeze({
    readTakeoverReceipt: recoveryReaders.readTakeoverReceipt,
    readRecoverySnapshot: recoveryReaders.readRecoverySnapshot,
    requestCancellationIntent: recoveryReaders.requestCancellationIntent,
    settleUnstartedCancellation: recoveryReaders.settleUnstartedCancellation,
    settleReleasedInputCancellation: recoveryReaders.settleReleasedInputCancellation,
    readCancellationReceipt: recoveryReaders.readCancellationReceipt,
    readCancellationSettlementReceipt: recoveryReaders.readCancellationSettlementReceipt,
    startSettingsTask: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      requireSettingsRequests().startSettingsTask(request, value, signal),
    readSettingsConfirmation: (request: AiSceneHttpRequest, value: unknown) =>
      requireSettingsRequests().readSettingsConfirmation(request, value),
    decideSettingsProposal: (request: AiSceneHttpRequest, value: unknown) =>
      requireSettingsRequests().decideSettingsProposal(request, value),
    readSettingsDecision: (request: AiSceneHttpRequest, value: unknown) =>
      requireSettingsRequests().readSettingsDecision(request, value),
    continueSettingsConfirmation: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      requireSettingsRequests().continueSettingsConfirmation(request, value, signal),
    reconcileSettingsTask: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      requireSettingsRequests().reconcileSettingsTask(request, value, signal),
    cancelSettingsTask: (request: AiSceneHttpRequest, value: unknown) =>
      requireSettingsRequests().cancelSettingsTask(request, value),
    readTaskPage: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.center.readPage(command)),
    readTaskSnapshot: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTaskSnapshot(command)),
    readTaskEvents: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.center.readEvents(command)),
    readTaskReconnect: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.center.readReconnect(command)),
    readTaskUsage: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.center.readUsage(command)),
    readTaskScene: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.center.readScene(command)),
    reopenOrderCitation: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.reopenOrderCitation(command)),
    prepareOrderManualHandoff: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.prepareOrderManualHandoff(command)),
    readQuoteCatalog: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.readQuoteCatalog(command)),
    compareOriginalQuotes: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.compareOriginalQuotes(command)),
    prepareOpeningSections: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.prepareOpeningSections(command)),
    readOpeningSection: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.readOpeningSection(command)),
    readRecovery: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.readRecovery(command)),
    reviewQuote: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.reviewQuote(command)),
    readQuoteReceipt: (request: AiSceneHttpRequest, value: unknown) =>
      call(request, value, (app, command) => app.model.scenes.readQuoteReceipt(command)),
    start: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.application.start(command, signal)),
    readInput: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.readInput(command)),
    refreshInput: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.refreshInput(command)),
    resume: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.application.resume(command, signal)),
    readAnswer: recoveryReaders.readAnswer,
    readQuotePreparation: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.readQuotePreparation(command)),
    confirmClarifiedQuote: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.confirmClarifiedQuote(command)),
    readClarifiedQuoteReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.readClarifiedQuoteReceipt(command)),
    continueAnswer: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.application.continueAnswer(command, signal)),
    reconcile: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.application.reconcile(command, signal)),
    recover: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.application.recover(command, signal)),
    readExecution: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.readExecution(command)),
    takeover: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      call(request, value, (app, command) => app.application.takeover(command, signal)),
    requestCancel: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.application.requestCancel(command)),
    readModelResult: recoveryReaders.readModelResult,
    reopenModelSource: recoveryReaders.reopenModelSource,
    reopenOpeningModelSource: recoveryReaders.reopenOpeningModelSource
  });
}

/** Share the real human-selection/approval/result readers between model and
 * business task centers. No start, continue, lease or write methods escape. */
function composeQuoteTaskCenterReaders(input: HumanQuoteOrderDependencies, configuration: SelectedQuoteTaskConfiguration) {
  const human = composeHumanQuoteOrder(input), tasks = composeSelectedQuoteTaskApplication(input, configuration);
  return Object.freeze({ selections: human, approvals: human, orders: { readResult: tasks.readResult } });
}

export function composeRequestBoundOriginalScenes(dependencies: RequestBoundOriginalSceneDependencies, options: AiSceneRequestOptions) {
  const call = bindRequests(dependencies, options, composeAiOriginalScenes);
  return Object.freeze({
    create: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.create(command)),
    read: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.read(command)),
    reissue: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reissue(command)),
    reconcile: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reconcile(command)),
    reconcileReissue: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reconcile(command, true)),
    createTask: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.createTask(command)),
    prepareTaskMaterial: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.prepareTaskMaterial(command)),
    reopenOrderCitation: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reopenOrderCitation(command)),
    prepareOrderManualHandoff: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.prepareOrderManualHandoff(command)),
    readQuoteCatalog: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readQuoteCatalog(command)),
    compareOriginalQuotes: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.compareOriginalQuotes(command)),
    prepareOpeningSections: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.prepareOpeningSections(command)),
    readOpeningSection: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readOpeningSection(command)),
    reviewQuote: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reviewQuote(command)),
    confirmQuote: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.confirmQuote(command)),
    readQuoteReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readQuoteReceipt(command)),
    readRecovery: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readRecovery(command))
  });
}

/** Alternative server-selected original opening READ host, not a second
 * driver alongside the model host for the same run. No caller task/lease/tool
 * or config input is accepted; the original saved plan prevents replacement. */
export function composeRequestBoundOriginalOpeningReadTask(
  dependencies: RequestBoundOriginalSceneDependencies, options: AiSceneRequestOptions,
  configuration: { host: AiTaskApplicationHost; limits: z.infer<typeof aiTaskRunnerLimitsSchema>;
    monotonic?: () => number }) {
  const limits = aiTaskRunnerLimitsSchema.parse(structuredClone(configuration.limits));
  const monotonic = configuration.monotonic;
  const db = dependencies.db;
  const host = z.object({ holderId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
    leaseMs: z.number().int().min(1).max(120000) }).strict().parse(structuredClone(configuration.host));
  const call = bindRequests(dependencies, options, input => input);
  // These are the existing original-key cancellation transactions/readers.
  // Do not construct an execution host merely to stop queued or running work.
  const recoveryReaders = composeRequestBoundOriginalTaskRecoveryReaders(dependencies, options);
  const cancellation = (request: AiSceneHttpRequest, value: unknown,
    method: 'requestCancellationIntent' | 'settleUnstartedCancellation' | 'readCancellationReceipt' | 'readCancellationSettlementReceipt') => {
    const schema = z.object({ original: originalRequestReferenceSchema,
      expectedRevision: z.number().int().min(1).max(4294967294) }).strict();
    const parsed = schema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return call(request, parsed.data, async input => {
      const scenes = composeAiOriginalScenes(input), original = await scenes.requests.readHistorical(parsed.data.original);
      if (original.request.sceneCode !== 'opening_diagnosis' || original.receipt.state === 'revoked') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const receipt = await recoveryReaders[method](request, parsed.data);
      const after = await scenes.requests.readHistorical(parsed.data.original);
      if (after.receipt.state === 'revoked' || after.receipt.contentHash !== original.receipt.contentHash
        || originalIdentityHash(after.context) !== originalIdentityHash(original.context)) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return receipt;
    });
  };
  const consume = <T>(request: AiSceneHttpRequest, value: unknown, historical: boolean,
    work: (root: ReturnType<typeof composePersistedReadonlyBusinessTaskHost>,
      original: Awaited<ReturnType<ReturnType<typeof composeAiOriginalScenes>['requests']['readHistorical']>>,
      command: { taskId: string; runId: string }, resultId?: string) => Promise<T>, result = false) => {
    const schema = result ? originalRequestReferenceSchema.extend({ resultId: z.string().uuid() }).strict() : originalRequestReferenceSchema;
    const parsed = schema.safeParse(structuredClone(value));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return call(request, parsed.data, async (input, value) => {
      const command = schema.parse(value), reference = freezeOriginalInput({ draftVersion: command.draftVersion, inputRef: command.inputRef });
      const scenes = composeAiOriginalScenes(input);
      const readOriginal = async () => {
        if (!historical) await scenes.requests.read(reference);
        return scenes.requests.readHistorical(reference);
      };
      const original = await readOriginal();
      if (original.request.sceneCode !== 'opening_diagnosis') throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const task = await scenes.requests.readTaskReceipt(reference.inputRef);
      if (task.state !== 'observed') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
      const expected = originalIdentityHash(original.context);
      const verifyOriginal = async () => {
        const current = await readOriginal();
        const currentTask = await scenes.requests.readTaskReceipt(reference.inputRef);
        if (originalIdentityHash(current.context) !== expected || current.receipt.contentHash !== original.receipt.contentHash
          || currentTask.state !== 'observed' || currentTask.taskId !== task.taskId || currentTask.runId !== task.runId) {
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        }
      };
      const root = composePersistedReadonlyBusinessTaskHost({ db: input.db,
        authorization: { auth: input.auth, credentials: input.credentials, subscriptions: input.subscriptions },
        guard: input.guard, core: input.core, diagnosticCore: input.core, business: input.business,
        wall: input.clock, monotonic, host, revalidateOriginal: verifyOriginal,
        scene: { code: original.receipt.sceneCode, version: original.receipt.sceneVersion },
        task: { taskId: task.taskId, runId: task.runId, limits,
          steps: [{ registrationRef: `opening-read:${reference.inputRef}`, toolCode: 'tenant.opening.diagnose',
            input: { limit: 50, sections: [...original.request.input.sections] } }] } });
      // Recheck the original request while the real runner holds its lease,
      // not merely once before waiting for Task acquisition.
      const application = root.createApplication(host, async held => {
        await verifyOriginal();
        await root.prepare(held);
        await verifyOriginal();
      });
      const selected = Object.freeze({ ...root, application });
      await verifyOriginal();
      const observed = await work(selected, original, { taskId: task.taskId, runId: task.runId },
        'resultId' in command && typeof command.resultId === 'string' ? command.resultId : undefined);
      await verifyOriginal();
      return observed;
    });
  };
  return Object.freeze({
    requestCancellationIntent: (request: AiSceneHttpRequest, value: unknown) => cancellation(request, value, 'requestCancellationIntent'),
    settleUnstartedCancellation: (request: AiSceneHttpRequest, value: unknown) => cancellation(request, value, 'settleUnstartedCancellation'),
    readCancellationReceipt: (request: AiSceneHttpRequest, value: unknown) => cancellation(request, value, 'readCancellationReceipt'),
    readCancellationSettlementReceipt: (request: AiSceneHttpRequest, value: unknown) => cancellation(request, value, 'readCancellationSettlementReceipt'),
    /** Existing takeover draft: the request supplies only an observed original
     * generation, never worker names, lease duration or an execution token. */
    takeover(request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) {
      const parsed = z.object({ original: originalRequestReferenceSchema,
        expectedTaskRevision: z.number().int().min(1).max(4294967294),
        expectedRunRevision: z.number().int().min(1).max(4294967294),
        expectedFencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict().safeParse(structuredClone(value));
      if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
      const observed = freezeOriginalInput(parsed.data);
      return consume(request, observed.original, false, async (root, original, selected) => {
        if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
        const snapshot = await root.application.inspect(selected);
        if (!snapshot.plan || snapshot.task.revision !== observed.expectedTaskRevision
          || snapshot.run.revision !== observed.expectedRunRevision || snapshot.run.fencingToken !== observed.expectedFencingToken) {
          throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        }
        const access = await root.authorization.tasks.resolveAccess(selected.taskId, 'takeover_run');
        const task = structuredClone(await db.aiTask.findFirst({ where: access.where,
          select: { id: true, scopeId: true, inputRef: true } }));
        if (!task || task.id !== selected.taskId || task.inputRef !== original.receipt.inputRef) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const foundRun = await db.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: task.id,
          id: selected.runId, actorKind: access.actorKind, actorId: access.actorId },
          select: { id: true, scopeId: true, taskId: true, revision: true, fencingToken: true, leaseOwnerId: true } });
        if (foundRun && !foundRun.fencingToken.equals(snapshot.run.fencingToken)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        const run = foundRun && Object.freeze({ id: foundRun.id, scopeId: foundRun.scopeId, taskId: foundRun.taskId,
          revision: foundRun.revision, fencingToken: foundRun.fencingToken.toFixed(0), leaseOwnerId: foundRun.leaseOwnerId });
        if (!run || run.id !== selected.runId || run.taskId !== task.id || run.scopeId !== task.scopeId
          || !run.leaseOwnerId || run.leaseOwnerId === host.holderId || run.revision !== snapshot.run.revision
          || run.fencingToken !== snapshot.run.fencingToken) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        const outcome = await root.takeoverAndRecover({ taskId: task.id, runId: selected.runId,
          previousHolderId: run.leaseOwnerId, holderId: host.holderId,
          expectedTaskRevision: snapshot.task.revision, expectedRunRevision: snapshot.run.revision,
          expectedFencingToken: snapshot.run.fencingToken, leaseMs: host.leaseMs }, signal);
        return freezeOriginalInput({ kind: 'run_outcome' as const, outcome,
          takeover: 'same_owner_recovery_only' as const, automaticRetry: false as const,
          businessExecution: 'not_attested' as const });
      });
    },
    readTakeoverReceipt: recoveryReaders.readTakeoverReceipt,
    start: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      consume(request, value, false, async (root, original, task) => ({ original: original.receipt,
        execution: await root.application.start(task, signal), model: 'not_called' as const,
        configurationWrite: 'not_attempted' as const })),
    /** Reacquire only the original run through claim_recovery_run. A released
     * lease after a crash is not recovered by starting a new run/plan. */
    recover: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      consume(request, value, false, async (root, original, selected) => {
        if (signal?.aborted) return { kind: 'not_started' as const, reason: 'host_aborted' as const };
        const snapshot = await root.application.inspect(selected);
        if (!snapshot.plan) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        const outcome = await root.runner.run({ ...selected, holderId: host.holderId, leaseMs: host.leaseMs,
          expectedTaskRevision: snapshot.task.revision, expectedRunRevision: snapshot.run.revision,
          expectedFencingToken: snapshot.run.fencingToken, recovery: true }, signal);
        return freezeOriginalInput({ original: original.receipt, kind: 'run_outcome' as const, outcome,
          recovery: 'original_run_evidence_only' as const, automaticRetry: false as const, model: 'not_called' as const });
      }),
    reconcile: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      consume(request, value, false, async (root, original, task) => ({ original: original.receipt,
        execution: await root.application.reconcile(task, signal), model: 'not_called' as const,
        configurationWrite: 'not_attempted' as const })),
    inspect: (request: AiSceneHttpRequest, value: unknown) =>
      consume(request, value, true, async (root, original, task) => ({ original: original.receipt,
        snapshot: await root.application.inspect(task), execution: 'not_invoked' as const })),
    reopenSource: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) =>
      consume(request, value, true, async (root, original, task, resultId) => ({ original: original.receipt,
        source: await root.reopenBusinessSource({ taskId: task.taskId, resultId }, signal) }), true)
  });
}

export function composeRequestBoundQuoteSelections(dependencies: RequestBoundQuoteSelectionDependencies, options: AiSceneRequestOptions) {
  const call = bindRequests(dependencies, options, input => new PrismaQuoteSelectionRepository({ ...input,
    originals: composeAiOriginalScenes(input).requests }));
  return Object.freeze({
    select: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.select(command)),
    read: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.read(command)),
    reconcile: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reconcile(command))
  });
}

/** Server consumer of two existing commands, not a new HTTP protocol. Human
 * selection must point at the exact clarified Core operation and its durable
 * successor, never an arbitrary authorized quote or a completed model plan. */
export function composeRequestBoundClarifiedQuoteSelection(
  dependencies: RequestBoundPersistedOriginalSceneModelDependencies,
  options: Parameters<typeof composeRequestBoundPersistedOriginalSceneModel>[1],
  business: RequestBoundQuoteOrderDependencies) {
  if (dependencies.scene.code !== 'quote_clarification' || business.scene.code !== dependencies.scene.code
    || business.scene.version !== dependencies.scene.version || options.orderReadChain
    || business.db !== dependencies.db || business.auth !== dependencies.auth || business.guard !== dependencies.guard
    || business.core !== dependencies.core || business.subscriptions !== dependencies.subscriptions) {
    throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  }
  const model = composeRequestBoundPersistedOriginalSceneModel(dependencies, options);
  const selections = composeRequestBoundQuoteSelections(business, { enabled: options.enabled, audience: options.audience });
  const clarificationSchema = z.object({ original: originalRequestReferenceSchema, submission: z.unknown() }).strict();
  const resolveOriginalSelection = async (request: AiSceneHttpRequest, value: unknown, clarification: unknown, historical = false) => {
    const command = parseQuoteSelection(structuredClone(value));
    const parsed = clarificationSchema.safeParse(structuredClone(clarification));
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const source = freezeOriginalInput(parsed.data);
    if (command.originalInputRef !== source.original.inputRef) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    // Snapshot credentials once; mutable caller request/command objects must
    // not switch actors or payloads between awaited source checks and reads.
    const currentRequest = freezeOriginalInput({ headers: { authorization: request?.headers?.authorization } });
    const observed = await model.readClarifiedQuoteReceipt(currentRequest, source);
    if (!('result' in observed) || observed.receipt.state !== 'observed'
      || !(observed.result.status === 'quoted' || historical && observed.result.status === 'expired')
      || !observed.result.quote) {
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    }
    if (observed.receipt.taskId !== command.taskId || observed.receipt.runId !== command.runId
      || observed.original.inputRef !== command.originalInputRef || observed.result.quote.id !== command.order.quoteId) {
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    return { currentRequest, command };
  };
  return Object.freeze({
    async select(request: AiSceneHttpRequest, value: unknown, clarification: unknown) {
      const { currentRequest, command } = await resolveOriginalSelection(request, value, clarification);
      // Existing repository rechecks current quote, owner, human payload,
      // revision, successor ancestry and absence of a frozen order/model plan.
      // This does not start that successor or attest an order/approval.
      return selections.select(currentRequest, command);
    },
    /** Lost selection replies are observed by the exact original key/payload.
     * This never selects again, grants approval or retries an unknown order. */
    async readOperation(request: AiSceneHttpRequest, value: unknown, clarification: unknown) {
      const { currentRequest, command } = await resolveOriginalSelection(request, value, clarification, true);
      return selections.reconcile(currentRequest, command);
    }
  });
}

export function composeRequestBoundSelectedQuoteTask(dependencies: RequestBoundQuoteOrderDependencies,
  options: AiSceneRequestOptions, configuration: SelectedQuoteTaskConfiguration) {
  const server = { ...configuration, host: structuredClone(configuration.host), limits: structuredClone(configuration.limits) };
  const call = bindRequests(dependencies, options, input => {
    const originals = composeFormalApprovedOrderReprepareServices(input, { holderId: server.host.holderId,
      creationRules: input.creationRules, memberships: input.memberships }).originals;
    const tasks = composeSelectedQuoteTaskApplication({ ...input, originals }, server);
    const business = composeQuoteTaskCenterReaders({ ...input, originals }, server), persisted = composePersistedTaskCenter({ ...input, usageDb: input.db });
    const recovery = new AiOriginalSceneRecoveryService(input.db, originals, composePersistedTaskAuthorization(input).tasks);
    const center = composeAiTaskCenterScene({ list: persisted.list, events: persisted.events, usage: persisted.usage, ...business, scenes: { requests: originals,
        readTaskReceipt: originals.readTaskReceipt.bind(originals), readRecovery: recovery.read.bind(recovery) } });
    return Object.freeze({ ...tasks, readScene: center.readScene,
      readTaskSnapshot: (value: unknown) => readOriginalTaskSnapshot({ requests: originals,
        readTaskReceipt: originals.readTaskReceipt.bind(originals) }, persisted.events, value),
      readTaskPage: center.readPage, readTaskEvents: center.readEvents, readTaskReconnect: center.readReconnect, readTaskUsage: center.readUsage });
  });
  return Object.freeze({
    readTaskPage: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTaskPage(command)),
    readTaskUsage: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTaskUsage(command)),
    readTaskSnapshot: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTaskSnapshot(command)),
    readTaskEvents: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTaskEvents(command)),
    readTaskReconnect: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readTaskReconnect(command)),
    readScene: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readScene(command)),
    start: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => call(request, value, (app, command) => app.start(command, signal)),
    readConfirmation: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readConfirmation(command)),
    continueConfirmation: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => call(request, value, (app, command) => app.continueConfirmation(command, signal)),
    reconcile: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => call(request, value, (app, command) => app.reconcile(command, signal)),
    readResult: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readResult(command)),
    requestCancel: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.requestCancel(command))
  });
}

export function composeRequestBoundHumanQuoteOrder(dependencies: RequestBoundQuoteOrderDependencies, options: AiSceneRequestOptions,
  reprepare?: FormalApprovedOrderReprepareConfiguration) {
  if (reprepare && 'reprepareServices' in dependencies) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const configuration = reprepare ? { holderId: reprepare.holderId, creationRules: structuredClone(reprepare.creationRules),
    memberships: reprepare.memberships } : undefined;
  const call = bindRequests(dependencies, options, input => {
    if (configuration) {
      const factory = (current: Parameters<typeof composeFormalApprovedOrderReprepareServices>[0]) =>
        composeFormalApprovedOrderReprepareServices(current, configuration);
      return composeHumanQuoteOrder({ ...input, originals: factory(input).originals, reprepareServices: factory });
    }
    return composeHumanQuoteOrder({ ...input, originals: composeAiOriginalScenes(input).requests });
  });
  return Object.freeze({
    readSelectedProposal: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedProposal(command)),
    decideSelectedProposal: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.decideSelectedProposal(command)),
    readSelectedDecisionReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedDecisionReceipt(command)),
    readSelectedOrderResult: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedOrderResult(command)),
    readSelectedReprepareEligibility: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedReprepareEligibility(command)),
    reprepareSelectedProposal: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.reprepareSelectedProposal(command)),
    readSelectedReprepareReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.readSelectedReprepareReceipt(command))
  });
}

/** Settings business requests do not need a model runtime or a quote/order
 * host. Every action consumes the existing settings application/runner only. */
export function composeRequestBoundSettingsBusinessTask(
  dependencies: Omit<ApprovedSettingsApplicationDependencies, 'credentials'>,
  options: AiSceneRequestOptions,
  configuration: { host: AiTaskApplicationHost; task: AiSettingsTask }) {
  const selected = freezeOriginalInput(structuredClone(configuration));
  const call = bindRequests(dependencies, options, input => {
    const settings = composeApprovedSettingsApplication(input);
    let host: ReturnType<typeof composeTaskSettingsHost> | undefined;
    const requireHost = () => host ??= composeTaskSettingsHost({ ...input, host: selected.host, task: selected.task });
    const requireTask = (value: unknown) => {
      if (!value || typeof value !== 'object' || !('taskId' in value) || value.taskId !== selected.task.taskId
        || 'runId' in value && value.runId !== selected.task.runId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return requireHost();
    };
    return { settings, requireTask, get consumer() {
      return composeAiSettingsBusinessConsumer({ ...input, settingsHost: requireHost() });
    } };
  });
  return Object.freeze({
    readCurrent: (request: AiSceneHttpRequest) => call(request, {}, app => app.settings.readCurrent()),
    prepareChange: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.settings.prepareChange(command)),
    readChangeReceipt: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.settings.readChangeReceipt(command)),
    readBusiness: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => {
      app.requireTask(command && typeof command === 'object' && 'preparation' in command ? command.preparation : undefined);
      return app.consumer.read(command);
    }),
    startSettingsTask: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => call(request, value, (app, command) => app.requireTask(command).application.start(command, signal)),
    readSettingsConfirmation: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.requireTask(command).application.readConfirmation(command)),
    decideSettingsProposal: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.requireTask(command).settings.application.decide(command)),
    readSettingsDecision: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.requireTask(command).settings.application.readDecisionReceipt(command)),
    continueSettingsConfirmation: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => call(request, value, (app, command) => app.requireTask(command).application.continueOriginalConfirmation(command, signal)),
    reconcileSettingsTask: (request: AiSceneHttpRequest, value: unknown, signal?: AbortSignal) => call(request, value, (app, command) => app.requireTask(command).application.reconcileOriginal(command, signal)),
    cancelSettingsTask: (request: AiSceneHttpRequest, value: unknown) => call(request, value, (app, command) => app.requireTask(command).application.requestCancelOriginal(command))
  });
}
