import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, type AiInspectionActorScope } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiTaskRepository, AiTaskRepositoryAuthority } from '../ai-task.repository';
import { AiTaskResultRepository, type AiTaskResultProjection } from '../runner/ai-task-result.repository';
import { parseTaskModelInput, taskModelFingerprint, taskModelIdentity, TASK_IMAGE_MODEL_TOOL, type TaskModelPolicy } from '../model-input/task-model-input';
import { isGatewayResult } from '../gateway-contract-validation';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import { InspectionActionAuthority } from './inspection-action.authority';
import { InspectionRecognitionService } from './inspection-recognition.service';
import { InspectionDraftService } from './inspection-draft.service';
import { InspectionCandidateService, snapshotInspectionCandidates } from './inspection-candidate.service';
import { InspectionAssistError, inspectionId, inspectionTargetSchema, parseInspectionInput } from './inspection-assist.validation';

const referenceSchema = inspectionTargetSchema.extend({ templateId: inspectionId, draftId: inspectionId, inputId: inspectionId,
  expectedRevision: z.number().int().min(1).max(999), taskId: inspectionId, resultId: inspectionId }).strict();
const saveSchema = referenceSchema.extend({ operationId: inspectionId }).strict();
type Reference = z.infer<typeof referenceSchema>;
type Source = {
  db: PrismaClient;
  tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  authority: AiTaskRepositoryAuthority;
  policy: TaskModelPolicy;
  financialEvidence: Pick<PersistedBudgetEvidenceSource, 'readDispatch'>;
  clock?: () => Date;
};
const changed = () => new InspectionAssistError('BINDING_CHANGED');
const targetOf = (input: Reference) => ({ orderId: input.orderId, allocationId: input.allocationId,
  stage: input.stage, templateId: input.templateId });

/** Read persisted original image-step results, never caller payloads or provider SDK
 * messages. Availability is candidate evidence, NOT adoption, approval or execution.
 * No dispatch, model retry, financial write, worker or automatic draft save here. */
export class InspectionRecognitionResultService {
  private readonly source?: Source;
  private readonly results?: AiTaskResultRepository;
  constructor(private readonly authority: InspectionActionAuthority, private readonly recognition?: InspectionRecognitionService,
    private readonly candidates?: InspectionCandidateService, private readonly drafts?: InspectionDraftService, source?: Source) {
    if (source) {
      if (source.policy?.kind !== 'image' || typeof source.financialEvidence?.readDispatch !== 'function') {
        throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      }
      this.source = { ...source, policy: { ...source.policy } };
      this.results = new AiTaskResultRepository(source.db, source.tasks, source.clock);
    }
  }

  async read(value: unknown) {
    const input = parseInspectionInput(referenceSchema, value);
    return (await this.collect(input, false)).projection;
  }

  /** Explicit human/host action. Original operation/revision and original draft
   * receipt are reused; a repeated result is never a second recognition call. */
  async save(value: unknown) {
    const input = parseInspectionInput(saveSchema, value);
    return this.authority.withAction(targetOf(input), 'write', async () => {
      const collected = await this.collect(input, true);
      if (collected.projection.status !== 'available') throw new InspectionAssistError('RECONCILIATION_REQUIRED');
      const request = this.saveRequest(input, collected);
      const receipt = await this.drafts!.reconcileOperation({ kind: 'candidates', request });
      if (receipt.status === 'unavailable') throw new InspectionAssistError('RECONCILIATION_REQUIRED');
      if (receipt.status === 'found') return { status: 'saved' as const, result: receipt.result, execution: 'not_attempted' as const };
      if (collected.currentRevision !== input.expectedRevision) throw new InspectionAssistError('REVISION_CONFLICT');
      const result = await this.drafts!.saveCandidates(request);
      return { status: 'saved' as const, result, execution: 'not_attempted' as const };
    });
  }

  /** Read-only recovery of the SAME save. Absence is not remote no-consumption
   * evidence and does not initiate another write or generate a new operation. */
  async reconcileSave(value: unknown) {
    const input = parseInspectionInput(saveSchema, value), collected = await this.collect(input, true);
    if (collected.projection.status !== 'available') throw new InspectionAssistError('RECONCILIATION_REQUIRED');
    return this.drafts!.reconcileOperation({ kind: 'candidates', request: this.saveRequest(input, collected) });
  }

  private saveRequest(input: z.infer<typeof saveSchema>, collected: Awaited<ReturnType<InspectionRecognitionResultService['collect']>>) {
    return { ...targetOf(input), draftId: input.draftId, expectedRevision: input.expectedRevision, operationId: input.operationId,
      bindingFingerprint: collected.bindingFingerprint, candidates: collected.projection.candidates };
  }

  private async collect(input: Reference, allowReceiptReplay: boolean) {
    if (!this.source || !this.results || !this.recognition || !this.drafts || !this.candidates) {
      throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    }
    const source = this.source, target = targetOf(input);
    return this.authority.withAction(target, 'bind', async scope => {
      const initial = structuredClone(await source.authority.resolve(input.taskId, 'read_step_terminal'));
      this.sameActor(scope, initial);
      const detail = await this.drafts!.read({ ...target, draftId: input.draftId });
      if (detail.revision !== input.expectedRevision && (!allowReceiptReplay || detail.revision < input.expectedRevision)) {
        throw new InspectionAssistError('REVISION_CONFLICT');
      }
      // A newer revision is allowed ONLY to reconstruct the original receipt's
      // canonical request. save() cannot write it at a newer revision.
      const mediaReference = { ...target, draftId: input.draftId, inputId: input.inputId, expectedRevision: detail.revision };
      const bound = await this.recognition!.gatewayMedia(mediaReference);
      const result = await this.results!.read({ taskId: input.taskId, resultId: input.resultId });
      const persisted = await this.readBinding(input, scope, result, taskModelIdentity(initial));
      const expectedText = JSON.stringify({ purpose: 'inspection_candidates_only_not_business_facts', draftId: bound.draftId,
        draftRevision: input.expectedRevision, inputFingerprint: bound.input.inputFingerprint,
        question: bound.input.question, template: bound.input.template });
      const messages = [{ role: 'user', content: [{ kind: 'text', text: expectedText }, ...bound.input.media.map(ref =>
        ({ kind: 'image', attachmentId: ref.attachmentId, attachmentRevision: ref.attachmentRevision }))] }];
      const media = bound.input.media.map(ref => ({ kind: 'image', attachmentId: ref.attachmentId, attachmentRevision: ref.attachmentRevision,
        mediaType: ref.mediaType, contentHash: ref.contentHash, sizeBytes: ref.sizeBytes }));
      if (requestFingerprint(persisted.input.intent.messages) !== requestFingerprint(messages)
        || requestFingerprint(persisted.input.media) !== requestFingerprint(media)) throw changed();
      let values: ReturnType<typeof snapshotInspectionCandidates> = [];
      let status: 'available' | 'unknown' | 'failed' = result.status === 'failed' ? 'failed' : 'unknown';
      const payload = result.payload;
      if (result.status === 'succeeded' && result.completeMeasurement && isGatewayResult(payload)
        && payload.status === 'completed' && payload.usage.kind === 'reported') {
        if (payload.requestId !== persisted.input.intent.requestId || payload.toolRequests.length
          || requestFingerprint(payload.actual) !== requestFingerprint(persisted.input.configuration)
          || Buffer.byteLength(payload.text, 'utf8') > 240000) throw changed();
        let decoded: unknown;
        try { decoded = JSON.parse(payload.text); } catch { throw new InspectionAssistError('INVALID_INPUT'); }
        if (!Array.isArray(decoded)) throw new InspectionAssistError('INVALID_INPUT');
        values = snapshotInspectionCandidates(decoded);
        if (values.some(candidate => candidate.sources.some(ref => ref.kind !== 'image'
          || !bound.input.media.some(original => original.attachmentId === ref.attachmentId
            && original.attachmentRevision === ref.attachmentRevision)))) throw changed();
        values = (await this.candidates!.consume({ ...target, bindingFingerprint: bound.input.bindingFingerprint, candidates: values })).candidates;
        await this.verifyDispatch(persisted, scope, payload.usage);
        status = 'available';
      }
      // Awaiting evidence/template/authorization may change identity or inputs.
      // Never substitute a newer payload under the old task result reference.
      const currentBound = await this.recognition!.gatewayMedia(mediaReference);
      if (requestFingerprint(currentBound.input) !== requestFingerprint(bound.input)) throw changed();
      const currentResult = await this.results!.read({ taskId: input.taskId, resultId: input.resultId });
      if (requestFingerprint(currentResult) !== requestFingerprint(result)) throw changed();
      const current = await source.authority.resolve(input.taskId, 'read_step_terminal');
      this.sameActor(scope, current);
      if (taskModelIdentity(current) !== taskModelIdentity(initial)) throw new InspectionAssistError('ACCESS_DENIED');
      const currentBinding = await this.readBinding(input, scope, currentResult, taskModelIdentity(current));
      if (!isDeepStrictEqual(currentBinding, persisted)) throw changed();
      if (status === 'available' && isGatewayResult(payload) && payload.usage.kind === 'reported') {
        await this.verifyDispatch(currentBinding, scope, payload.usage);
      }
      return { currentRevision: detail.revision, bindingFingerprint: bound.input.bindingFingerprint,
        projection: { status, ...input, candidates: values, resultHash: result.contentHash, inputFingerprint: bound.input.inputFingerprint,
          runId: result.runId, stepId: result.stepId, observedAt: result.observedAt, trust: 'untrusted_candidate' as const,
          recognitionEvidence: status === 'available' ? 'persisted_image_step' as const : 'not_confirmed' as const,
          nextAction: status === 'available' ? 'human_review' as const : 'reconcile_or_manual_review' as const,
          automaticRetry: false as const, persistence: 'not_saved' as const, execution: 'not_attempted' as const } };
    });
  }

  private sameActor(scope: AiInspectionActorScope, context: Awaited<ReturnType<AiTaskRepositoryAuthority['resolve']>>) {
    if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || context.actor.userId !== scope.ownerId
      || context.scope.tenantId !== scope.tenantId || context.scope.workspaceId !== scope.workspaceId || context.audience !== scope.audience) {
      throw new InspectionAssistError('ACCESS_DENIED');
    }
  }

  private async readBinding(reference: Reference, scope: AiInspectionActorScope, result: AiTaskResultProjection, identityHash: string) {
    const source = this.source!;
    const access = await source.tasks.resolveAccess(reference.taskId, 'read_step_terminal');
    return source.db.$transaction(async tx => {
      const task = await tx.aiTask.findFirst({ where: access.where, include: { scope: true } });
      if (!task || task.id !== reference.taskId || task.ownerId !== scope.ownerId || task.ownerKind !== 'USER'
        || task.audience !== scope.audience.toUpperCase() || task.scopeKind !== 'WORKSPACE'
        || task.scope.tenantId !== scope.tenantId || task.scope.workspaceId !== scope.workspaceId
        || task.sceneCode !== source.policy.sceneCode) throw changed();
      const key = { scopeId: task.scopeId, taskId: task.id, runId: result.runId };
      const step = await tx.aiStep.findFirst({ where: { ...key, id: result.stepId } });
      if (!step || step.scopeId !== key.scopeId || step.taskId !== key.taskId || step.runId !== key.runId || step.id !== result.stepId
        || step.actionId !== result.actionId || step.resultRef !== result.resultId || step.toolCode !== TASK_IMAGE_MODEL_TOOL
        || step.toolVersion !== AI_TOOL_DRAFT_VERSION || !step.inputRef) throw changed();
      const saved = await tx.aiTaskActionInput.findFirst({ where: { ...key, id: step.inputRef } });
      if (!saved || saved.id !== step.inputRef || saved.scopeId !== key.scopeId || saved.taskId !== key.taskId || saved.runId !== key.runId
        || saved.toolCode !== step.toolCode || saved.toolVersion !== step.toolVersion || saved.fingerprint !== step.requestFingerprint) throw changed();
      const input = parseTaskModelInput(saved.payload, source.policy);
      if (taskModelFingerprint(input, source.policy) !== saved.fingerprint || input.identityHash !== identityHash) throw changed();
      const invocation = await tx.aiGatewayInvocation.findFirst({ where: { ...key, stepId: step.id, callId: input.intent.requestId } });
      if (!invocation || invocation.scopeId !== key.scopeId || invocation.taskId !== key.taskId || invocation.runId !== key.runId
        || invocation.stepId !== step.id || invocation.actionId !== step.actionId || invocation.actorId !== scope.ownerId
        || invocation.callId !== input.intent.requestId || invocation.stepFingerprint !== step.requestFingerprint
        || invocation.intentHash !== step.requestFingerprint || invocation.mode !== input.mode || invocation.sceneCode !== input.intent.sceneCode
        || invocation.priceVersion !== input.priceVersion || invocation.configurationHash !== requestFingerprint(input.configuration)
        || requestFingerprint(invocation.configuration) !== invocation.configurationHash) throw changed();
      const artifact = await tx.aiTaskResultArtifact.findFirst({ where: { ...key, stepId: step.id, id: result.resultId } });
      if (!artifact || artifact.id !== result.resultId || artifact.scopeId !== key.scopeId || artifact.taskId !== key.taskId
        || artifact.runId !== key.runId || artifact.stepId !== step.id || artifact.actionId !== step.actionId
        || artifact.contentHash !== result.contentHash || artifact.stepFingerprint !== step.requestFingerprint
        || artifact.leaseOwnerId !== invocation.leaseOwnerId || !artifact.fencingToken.equals(invocation.fencingToken)) throw changed();
      return { input, invocation };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
  }

  private async verifyDispatch(binding: Awaited<ReturnType<InspectionRecognitionResultService['readBinding']>>, scope: AiInspectionActorScope,
    usage: { kind: 'reported'; inputTokens: number; outputTokens: number }) {
    const { db, financialEvidence } = this.source!, { invocation, input } = binding;
    const receipt = await db.aiGatewayAccountingReceipt.findFirst({ where: { scopeId: invocation.scopeId, taskId: invocation.taskId, invocationId: invocation.id } });
    if (!receipt || receipt.scopeId !== invocation.scopeId || receipt.taskId !== invocation.taskId || receipt.invocationId !== invocation.id
      || receipt.tenantId !== scope.tenantId || receipt.workspaceId !== scope.workspaceId || receipt.state !== 'dispatched'
      || !receipt.dispatchToken || !receipt.usageHash || receipt.inputTokens !== BigInt(usage.inputTokens)
      || receipt.outputTokens !== BigInt(usage.outputTokens)) throw changed();
    const usageHash = requestFingerprint({ receiptId: receipt.id, invocationId: receipt.invocationId, admissionId: receipt.admissionId,
      reservationId: receipt.reservationId, dispatchToken: receipt.dispatchToken, requestHash: receipt.requestHash,
      usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } });
    if (usageHash !== receipt.usageHash) throw changed();
    const admission = await db.aiInvocationAdmission.findFirst({ where: { id: receipt.admissionId, tenantId: scope.tenantId,
      workspaceId: scope.workspaceId, callId: invocation.callId, actorId: scope.ownerId, dispatchId: receipt.dispatchToken, revokedAt: null } });
    const financial = structuredClone(await financialEvidence.readDispatch(receipt.reservationId));
    if (!admission || admission.id !== receipt.admissionId || admission.requestHash !== receipt.requestHash
      || admission.tenantId !== scope.tenantId || admission.workspaceId !== scope.workspaceId || admission.actorId !== scope.ownerId
      || admission.callId !== invocation.callId || admission.dispatchId !== receipt.dispatchToken || admission.revokedAt !== null
      || admission.profileId !== input.configuration.configId || !['dispatching', 'completed', 'unknown'].includes(admission.status)
      || financial.state !== 'dispatched' || financial.dispatchToken !== receipt.dispatchToken || financial.reservationId !== receipt.reservationId
      || financial.requestId !== invocation.callId || financial.callId !== invocation.callId || financial.actorId !== scope.ownerId
      || financial.scopeKey !== `WORKSPACE:${invocation.scopeId}` || financial.runId !== invocation.runId || financial.stepId !== invocation.stepId
      || financial.actionId !== invocation.actionId || financial.sceneCode !== invocation.sceneCode || financial.priceVersion !== invocation.priceVersion
      || financial.configRevision !== input.configuration.configRevision || financial.configurationHash !== invocation.configurationHash) throw changed();
    const current = await db.aiGatewayAccountingReceipt.findFirst({ where: { id: receipt.id, scopeId: invocation.scopeId, taskId: invocation.taskId } });
    if (!current || !isDeepStrictEqual(current, receipt)) throw changed();
  }
}
