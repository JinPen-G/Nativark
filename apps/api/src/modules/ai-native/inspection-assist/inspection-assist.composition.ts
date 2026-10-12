import { Module, type DynamicModule } from '@nestjs/common';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { runWithRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiStaffInspectionHostProjection } from '@rental-os/shared';
import type { AiTaskInputSource } from '../task-input/task-input.ports';
import type { PrismaClient } from '@prisma/client';
import { InspectionActionAuthority } from './inspection-action.authority';
import { PrismaInspectionDraftRepository } from './prisma-inspection-draft.repository';
import { PrismaInspectionEvidenceAuthority } from './prisma-inspection-evidence.authority';
import { InspectionDraftService } from './inspection-draft.service';
import { InspectionSubmissionService } from './inspection-submission.service';
import { InspectionRecognitionService, inspectionRecognitionMediaKind } from './inspection-recognition.service';
import { InspectionRecognitionResultService } from './inspection-recognition-result.service';
import { composePersistedTaskAuthorization, type PersistedTaskAuthorizationDependencies } from '../task-authorization.composition';
import { taskAudioMaterialSchema, taskImageMaterialSchema, type TaskModelPolicy } from '../model-input/task-model-input';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import { OriginalInspectionApplication } from './original-inspection.application';
import type { FileStorageRuntimeService } from '../../integrations/file-storage.runtime.service';
import type { RentalCoreController } from '../../rental-core/rental-core.controller';
import type { RentalIdempotencyRepository } from '../../rental-core/rental-idempotency.repository';
import { InspectionTemplateService } from './inspection-template.service';
import { InspectionManualPreparationService } from './inspection-manual-preparation.service';
import { InspectionCandidateService, type InspectionEvidenceAuthority } from './inspection-candidate.service';
import { InspectionAssistError } from './inspection-assist.validation';
import { inspectionTargetSchema, inspectionId } from './inspection-assist.validation';
import { composeTaskModelHost, type TaskModelHostDependencies } from '../runner/model-task-host.composition';
import { AI_STAFF_INSPECTION_REQUESTS, AI_STAFF_INSPECTION_ENABLED, StaffInspectionAssistController } from './staff-inspection-assist.controller';

/** Server composition only: material comes from the original authorized frozen
 * inspection input, never a request-provided prompt/hash or an SDK result. */
export async function composeInspectionRecognitionTaskHost(recognition: Pick<InspectionRecognitionService, 'gatewayMedia'>,
  reference: unknown, dependencies: Omit<TaskModelHostDependencies, 'kind' | 'task'> & {
    task: Omit<TaskModelHostDependencies['task'], 'material'>;
  }) {
  if (typeof recognition?.gatewayMedia !== 'function') throw new InspectionAssistError('STORAGE_UNAVAILABLE');
  const bound = await recognition.gatewayMedia(structuredClone(reference));
  const kind = inspectionRecognitionMediaKind(bound.input);
  const text = JSON.stringify({ purpose: 'inspection_candidates_only_not_business_facts',
    draftId: bound.draftId, draftRevision: bound.draftRevision, inputFingerprint: bound.input.inputFingerprint,
    question: bound.input.question, template: bound.input.template });
  const material = (kind === 'audio' ? taskAudioMaterialSchema : taskImageMaterialSchema).parse({
    maxOutputTokens: dependencies.gatewayScene.maxOutputTokens,
    messages: [{ role: 'user', content: [{ kind: 'text', text }, ...bound.input.media.map(ref => ({ kind,
      attachmentId: ref.attachmentId, attachmentRevision: ref.attachmentRevision }))] }] });
  return composeTaskModelHost({ ...dependencies, kind,
    runtime: { ...dependencies.runtime, ports: { ...dependencies.runtime.ports, media: bound.media } },
    task: { ...dependencies.task, material } });
}

type Dependencies = ConstructorParameters<typeof InspectionTemplateService>[0] & {
  /** Server-only dependencies; credentials are bound by THIS request factory,
   * never independently supplied by an external result caller. */
  recognitionResults?: Omit<PersistedTaskAuthorizationDependencies, 'credentials'> & {
    policy: TaskModelPolicy; financialEvidence: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>;
  };
  audioRecognitionResults?: Omit<PersistedTaskAuthorizationDependencies, 'credentials'> & {
    policy: TaskModelPolicy; financialEvidence: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>;
  };
  evidence?: InspectionEvidenceAuthority;
  storage?: Pick<FileStorageRuntimeService, 'readInspectionBytes'>;
  originalInspection?: { controller: Pick<RentalCoreController, 'createInspection'>; receipts: Pick<RentalIdempotencyRepository, 'find'> };
  db?: Pick<PrismaClient, '$transaction' | 'aiInspectionDraft' | 'aiInspectionOperation' | 'aiInspectionEvidenceBinding' | 'fileAsset'>;
};

/** Server-side request binding only. Neither this factory nor the credentials
 * grant inspection permission; every service still runs the original Guard.
 * Do not populate this argument from a model or an inspection request body. */
export class StaffInspectionRequestFactory {
  constructor(private readonly dependencies: Omit<Dependencies, 'credentials'>) {}

  /** One request, one private credential lifetime and one original service graph.
   * Closing a request is not a claim that any remote operation was cancelled. */
  async withRequest<T>(request: { headers: { authorization?: unknown } }, consume: (services: ReturnType<StaffInspectionRequestFactory['open']>) => Promise<T>) {
    const services = this.open({ headers: { authorization: request?.headers?.authorization }, requestId: randomUUID() });
    try { return await runWithRequestIdentity({}, () => consume(services)); }
    finally { services.close(); }
  }

  open(request: { headers: { authorization?: unknown }; requestId: unknown }) {
    const token = request?.headers?.authorization;
    const requestId = request?.requestId;
    if (typeof token !== 'string' || token.length < 1 || token.length > 8192
      || typeof requestId !== 'string' || requestId.length > 191
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(requestId)) {
      throw new InspectionAssistError('ACCESS_DENIED');
    }
    // Snapshot scalars, never retain the mutable incoming request or share a
    // credential source between requests. close() erases our token reference.
    let authorization: string | undefined = token;
    const credentials = {
      async current() {
        if (authorization === undefined) throw new InspectionAssistError('ACCESS_DENIED');
        return { authorization, requestId, audience: 'staff' as const };
      },
    };
    const services = composeInspectionAssist({ ...this.dependencies, credentials });
    const authority = new InspectionActionAuthority(this.dependencies.guard, credentials);
    return { ...services,
      readHost: async (value: unknown): Promise<AiStaffInspectionHostProjection> => {
        if (!services.drafts) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
        const detail = await services.drafts.read(structuredClone(value));
        const before = await services.templates.read(detail.target);
        if (before.audience !== 'staff' || before.bindingFingerprint !== detail.bindingFingerprint) throw new InspectionAssistError('BINDING_CHANGED');
        const permitted = async (action: 'write' | 'bind') => {
          try { return await authority.withAction(detail.target, action, async () => true); }
          catch (error) { if (error instanceof InspectionAssistError && error.code === 'ACCESS_DENIED') return false; throw error; }
        };
        const canWrite = await permitted('write'), canBind = await permitted('bind');
        const after = await services.templates.read(detail.target);
        if (after.audience !== 'staff' || requestFingerprint(after) !== requestFingerprint(before)) throw new InspectionAssistError('BINDING_CHANGED');
        const context = { tenantId: after.scope.tenantId, workspaceId: after.scope.workspaceId,
          ownerId: after.owner.actorId, audience: 'staff' as const };
        return { serverEnabled: true, context, target: structuredClone(detail.target), draftId: detail.draftId,
          revision: detail.revision, templateVersion: detail.templateVersion, bindingFingerprint: detail.bindingFingerprint,
          actionId: `inspection.action:${requestFingerprint({ context, target: detail.target, draftId: detail.draftId })}`,
          capabilities: { edit: canWrite, evidence: canBind && !!services.evidence,
            review: canWrite && !!services.submission, submit: canWrite && !!services.submission
              && typeof this.dependencies.originalInspection?.controller?.createInspection === 'function'
              && typeof this.dependencies.originalInspection?.receipts?.find === 'function' },
          observedAt: new Date().toISOString(), execution: 'not_attested' };
      },
      /** Actual employee consumption entry. Receipt lookup is explicit and
       * retains its existing stronger action permission; never silently
       * downgrade a denied receipt request into a successful draft read. */
      readCurrentReview: async (value: unknown, includeReceipt = false) => {
        if (typeof includeReceipt !== 'boolean') throw new InspectionAssistError('INVALID_INPUT');
        if (!services.drafts) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
        const review = await services.drafts.readReview(value);
        if (!includeReceipt) return { review, receipt: { status: 'not_requested' as const }, businessActionRequested: false as const };
        if (!services.submission) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
        const receipt = await services.submission.readReceipt({ ...review.target, draftId: review.draftId });
        const current = await services.drafts.readReview(value);
        if (requestFingerprint(current) !== requestFingerprint(review)) throw new InspectionAssistError('REVISION_CONFLICT');
        return { review, receipt, businessActionRequested: false as const };
      },
      recognitionTaskHost: (reference: unknown, dependencies: Parameters<typeof composeInspectionRecognitionTaskHost>[2]) => {
        if (!services.recognition || authorization === undefined) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
        // The task host must use the same request session as media/draft reads.
        // A second supplied credential source cannot swap the invocation actor.
        return composeInspectionRecognitionTaskHost(services.recognition, reference, {
          ...dependencies, credentials,
        });
      },
      close() { authorization = undefined; } };
  }
}

export function composeInspectionAssist(dependencies: Dependencies) {
  const templates = new InspectionTemplateService(dependencies);
  const authority = new InspectionActionAuthority(dependencies.guard, dependencies.credentials);
  const evidence = dependencies.db ? new PrismaInspectionEvidenceAuthority(dependencies.db, authority, templates, dependencies.storage) : undefined;
  const manual = new InspectionManualPreparationService(templates, evidence);
  const candidates = new InspectionCandidateService(templates, evidence ?? dependencies.evidence);
  const repository = dependencies.db ? new PrismaInspectionDraftRepository(dependencies.db) : undefined;
  const drafts = repository ? new InspectionDraftService(repository, authority, templates, manual, candidates, evidence) : undefined;
  const original = dependencies.originalInspection ? new OriginalInspectionApplication(dependencies.guard, dependencies.credentials,
    dependencies.originalInspection.controller, dependencies.originalInspection.receipts) : undefined;
  const submission = repository && drafts && evidence ? new InspectionSubmissionService(repository, drafts, authority, templates, manual, evidence, dependencies.core, original) : undefined;
  const recognition = repository && drafts && evidence ? new InspectionRecognitionService(repository, drafts, authority, templates, evidence) : undefined;
  const resultSource = dependencies.recognitionResults;
  const resultAuthorization = resultSource ? composePersistedTaskAuthorization({ ...resultSource, credentials: dependencies.credentials }) : undefined;
  const primaryResults = new InspectionRecognitionResultService(authority, recognition, candidates, drafts,
    resultSource && resultAuthorization ? { ...resultSource, tasks: resultAuthorization.tasks, authority: resultAuthorization.authority } : undefined);
  const audioSource = dependencies.audioRecognitionResults;
  if (audioSource && (!resultSource || audioSource.policy.kind !== 'audio' || resultSource.policy.kind !== 'image'
    || audioSource.db !== resultSource.db || audioSource.auth !== resultSource.auth
    || audioSource.policy.sceneCode === resultSource.policy.sceneCode)) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
  const audioAuthorization = audioSource ? composePersistedTaskAuthorization({ ...audioSource, credentials: dependencies.credentials }) : undefined;
  const audioResults = audioSource && audioAuthorization ? new InspectionRecognitionResultService(authority, recognition, candidates, drafts,
    { ...audioSource, tasks: audioAuthorization.tasks, authority: audioAuthorization.authority }) : undefined;
  // Keep per-kind services immutable. Never mutate one instance's policy while
  // another request awaits authorization or financial evidence.
  const selectResults = async (value: unknown) => {
    if (!recognition || !drafts || !audioResults) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    const reference = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId,
      inputId: inspectionId, expectedRevision: z.number().int().min(1).max(999) }).parse((() => {
      const input = z.record(z.unknown()).parse(structuredClone(value));
      return Object.fromEntries(['orderId','allocationId','templateId','stage','draftId','inputId','expectedRevision'].map(key => [key,input[key]]));
    })());
    const detail = await drafts.read({ orderId: reference.orderId, allocationId: reference.allocationId,
      templateId: reference.templateId, stage: reference.stage, draftId: reference.draftId });
    const frozen = await recognition.gatewayMedia({ ...reference, expectedRevision: detail.revision });
    return inspectionRecognitionMediaKind(frozen.input) === 'audio' ? audioResults : primaryResults;
  };
  const recognitionResults = !audioResults ? primaryResults : {
    read: async (value: unknown) => (await selectResults(value)).read(value),
    save: async (value: unknown) => (await selectResults(value)).save(value),
    reconcileSave: async (value: unknown) => (await selectResults(value)).reconcileSave(value),
    inputSource: (value: unknown): AiTaskInputSource => {
      const reference = structuredClone(value);
      return Object.freeze({ resolve: async (...args: Parameters<AiTaskInputSource['resolve']>) =>
        (await selectResults(reference)).inputSource(reference).resolve(...args),
      validateAnswers: async (...args: Parameters<AiTaskInputSource['validateAnswers']>) =>
        (await selectResults(reference)).inputSource(reference).validateAnswers(...args) });
    }
  };
  /** Persisted result + current human review, not adoption or business facts.
   * Shared by explicit server composition and the request-bound staff factory. */
  const readRecognitionReview = async (value: unknown) => {
    if (!drafts) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    const reference = structuredClone(value);
    const result = await recognitionResults.read(reference);
    const target = { orderId: result.orderId, allocationId: result.allocationId,
      stage: result.stage, templateId: result.templateId, draftId: result.draftId };
    return authority.withAction(target, 'bind', async () => {
      const review = await drafts.readReview(target);
      if (review.revision !== result.expectedRevision || review.binding !== 'current') throw new InspectionAssistError('BINDING_CHANGED');
      const current = await recognitionResults.read(reference);
      if (requestFingerprint(current) !== requestFingerprint(result)) throw new InspectionAssistError('BINDING_CHANGED');
      const finalReview = await drafts.readReview(target);
      if (requestFingerprint(finalReview) !== requestFingerprint(review)) throw new InspectionAssistError('REVISION_CONFLICT');
      return { recognition: result, review, adoption: 'not_attempted' as const,
        businessActionRequested: false as const, automaticRetry: false as const };
    });
  };
  /** Read the original candidate-save receipt and the CURRENT human draft.
   * A saved receipt does not adopt a value and cannot revive an older revision. */
  const readRecognitionSaveReview = async (value: unknown) => {
    if (!drafts) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    const reference = structuredClone(value);
    const receipt = await recognitionResults.reconcileSave(reference);
    const input = z.record(z.unknown()).parse(reference);
    const target = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId }).parse(
      Object.fromEntries(['orderId', 'allocationId', 'stage', 'templateId', 'draftId'].map(key => [key, input[key]])));
    return authority.withAction(target, 'bind', async () => {
      const review = await drafts.readReview(target);
      const currentReceipt = await recognitionResults.reconcileSave(reference);
      if (requestFingerprint(currentReceipt) !== requestFingerprint(receipt)) throw new InspectionAssistError('REVISION_CONFLICT');
      const currentReview = await drafts.readReview(target);
      if (requestFingerprint(currentReview) !== requestFingerprint(review)) throw new InspectionAssistError('REVISION_CONFLICT');
      if (review.binding !== 'current') throw new InspectionAssistError('BINDING_CHANGED');
      return { receipt, review,
        savedRevisionMatchesCurrent: receipt.status === 'found' && receipt.result.draftId === review.draftId && receipt.result.revision === review.revision,
        adoption: 'not_attempted' as const, businessActionRequested: false as const, automaticRetry: false as const };
    });
  };
  const saveRecognitionReview = async (value: unknown) => {
    const reference = structuredClone(value);
    const saved = await recognitionResults.save(reference);
    const observation = await readRecognitionSaveReview(reference);
    if (observation.receipt.status !== 'found' || requestFingerprint(observation.receipt.result) !== requestFingerprint(saved.result)) {
      throw new InspectionAssistError('RECONCILIATION_REQUIRED');
    }
    return { ...observation, receipt: saved };
  };
  return { templates, manual, candidates, drafts, evidence, submission, recognition, recognitionResults, readRecognitionReview,
    readRecognitionSaveReview, saveRecognitionReview };
}

/** No Controller/AppModule/worker registration. Original business pages remain available. */
@Module({})
export class InspectionAssistModule {
  static registerStaffHttp(dependencies: Omit<Dependencies, 'credentials'>, configuration: { enabled: boolean }): DynamicModule {
    if (configuration?.enabled !== true || !dependencies.db || typeof dependencies.guard?.canActivate !== 'function') {
      throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    }
    return { module: InspectionAssistModule, controllers: [StaffInspectionAssistController],
      providers: [{ provide: AI_STAFF_INSPECTION_REQUESTS, useValue: new StaffInspectionRequestFactory(dependencies) },
        { provide: AI_STAFF_INSPECTION_ENABLED, useValue: true }], exports: [AI_STAFF_INSPECTION_REQUESTS] };
  }
  /** Preferred server integration: keep shared ports in DI, bind credentials
   * separately for each incoming staff request, close in the handler's finally.
   * No globally mutable session provider is required by this registration. */
  static registerStaffRequests(dependencies: Omit<Dependencies, 'credentials'>): DynamicModule {
    return { module: InspectionAssistModule,
      providers: [{ provide: StaffInspectionRequestFactory, useValue: new StaffInspectionRequestFactory(dependencies) }],
      exports: [StaffInspectionRequestFactory] };
  }

  static register(dependencies: Dependencies): DynamicModule {
    const services = composeInspectionAssist(dependencies);
    return { module: InspectionAssistModule, providers: [{ provide: InspectionTemplateService, useValue: services.templates },
      { provide: StaffInspectionRequestFactory, useValue: new StaffInspectionRequestFactory(dependencies) },
      { provide: InspectionManualPreparationService, useValue: services.manual },
      { provide: InspectionCandidateService, useValue: services.candidates },
      { provide: InspectionRecognitionResultService, useValue: services.recognitionResults },
      ...(services.drafts ? [{ provide: InspectionDraftService, useValue: services.drafts }] : []),
      ...(services.evidence ? [{ provide: PrismaInspectionEvidenceAuthority, useValue: services.evidence }] : []),
      ...(services.submission ? [{ provide: InspectionSubmissionService, useValue: services.submission }] : []),
      ...(services.recognition ? [{ provide: InspectionRecognitionService, useValue: services.recognition }] : [])],
      exports: [StaffInspectionRequestFactory, InspectionTemplateService, InspectionManualPreparationService, InspectionCandidateService, InspectionRecognitionResultService,
        ...(services.drafts ? [InspectionDraftService] : []), ...(services.evidence ? [PrismaInspectionEvidenceAuthority] : []),
        ...(services.submission ? [InspectionSubmissionService] : []), ...(services.recognition ? [InspectionRecognitionService] : [])] };
  }
}
