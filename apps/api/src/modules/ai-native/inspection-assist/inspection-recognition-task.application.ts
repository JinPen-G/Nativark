import { randomUUID } from 'node:crypto';
import { Module, type DynamicModule } from '@nestjs/common';
import { z } from 'zod';
import { AI_TOOL_DRAFT_VERSION, isAiTaskInputSubmissionDraft } from '@rental-os/shared';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskCreationRepository } from '../ai-task-creation.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { AiScopeRepository } from '../ai-scope.repository';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import type { AiTaskCredentialSource } from '../task-current-action.authority';
import { PrismaSubscriptionBudgetReader } from '../budget/prisma-subscription-budget-reader';
import { TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, type TaskModelKind } from '../model-input/task-model-input';
import { inspectionRecognitionMediaKind } from './inspection-recognition.service';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import type { TaskModelHostDependencies } from '../runner/model-task-host.composition';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { InspectionActionAuthority } from './inspection-action.authority';
import { StaffInspectionRequestFactory, type PersistedInspectionTaskHostDependencies } from './inspection-assist.composition';
import { inspectionTargetSchema, inspectionId } from './inspection-assist.validation';
import { INSPECTION_RECOGNITION_TASKS, InspectionRecognitionTaskController } from './inspection-recognition-task.controller';
import type { PrismaService } from '../../database/prisma.service';
import type { TenantIntegrationService } from '../../integrations/tenant-integration.service';
import { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import { TenantInspectionObjectReader } from '../../integrations/inspection-object-reader';
import { composeStaffInspectionTaskPolicies, AI_STAFF_INSPECTION_TASK_POLICIES,
  type StaffInspectionTaskPolicyOptions } from '../staff-inspection-task-policy.composition';
import { composeStaffInspectionTaskReceiptReader } from '../staff-inspection-task-receipt.composition';

const referenceSchema = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId,
  inputId: inspectionId, expectedRevision: z.number().int().min(1).max(999) }).strict();
type Reference = z.infer<typeof referenceSchema>;
type LegacyModel = Omit<TaskModelHostDependencies, 'credentials' | 'kind' | 'task' | 'inputSource'>;
type PersistentModel = Omit<PersistedInspectionTaskHostDependencies, 'credentials' | 'task'>;
type Model = LegacyModel | PersistentModel;
export type StoredInspectionRecognitionDependencies = {
  db: PrismaService; integrations: TenantIntegrationService;
  inspection: Omit<InspectionRecognitionTaskDependencies['inspection'], 'db' | 'storage' | 'recognitionResults' | 'audioRecognitionResults'>;
  model: PersistentModel; audioModel?: PersistentModel;
  limits: InspectionRecognitionTaskDependencies['limits']; mediaKind?: 'image' | 'audio'; enabled: boolean;
};
export type InspectionRecognitionTaskDependencies = {
  inspection: ConstructorParameters<typeof StaffInspectionRequestFactory>[0];
  model: Model;
  limits: TaskModelHostDependencies['task']['limits'];
  /** Explicit server gate, not an HTTP property or an installation default. */
  enabled: boolean;
  /** Explicit server scene choice; never accepted from the request. */
  mediaKind?: TaskModelKind;
  /** Optional separate server audio scene; same identity/DB, no new HTTP route. */
  audioModel?: Model;
};
type Request = { headers: { authorization?: unknown } };
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');

/** Original frozen inspection input -> persisted task metadata -> ORIGINAL model
 * runner. No inspection submission, policy seed, provider SDK or second ledger.
 * A configured plan policy permits creation only; persisted task-action policy,
 * current Gateway capabilities and financial admission still gate execution. */
export class InspectionRecognitionTaskApplication {
  private readonly server: InspectionRecognitionTaskDependencies;
  constructor(dependencies: InspectionRecognitionTaskDependencies) {
    if ('credentials' in dependencies.model || 'credentials' in dependencies.inspection
      || dependencies.model.db !== dependencies.inspection.db
      || dependencies.model.guard !== dependencies.inspection.guard
      || typeof dependencies.model.auth?.resolveAccessContext !== 'function'
      || dependencies.model.scene.code !== dependencies.model.gatewayScene.sceneCode) throw unavailable();
    const limits = aiTaskRunnerLimitsSchema.parse(structuredClone(dependencies.limits));
    if (limits.maxStepMs > limits.maxTotalMs) throw unavailable();
    if (dependencies.mediaKind !== undefined && !['image', 'audio'].includes(dependencies.mediaKind)) throw unavailable();
    if (dependencies.audioModel) {
      const audio = dependencies.audioModel;
      if (dependencies.mediaKind === 'audio' || 'credentials' in audio || audio.db !== dependencies.model.db
        || audio.guard !== dependencies.model.guard || audio.auth !== dependencies.model.auth
        || audio.scene.code !== audio.gatewayScene.sceneCode || audio.scene.code === dependencies.model.scene.code
        || audio.gatewayScene.routeScene !== 'vision') throw unavailable();
    }
    const persistent = 'gateway' in dependencies.model;
    if (persistent && ('runtime' in dependencies.model || 'financialEvidence' in dependencies.model || 'priceVersion' in dependencies.model
      || dependencies.model.gateway.routeScene !== 'vision' || dependencies.model.gatewayScene.routeScene !== 'vision')) throw unavailable();
    if (dependencies.audioModel && ('gateway' in dependencies.audioModel) !== persistent) throw unavailable();
    if (dependencies.audioModel && 'gateway' in dependencies.audioModel && ('runtime' in dependencies.audioModel
      || 'financialEvidence' in dependencies.audioModel || 'priceVersion' in dependencies.audioModel
      || dependencies.audioModel.gateway.routeScene !== 'vision')) throw unavailable();
    this.server = { ...dependencies, inspection: { ...dependencies.inspection, recognitionResults: !persistent ? {
      db: dependencies.model.db, auth: dependencies.model.auth, subscriptions: dependencies.model.subscriptions,
      clock: dependencies.model.clock, financialEvidence: (dependencies.model as LegacyModel).financialEvidence,
      policy: { kind: dependencies.mediaKind ?? 'image', sceneCode: dependencies.model.gatewayScene.sceneCode,
        maxOutputTokens: dependencies.model.gatewayScene.maxOutputTokens } } : undefined,
      audioRecognitionResults: dependencies.audioModel && !persistent ? {
        db: dependencies.audioModel.db, auth: dependencies.audioModel.auth, subscriptions: dependencies.audioModel.subscriptions,
        clock: dependencies.audioModel.clock, financialEvidence: (dependencies.audioModel as LegacyModel).financialEvidence,
        policy: { kind: 'audio', sceneCode: dependencies.audioModel.gatewayScene.sceneCode,
          maxOutputTokens: dependencies.audioModel.gatewayScene.maxOutputTokens } } : undefined },
      model: { ...dependencies.model, host: structuredClone(dependencies.model.host),
        ...('gateway' in dependencies.model ? { gateway: { ...dependencies.model.gateway,
          ...(dependencies.model.gateway.adapters === undefined ? {} : { adapters: [...dependencies.model.gateway.adapters] }) } } : {}),
        scene: structuredClone(dependencies.model.scene), gatewayScene: structuredClone(dependencies.model.gatewayScene) },
      ...(dependencies.audioModel ? { audioModel: { ...dependencies.audioModel,
        ...('gateway' in dependencies.audioModel ? { gateway: { ...dependencies.audioModel.gateway,
          ...(dependencies.audioModel.gateway.adapters === undefined ? {} : { adapters: [...dependencies.audioModel.gateway.adapters] }) } } : {}),
        host: structuredClone(dependencies.audioModel.host), scene: structuredClone(dependencies.audioModel.scene),
        gatewayScene: structuredClone(dependencies.audioModel.gatewayScene) } } : {}), limits };
  }

  private async request<T>(request: Request, value: unknown,
    consume: (bound: ReturnType<InspectionRecognitionTaskApplication['bind']>, reference: Reference) => Promise<T>) {
    if (!this.server.enabled) throw unavailable();
    const header = z.string().min(1).max(8192).safeParse(request?.headers?.authorization);
    const parsed = referenceSchema.safeParse(structuredClone(value));
    if (!header.success) throw denied();
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const requestId = randomUUID();
    let active = true;
    const credentials: AiTaskCredentialSource = { current: async () => {
      if (!active) throw denied();
      return { authorization: header.data, requestId, audience: 'staff' };
    } };
    const inspection = new StaffInspectionRequestFactory(this.server.inspection).open({
      headers: { authorization: header.data }, requestId });
    let audioInspection: typeof inspection | undefined;
    try {
      return await runWithRequestIdentity({}, async () => {
        if (this.server.audioModel) {
          if (!inspection.recognition) throw unavailable();
          const frozen = await inspection.recognition.gatewayMedia(parsed.data);
          if (inspectionRecognitionMediaKind(frozen.input) === 'audio') {
            const model = this.server.audioModel;
            audioInspection = new StaffInspectionRequestFactory({ ...this.server.inspection,
              audioRecognitionResults: undefined,
              recognitionResults: 'gateway' in model ? undefined : { db: model.db, auth: model.auth, subscriptions: model.subscriptions,
                clock: model.clock, financialEvidence: model.financialEvidence,
                policy: { kind: 'audio', sceneCode: model.gatewayScene.sceneCode,
                  maxOutputTokens: model.gatewayScene.maxOutputTokens } } }).open({
              headers: { authorization: header.data }, requestId });
            return consume(this.bind(credentials, audioInspection, parsed.data, model, 'audio'), parsed.data);
          }
        }
        return consume(this.bind(credentials, inspection, parsed.data), parsed.data);
      });
    } finally { active = false; audioInspection?.close(); inspection.close(); }
  }

  private bind(credentials: AiTaskCredentialSource,
    inspection: ReturnType<StaffInspectionRequestFactory['open']>, reference: Reference,
    model: Model = this.server.model, expectedKind: TaskModelKind = this.server.mediaKind ?? 'image') {
    const { limits } = this.server, clock = model.clock ?? (() => new Date());
    const scopes = new AiScopeRepository(model.db, new AiTaskCurrentIdentityAuthority(model.auth, credentials, clock), clock);
    const resource = new InspectionActionAuthority(model.guard, credentials);
    const entitlements = new PrismaSubscriptionBudgetReader(model.db, model.subscriptions, clock);
    const resolve = async () => {
      const before = await scopes.resolveCurrent(), context = before.context;
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || context.audience !== 'staff') throw denied();
      const workspace = context.scope;
      if (!inspection.recognition) throw unavailable();
      const media = await inspection.recognition.gatewayMedia(reference);
      const kind = inspectionRecognitionMediaKind(media.input);
      if (kind !== expectedKind) throw unavailable();
      const tool = kind === 'audio' ? TASK_AUDIO_MODEL_TOOL : TASK_IMAGE_MODEL_TOOL;
      await resource.withAction({ orderId: reference.orderId, allocationId: reference.allocationId,
        templateId: reference.templateId, stage: reference.stage }, 'bind', async scope => {
        if (scope.tenantId !== workspace.tenantId || scope.workspaceId !== workspace.workspaceId
          || context.actor.kind !== 'user' || scope.ownerId !== context.actor.userId || scope.audience !== context.audience) throw denied();
      });
      const key = { scopeId: before.scope.id, sceneCode: model.scene.code, sceneVersion: model.scene.version };
      const row = structuredClone(await model.db.aiTaskPlanPolicy.findFirst({ where: key }));
      if (!row || row.scopeId !== key.scopeId || row.sceneCode !== key.sceneCode || row.sceneVersion !== key.sceneVersion
        || !row.enabled || !Number.isInteger(row.revision) || row.revision < 1
        || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt <= clock()
        || requestFingerprint(row.allowedTools) !== requestFingerprint([{ code: tool, version: AI_TOOL_DRAFT_VERSION }])) throw unavailable();
      const permitted = aiTaskRunnerLimitsSchema.parse(structuredClone(row.limits));
      if (permitted.maxStepMs > permitted.maxTotalMs
        || (Object.keys(limits) as (keyof typeof limits)[]).some(key => limits[key] > permitted[key])) throw unavailable();
      const entitlement = await entitlements.read(context.scope.tenantId, 'ai.native.use');
      if (entitlement.entitlements.length !== 1 || !entitlement.entitlements[0].available) throw unavailable();
      const after = await scopes.resolveCurrent();
      if (after.scope.id !== before.scope.id || originalIdentityHash(after.context) !== originalIdentityHash(context)) throw denied();
      return { context: after.context, inputHash: requestFingerprint({ version: 'inspection-task-original-1', reference,
        frozen: media.input, scene: model.scene, policy: { revision: row.revision, allowedTools: row.allowedTools,
          limits: row.limits, expiresAt: row.expiresAt.toISOString() }, entitlement, limits,
        gatewayScene: model.gatewayScene, priceVersion: 'gateway' in model ? model.gateway.callPriceVersion : model.priceVersion }),
        creationKey: `inspection:${requestFingerprint({ scope: context.scope, actor: context.actor,
          audience: context.audience, draftId: reference.draftId, inputId: reference.inputId })}` };
    };
    const creation = new AiTaskCreationRepository(model.db, { resolve: async (sceneCode, inputRef) => {
      if (sceneCode !== model.scene.code || inputRef !== reference.inputId) throw denied();
      const current = await resolve();
      return { context: current.context, creationAllowed: true, sceneCode, sceneVersion: model.scene.version,
        inputRef, inputRevision: reference.expectedRevision, inputHash: current.inputHash };
    } }, clock);
    const command = async () => ({ creationKey: (await resolve()).creationKey, sceneCode: model.scene.code, inputRef: reference.inputId });
    const existing = async () => {
      const receipt = await creation.readCreation(await command());
      if (receipt.state !== 'observed' || !receipt.task) throw unavailable();
      const task = { taskId: receipt.task.taskId, runId: receipt.task.runId,
        registrationRef: `inspection-model:${requestFingerprint({ inputId: reference.inputId })}`, limits };
      const query = { taskId: receipt.task.taskId, runId: receipt.task.runId };
      if ('gateway' in model) {
        const root = await inspection.recognitionPersistedTaskHost(reference, { ...model, task });
        return { root, inspection: root.inspection, query };
      }
      const root = await inspection.recognitionTaskHost(reference, { ...model, credentials,
        inputSource: inspection.recognitionResults.inputSource(reference), task });
      return { root, inspection, query };
    };
    return { creation, command, existing };
  }

  create(request: Request, reference: unknown) {
    return this.request(request, reference, async bound => {
      const command = await bound.command();
      return { task: await bound.creation.create(command), execution: 'not_attested' as const,
        purpose: 'inspection_candidates_only' as const };
    });
  }
  readCreation(request: Request, reference: unknown) {
    if (!this.server.enabled) throw unavailable();
    const model = this.server.model, audio = this.server.audioModel;
    // Observation uses the original durable task, not today's creation plan,
    // price or Gateway. create/start and policy issuance keep their live gates.
    return composeStaffInspectionTaskReceiptReader({ db: model.db, auth: model.auth,
      inspection: this.server.inspection, clock: model.clock }, { enabled: true,
      scenes: [{ kind: this.server.mediaKind ?? 'image', code: model.scene.code, version: model.scene.version },
        ...(audio ? [{ kind: 'audio' as const, code: audio.scene.code, version: audio.scene.version }] : [])] })
      .readCreation(request, reference);
  }
  start(request: Request, reference: unknown, signal?: AbortSignal) {
    return this.request(request, reference, async bound => {
      const { root, query } = await bound.existing();
      return root.application.start(query, signal);
    });
  }
  reconcile(request: Request, reference: unknown, signal?: AbortSignal) {
    return this.request(request, reference, async bound => {
      const { root, query } = await bound.existing();
      return root.application.reconcile(query, signal);
    });
  }
  /** Server consumer only. The task identity is taken from the ORIGINAL
   * creation receipt, not a client-selected task or a second financial source. */
  readResultReview(request: Request, reference: unknown, resultId: unknown) {
    const result = inspectionId.safeParse(resultId);
    if (!result.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return this.request(request, reference, async (bound, original) => {
      const { inspection, query } = await bound.existing();
      return inspection.readRecognitionReview({ ...original, taskId: query.taskId, resultId: result.data });
    });
  }
  /** Explicit evidence save, never field adoption or Core submission. Lost
   * replies are recovered by the original result-save receipt in staff service. */
  saveResultReview(request: Request, reference: unknown, value: unknown) {
    const command = z.object({ resultId: inspectionId, operationId: inspectionId }).strict().safeParse(structuredClone(value));
    if (!command.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return this.request(request, reference, async (bound, original) => {
      const { inspection, query } = await bound.existing();
      return inspection.saveRecognitionReview({ ...original, taskId: query.taskId,
        resultId: command.data.resultId, operationId: command.data.operationId });
    });
  }
  readInput(request: Request, reference: unknown) {
    return this.request(request, reference, async bound => {
      const { root, query } = await bound.existing();
      return root.application.readInput({ taskId: query.taskId });
    });
  }
  resume(request: Request, reference: unknown, value: unknown, signal?: AbortSignal) {
    const submission = structuredClone(value);
    if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return this.request(request, reference, async bound => {
      const { root, query } = await bound.existing();
      if (submission.taskId !== query.taskId) throw denied();
      const result = await root.application.resume(submission, signal);
      await bound.creation.readCreation(await bound.command());
      return result;
    });
  }
  readAnswer(request: Request, reference: unknown, value: unknown) {
    const submission = structuredClone(value);
    if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return this.request(request, reference, async bound => {
      const { root, query } = await bound.existing();
      if (submission.taskId !== query.taskId) throw denied();
      return root.inputs.readSubmission(submission);
    });
  }
  continueAnswer(request: Request, reference: unknown, value: unknown, signal?: AbortSignal) {
    const submission = structuredClone(value);
    if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return this.request(request, reference, async bound => {
      const { root, query } = await bound.existing();
      if (submission.taskId !== query.taskId) throw denied();
      const receipt = await root.inputs.readSubmission(submission);
      if (receipt.state !== 'observed') return { receipt, continuation: 'unavailable' as const };
      const result = await root.application.start({ taskId: query.taskId, runId: receipt.runId }, signal);
      await bound.creation.readCreation(await bound.command());
      return { receipt, result };
    });
  }
  requestCancel(request: Request, reference: unknown, expectedRevision: number) {
    if (!z.number().int().min(1).max(4294967294).safeParse(expectedRevision).success) {
      throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    }
    return this.request(request, reference, async bound => {
      const { root, query } = await bound.existing();
      const receipt = await root.taskTransitions.transition({ taskId: query.taskId, expectedRevision,
        to: 'cancel_requested', reason: 'cancel_requested' });
      // A reply does not attest provider cancellation, inspection submission or rollback.
      await bound.creation.readCreation(await bound.command());
      return { receipt, cancellation: 'requested_not_rollback' as const };
    });
  }
}

/** Formal storage producer -> original staff application -> single persisted
 * Gateway. Construction is inert; no generic signed-URL fetch or fake bytes. */
function storedInspectionDependencies(input: StoredInspectionRecognitionDependencies): InspectionRecognitionTaskDependencies {
  if (input?.enabled !== true || input.model.db !== input.db || input.audioModel && input.audioModel.db !== input.db
    || typeof input.db?.fileAsset?.findFirst !== 'function' || typeof input.db?.rentalOrder?.findFirst !== 'function'
    || typeof input.integrations?.runtimeConfig !== 'function' || !('gateway' in input.model)) throw unavailable();
  const objects = new TenantInspectionObjectReader(input.db, input.integrations);
  const storage = new FileStorageRuntimeService(input.db, input.integrations, undefined, objects);
  return { ...input, inspection: { ...input.inspection, db: input.db, storage } };
}
export function composeStoredInspectionRecognitionApplication(input: StoredInspectionRecognitionDependencies) {
  return new InspectionRecognitionTaskApplication(storedInspectionDependencies(input));
}

/** One real file producer and the original application/policy producers. This
 * only supplies explicit methods: no policy is issued and no task is started. */
export function composeStoredInspectionRecognitionRuntime(input: StoredInspectionRecognitionDependencies,
  taskPolicies?: StaffInspectionTaskPolicyOptions) {
  const dependencies = storedInspectionDependencies(input);
  return { application: new InspectionRecognitionTaskApplication(dependencies),
    // Human editing/preparation/original receipt lookup uses the SAME current
    // Guard and controlled file runtime, without reopening a model task host.
    staffRequests: new StaffInspectionRequestFactory(dependencies.inspection),
    ...(taskPolicies?.enabled === true ? { taskPolicies: composeStaffInspectionTaskPolicies(dependencies, taskPolicies) } : {}) };
}

/** Explicit DI only. No HTTP, root module, polling loop or default enablement. */
@Module({})
export class InspectionRecognitionTaskModule {
  static registerStored(options: { enabled?: boolean; dependencies?: StoredInspectionRecognitionDependencies;
    taskPolicies?: StaffInspectionTaskPolicyOptions } = {}): DynamicModule {
    if (options.enabled !== true) return { module: InspectionRecognitionTaskModule, controllers: [], providers: [], exports: [] };
    if (!options.dependencies) throw unavailable();
    const services = composeStoredInspectionRecognitionRuntime(options.dependencies, options.taskPolicies);
    return { module: InspectionRecognitionTaskModule, controllers: [],
      providers: [{ provide: InspectionRecognitionTaskApplication, useValue: services.application },
        { provide: StaffInspectionRequestFactory, useValue: services.staffRequests },
        ...(services.taskPolicies ? [{ provide: AI_STAFF_INSPECTION_TASK_POLICIES, useValue: services.taskPolicies }] : [])],
      exports: [InspectionRecognitionTaskApplication, StaffInspectionRequestFactory,
        ...(services.taskPolicies ? [AI_STAFF_INSPECTION_TASK_POLICIES] : [])] };
  }
  /** Explicit server DI, never imported by the production root automatically. */
  static registerHttp(dependencies: InspectionRecognitionTaskDependencies): DynamicModule {
    if (dependencies.enabled !== true) throw unavailable();
    return { module: InspectionRecognitionTaskModule, controllers: [InspectionRecognitionTaskController],
      providers: [{ provide: INSPECTION_RECOGNITION_TASKS, useValue: new InspectionRecognitionTaskApplication(dependencies) }],
      exports: [INSPECTION_RECOGNITION_TASKS] };
  }
  static register(dependencies: InspectionRecognitionTaskDependencies): DynamicModule {
    return { module: InspectionRecognitionTaskModule,
      providers: [{ provide: InspectionRecognitionTaskApplication, useValue: new InspectionRecognitionTaskApplication(dependencies) }],
      exports: [InspectionRecognitionTaskApplication] };
  }
}
