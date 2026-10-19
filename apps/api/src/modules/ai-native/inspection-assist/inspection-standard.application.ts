/** Standard staff-media assembly over the original attachment, task, Gateway
 * and ledger. Inert until explicit SERVER configuration plus current persisted
 * policies/capabilities/entitlement/budget; never an inspection submitter. */
import { z } from 'zod';
import { isAiTaskInputSubmissionDraft } from '@rental-os/shared';
import type { ModuleRef } from '@nestjs/core';
import type { AuthService } from '../../auth/auth.service';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { PrismaService } from '../../database/prisma.service';
import type { SubscriptionService } from '../../subscription/subscription.service';
import type { SecretBox } from '../../../common/secret-box';
import type { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { ModelAdapter } from '../model-gateway.ports';
import { RentalCoreController } from '../../rental-core/rental-core.controller';
import { RentalIdempotencyRepository } from '../../rental-core/rental-idempotency.repository';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { aiTaskRunnerLimitsSchema } from '../runner/prisma-task-run-evidence.repository';
import { InspectionRecognitionTaskApplication, type InspectionRecognitionTaskDependencies } from './inspection-recognition-task.application';
import { StaffInspectionRequestFactory } from './inspection-assist.composition';
import { composeStaffInspectionTaskReceiptReader } from '../staff-inspection-task-receipt.composition';
import { composeStaffInspectionTaskPolicies } from '../staff-inspection-task-policy.composition';
import { composePersistedTaskAuthorization } from '../task-authorization.composition';
import { aiTaskAccessFromContext } from '../ai-task.repository';
import { composePersistedTaskDispatchEvidence } from '../task-model-gateway.composition';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { inspectionId, inspectionTargetSchema } from './inspection-assist.validation';
import { randomUUID } from 'node:crypto';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskTransitionRepository } from '../ai-task-transition.repository';
import { PrismaTaskInputRepository } from '../task-input/prisma-task-input.repository';

export const AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION = Symbol('AI_NATIVE_STAFF_RECOGNITION_CONFIGURATION');
export const AI_NATIVE_STAFF_RECOGNITION_RUNTIME = Symbol('AI_NATIVE_STAFF_RECOGNITION_RUNTIME');
/** Optional server adapter injection for a controlled transport; never body,
 * environment credentials or a second runtime. Default is the native adapter. */
export const AI_NATIVE_STAFF_RECOGNITION_ADAPTERS = Symbol('AI_NATIVE_STAFF_RECOGNITION_ADAPTERS');
export const STAFF_RECOGNITION_SCENES = Object.freeze({ image: 'staff_inspection_image', audio: 'staff_inspection_audio' } as const);
const model = z.object({ platformProfileId: z.string().min(1).max(36).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  callPriceVersion: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  maxOutputTokens: z.number().int().min(1).max(32768) }).strict();
const configuration = z.discriminatedUnion('enabled', [z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), image: model, audio: model.optional(), limits: aiTaskRunnerLimitsSchema,
    host: z.object({ holderId: z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
      leaseMs: z.number().int().min(1).max(120000) }).strict() }).strict()]);
export function readStaffRecognitionConfiguration(value?: unknown) {
  try {
    const parsed = configuration.safeParse(structuredClone(value ?? { enabled: false }));
    if (parsed.success) return parsed.data;
  } catch { /* Server data, not live objects/functions or caller configuration. */ }
  throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
}
type Dependencies = { db: PrismaService; auth: AuthService; guard: ApiAuthGuard; core: RentalCoreService;
  subscriptions: SubscriptionService; secrets: SecretBox; files: FileStorageRuntimeService; moduleRef: ModuleRef;
  adapters?: readonly ModelAdapter[]; clock?: () => Date };
export function composeStandardStaffRecognition(d: Dependencies, value?: unknown) {
  const selected = readStaffRecognitionConfiguration(value);
  const inspection = { db: d.db, guard: d.guard, core: d.core, storage: d.files,
    originalInspection: { controller: { createInspection: (...args: Parameters<RentalCoreController['createInspection']>) =>
      d.moduleRef.get(RentalCoreController, { strict: false }).createInspection(...args) }, receipts: new RentalIdempotencyRepository(d.db) } };
  const receipts = composeStaffInspectionTaskReceiptReader({ db: d.db, auth: d.auth, inspection, clock: d.clock }, { enabled: true,
    scenes: [{ kind: 'image', code: STAFF_RECOGNITION_SCENES.image, version: '1' },
      { kind: 'audio', code: STAFF_RECOGNITION_SCENES.audio, version: '1' }] });
  const absent = async (): Promise<never> => { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); };
  // Original metadata/answer receipts and cancellation use current action
  // policies, not new recognition. No profile, bytes, budget or lease is minted.
  const withOriginalTask = async <T>(request: { headers: { authorization?: unknown } }, value: unknown,
    operation: 'read_metadata' | 'read_events' | 'transition_task', signal: AbortSignal | undefined,
    work: (current: ReturnType<typeof composePersistedTaskAuthorization>, taskId: string, originalRunId: string) => Promise<T>) => {
    const reference = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId,
      inputId: inspectionId, expectedRevision: z.number().int().min(1).max(999) }).strict().parse(structuredClone(value));
    const authorization = request?.headers?.authorization;
    if (typeof authorization !== 'string') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    let active = true;
    const close = () => { active = false; }, requestId = randomUUID();
    const credentials = { current: async () => {
      if (!active || signal?.aborted) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { authorization, requestId, audience: 'staff' as const };
    } };
    signal?.addEventListener('abort', close, { once: true });
    try {
      return await runWithRequestIdentity({}, async () => {
        const original = await receipts.readCreation({ headers: { authorization } }, reference, signal);
        if (!original.task) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const current = composePersistedTaskAuthorization({ db: d.db, auth: d.auth,
          subscriptions: d.subscriptions, credentials, clock: d.clock });
        const identity = (context: Awaited<ReturnType<typeof current.authority.resolve>>) => {
          const { requestId: _id, authorizedAt: _at, ...stable } = context;
          return requestFingerprint(stable);
        };
        const before = identity(await current.authority.resolve(original.task.taskId, operation));
        const result = await work(current, original.task.taskId, original.task.runId);
        // Task status/revision may have advanced. Bind only the immutable
        // original creation, then recheck the CURRENT permission after the write.
        const after = await receipts.readCreation({ headers: { authorization } }, reference, signal);
        if (!after.task || after.creationKey !== original.creationKey || after.task.taskId !== original.task.taskId
          || after.task.runId !== original.task.runId
          || identity(await current.authority.resolve(original.task.taskId, operation)) !== before)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        return result;
      });
    } finally { signal?.removeEventListener('abort', close); close(); }
  };
  const cancellation = (request: { headers: { authorization?: unknown } }, reference: unknown,
    revisionValue: number, observe: boolean, signal?: AbortSignal) => {
    const expectedRevision = z.number().int().min(1).max(4294967294).parse(revisionValue);
    return withOriginalTask(request, reference, observe ? 'read_events' : 'transition_task', signal, async (current, taskId) => {
      const repository = new AiTaskTransitionRepository(d.db, current.authority, d.clock), selector = { taskId, expectedRevision };
      const observed = await repository.readCancellationReceipt(selector);
      return observe ? observed : { receipt: observed.event ? { event: observed.event, runRevision: undefined }
        : await repository.transition({ ...selector, to: 'cancel_requested', reason: 'cancel_requested' }),
        cancellation: 'requested_not_rollback' as const };
    });
  };
  const requestCancel = (request: { headers: { authorization?: unknown } }, reference: unknown,
    expectedRevision: number, signal?: AbortSignal) => cancellation(request, reference, expectedRevision, false, signal);
  const readCancelReceipt = (request: { headers: { authorization?: unknown } }, reference: unknown,
    expectedRevision: number, signal?: AbortSignal) => cancellation(request, reference, expectedRevision, true, signal);
  const cancellationSettlement = (request: { headers: { authorization?: unknown } }, reference: unknown,
    revisionValue: number, observe: boolean, signal?: AbortSignal) => {
    const expectedRevision = z.number().int().min(1).max(4294967294).parse(revisionValue);
    return withOriginalTask(request, reference, observe ? 'read_events' : 'transition_task', signal, async (current, taskId, originalRunId) => {
      const repository = new AiTaskTransitionRepository(d.db, current.authority, d.clock), selector = { taskId, expectedRevision };
      const original = await repository.readCancellationSettlementReceipt(selector);
      if (observe) return original;
      // The ORIGINAL repository locks/CASes the task and proves absence of
      // steps/plans/inputs/results/invocations/resource charges/reservations.
      // Any started/unknown work is refused; TTL is never this evidence.
      const receipt = original.event ? { event: original.event, runRevision: undefined }
        : await repository.settleUnstartedCancellation({ ...selector, to: 'cancelled', reason: 'cancel_settled' }, originalRunId);
      return { receipt, cancellation: 'task_cancelled_not_business_rollback' as const,
        remoteCancellation: 'not_attested' as const, automaticRetry: false as const, admission: 'not_granted' as const };
    });
  };
  const settleUnstartedCancellation = (request: { headers: { authorization?: unknown } }, reference: unknown,
    expectedRevision: number, signal?: AbortSignal) => cancellationSettlement(request, reference, expectedRevision, false, signal);
  const readCancellationSettlementReceipt = (request: { headers: { authorization?: unknown } }, reference: unknown,
    expectedRevision: number, signal?: AbortSignal) => cancellationSettlement(request, reference, expectedRevision, true, signal);
  const readAnswer = (request: { headers: { authorization?: unknown } }, reference: unknown, value: unknown, signal?: AbortSignal) => {
    const submission = structuredClone(value);
    if (!isAiTaskInputSubmissionDraft(submission)) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    return withOriginalTask(request, reference, 'read_metadata', signal, async (current, taskId) => {
      if (submission.taskId !== taskId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      // This exact original answer receipt cannot submit an answer, select a
      // newer question/run, grant a lease or reconstruct execution dependencies.
      return PrismaTaskInputRepository.receiptReader(d.db, current.tasks, d.clock).readSubmission(submission);
    });
  };
  const readResultReview = async (request: { headers: { authorization?: unknown } }, value: unknown,
    resultValue: unknown, expectedTaskId?: string, signal?: AbortSignal) => {
    const reference = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId,
      inputId: inspectionId, expectedRevision: z.number().int().min(1).max(999) }).strict().parse(structuredClone(value));
    const resultId = inspectionId.parse(resultValue), authorization = request?.headers?.authorization;
    if (typeof authorization !== 'string') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    let active = true;
    const requestId = randomUUID(), close = () => { active = false; };
    const credentials = { current: async () => {
      if (!active || signal?.aborted) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      return { authorization, requestId, audience: 'staff' as const };
    } };
    signal?.addEventListener('abort', close, { once: true });
    try {
      return await runWithRequestIdentity({}, async () => {
        const original = await receipts.readCreation({ headers: { authorization } }, reference, signal);
        if (!original.task || expectedTaskId !== undefined && original.task.taskId !== expectedTaskId)
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const dependencies = { db: d.db, auth: d.auth, subscriptions: d.subscriptions, credentials, clock: d.clock };
        const current = composePersistedTaskAuthorization(dependencies);
        const context = await current.authority.resolve(original.task.taskId, 'read_step_terminal');
        const access = aiTaskAccessFromContext(context, original.task.taskId, d.clock?.() ?? new Date());
        const task = await d.db.aiTask.findFirst({ where: access.where, select: { sceneCode: true, sceneVersion: true } });
        const kind = task?.sceneCode === STAFF_RECOGNITION_SCENES.image ? 'image'
          : task?.sceneCode === STAFF_RECOGNITION_SCENES.audio ? 'audio' : null;
        if (!kind || task?.sceneVersion !== '1') throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        const selected = new StaffInspectionRequestFactory({ ...inspection, recognitionResults: { ...dependencies,
          financialEvidence: composePersistedTaskDispatchEvidence(dependencies),
          // Ceiling validates the ORIGINAL frozen input; it is not a new plan,
          // model selection or output allowance for another invocation.
          policy: { kind, sceneCode: task.sceneCode, maxOutputTokens: 32768 } } }).open({ headers: { authorization }, requestId });
        const closeReader = () => selected.close();
        signal?.addEventListener('abort', closeReader, { once: true });
        try {
          if (signal?.aborted) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
          const result = await selected.readRecognitionReview({ ...reference, taskId: original.task.taskId, resultId });
          const after = await receipts.readCreation({ headers: { authorization } }, reference, signal);
          if (requestFingerprint(original) !== requestFingerprint(after)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
          await current.authority.resolve(original.task.taskId, 'read_step_terminal');
          return result;
        } finally { signal?.removeEventListener('abort', closeReader); selected.close(); }
      });
    } finally { signal?.removeEventListener('abort', close); close(); }
  };
  if (!selected.enabled) return { enabled: false as const, staffRequests: new StaffInspectionRequestFactory(inspection),
    application: { create: absent, readCreation: receipts.readCreation.bind(receipts), start: absent, reconcile: absent,
      readResultReview, saveResultReview: absent, readInput: absent, resume: absent, readAnswer,
      continueAnswer: absent, requestCancel, readCancelReceipt, settleUnstartedCancellation, readCancellationSettlementReceipt },
    policies: { read: absent, configure: absent, clear: absent } };
  const select = (kind: 'image' | 'audio', config: z.infer<typeof model>) => ({ db: d.db, auth: d.auth, guard: d.guard,
    subscriptions: d.subscriptions, clock: d.clock, host: structuredClone(selected.host),
    scene: { code: STAFF_RECOGNITION_SCENES[kind], version: '1' },
    gatewayScene: { sceneCode: STAFF_RECOGNITION_SCENES[kind], routeScene: 'vision' as const, maxOutputTokens: config.maxOutputTokens },
    gateway: { secrets: d.secrets, platformProfileId: config.platformProfileId, callPriceVersion: config.callPriceVersion,
      routeScene: 'vision' as const, ...(d.adapters ? { adapters: [...d.adapters] } : { nativeProtocol: 'openai_chat_completions' as const }) } });
  const dependencies: InspectionRecognitionTaskDependencies = { enabled: true, inspection, limits: selected.limits,
    model: select('image', selected.image), ...(selected.audio ? { audioModel: select('audio', selected.audio) } : {}) };
  const application = new InspectionRecognitionTaskApplication(dependencies);
  return { enabled: true as const, staffRequests: new StaffInspectionRequestFactory(inspection),
    application: { create: application.create.bind(application), readCreation: receipts.readCreation.bind(receipts),
      start: application.start.bind(application), reconcile: application.reconcile.bind(application),
      readResultReview, saveResultReview: application.saveResultReview.bind(application),
      readInput: application.readInput.bind(application), resume: application.resume.bind(application),
      readAnswer, continueAnswer: application.continueAnswer.bind(application),
      requestCancel, readCancelReceipt, settleUnstartedCancellation, readCancellationSettlementReceipt },
    policies: composeStaffInspectionTaskPolicies(dependencies, { enabled: true, ttlMs: 120000,
      operations: ['read_metadata', 'read_events', 'read_step_terminal', 'claim_run', 'claim_recovery_run', 'release_run',
        'transition_task', 'takeover_run', 'request_input', 'submit_input', 'resume_input'] }) };
}
