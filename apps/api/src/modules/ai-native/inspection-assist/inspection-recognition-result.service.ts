import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AI_TOOL_DRAFT_VERSION, AI_TASK_INPUT_DRAFT_VERSION, validateAiTaskInputAnswersDraft, type AiInspectionActorScope } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiTaskRepository, AiTaskRepositoryAuthority } from '../ai-task.repository';
import { AiTaskResultRepository, type AiTaskResultProjection } from '../runner/ai-task-result.repository';
import { parseTaskModelInput, taskModelFingerprint, taskModelIdentity, continueTaskModelMaterial, TASK_IMAGE_MODEL_TOOL, TASK_AUDIO_MODEL_TOOL, type TaskModelPolicy, type TaskModelInput } from '../model-input/task-model-input';
import { readTaskModelRunOrigin } from '../task-input/prisma-task-input.repository';
import type { AiTaskInputSource } from '../task-input/task-input.ports';
import { isGatewayResult } from '../gateway-contract-validation';
import type { PersistedBudgetEvidenceSource } from '../budget/budget-dependency-adapters';
import { InspectionActionAuthority } from './inspection-action.authority';
import { InspectionRecognitionService } from './inspection-recognition.service';
import { InspectionDraftService } from './inspection-draft.service';
import { InspectionCandidateService, snapshotInspectionCandidates } from './inspection-candidate.service';
import { InspectionAssistError, inspectionId, inspectionTargetSchema, parseInspectionInput } from './inspection-assist.validation';
import { type RecognitionSaveAssociation } from './inspection-recognition-save.association';
import { unrecordedInspectionRecognitionBasis, type InspectionRecognitionBasisIssue } from './inspection-recognition-basis.service';
import { inspectionRecognitionMessages } from './inspection-recognition-prompt';

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
      if (!['image', 'audio'].includes(source.policy?.kind ?? '') || typeof source.financialEvidence?.readDispatch !== 'function') {
        throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      }
      this.source = { ...source, policy: { ...source.policy } };
      this.results = new AiTaskResultRepository(source.db, source.tasks, source.clock);
    }
  }

  private get modelTool() { return this.source?.policy.kind === 'audio' ? TASK_AUDIO_MODEL_TOOL : TASK_IMAGE_MODEL_TOOL; }

  async read(value: unknown) {
    const input = parseInspectionInput(referenceSchema, value);
    return (await this.collect(input, false)).projection;
  }
  /** Server review evidence derived from the SAME validated persisted result,
   * not model-supplied hashes or permission to reopen an attachment. */
  async readEvidence(value: unknown) {
    const input = parseInspectionInput(referenceSchema, value), collected = await this.collect(input, false);
    return { recognition: collected.projection, sourceEvidence: collected.sourceEvidence };
  }

  /** Server-bound frozen input -> current persisted candidate evidence -> human
   * clarification. Caller/model text never supplies a question contract or a
   * new attachment. Answers remain context, not corrections or submission. */
  inputSource(value: unknown): AiTaskInputSource {
    const reference = referenceSchema.omit({ taskId: true, resultId: true }).parse(structuredClone(value));
    const resolve: AiTaskInputSource['resolve'] = async presented => {
      const binding = structuredClone(presented), source = this.source;
      if (!source || binding.toolCode !== this.modelTool || binding.toolVersion !== AI_TOOL_DRAFT_VERSION) throw changed();
      const projection = await this.read({ ...reference, taskId: binding.taskId, resultId: binding.basisResultRef });
      if (projection.status !== 'available' || projection.runId !== binding.runId || projection.stepId !== binding.stepId) {
        throw new InspectionAssistError('RECONCILIATION_REQUIRED');
      }
      const before = await source.tasks.resolveAccess(binding.taskId, 'read_step_terminal');
      const task = await source.db.aiTask.findFirst({ where: before.where });
      if (!task || task.id !== binding.taskId || task.scopeId !== binding.scopeId
        || task.inputRef !== reference.inputId || task.sceneCode !== source.policy.sceneCode) throw changed();
      const run = await source.db.aiRun.findFirst({ where: { scopeId: binding.scopeId, taskId: binding.taskId, id: binding.runId } });
      const policy = await source.db.aiTaskPlanPolicy.findFirst({ where: {
        scopeId: binding.scopeId, sceneCode: task.sceneCode, sceneVersion: task.sceneVersion
      } });
      if (!run || run.scopeId !== binding.scopeId || run.taskId !== binding.taskId || run.id !== binding.runId
        || run.actorId !== before.actorId || run.actorKind !== before.actorKind
        || !Number.isSafeInteger(run.sequence) || run.sequence < 1
        || !policy || policy.scopeId !== binding.scopeId || policy.sceneCode !== source.policy.sceneCode
        || policy.sceneVersion !== task.sceneVersion
        || !policy.enabled || !(policy.expiresAt instanceof Date)
        || !Number.isFinite(policy.expiresAt.getTime())
        || policy.expiresAt <= (source.clock?.() ?? new Date())
        || requestFingerprint(policy.allowedTools) !== requestFingerprint([{ code: this.modelTool, version: AI_TOOL_DRAFT_VERSION }])) throw changed();
      const ceilings = z.object({ maxCalls: z.number().int().positive() }).passthrough().parse(policy.limits);
      const after = await source.tasks.resolveAccess(binding.taskId, 'read_step_terminal');
      if (before.bindingKey !== after.bindingKey) throw new InspectionAssistError('ACCESS_DENIED');
      const unclear = projection.candidates.filter(candidate => candidate.status === 'missing' || candidate.status === 'blurred');
      if (!unclear.length || run.sequence >= Math.min(ceilings.maxCalls, 31)) return { kind: 'not_required' };
      return { kind: 'required', inputRef: binding.inputRef, inputHash: binding.inputHash, expiresAt: policy.expiresAt.toISOString(),
        contract: { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, code: 'inspection_context', version: '1',
          fields: [{ fieldId: 'clarification_text', kind: 'text', required: true, maxLength: 2048,
            label: `请说明原检查材料中不明确的字段：${[...new Set(unclear.map(candidate => candidate.fieldCode))].join('、').slice(0, 55)}；仍需人工核对。` }] } };
    };
    return Object.freeze<AiTaskInputSource>({ resolve, validateAnswers: async (binding, contract, answers) => {
      const expected = await resolve(structuredClone(binding));
      if (expected.kind !== 'required' || requestFingerprint(contract) !== requestFingerprint(expected.contract)
        || !validateAiTaskInputAnswersDraft(expected.contract, answers)) throw new InspectionAssistError('ACCESS_DENIED');
      return { disposition: 'context_only' as const, planHash: binding.planHash, inputRef: binding.inputRef, inputHash: binding.inputHash };
    } });
  }

  /** Explicit human/host action. Original operation/revision and original draft
   * receipt are reused; a repeated result is never a second recognition call. */
  async save(value: unknown) {
    const input = parseInspectionInput(saveSchema, value);
    return this.authority.withAction(targetOf(input), 'write', async scope => {
      const original = await this.readSavedReceipt(input);
      if (original.status === 'found') return { status: 'saved' as const, result: original.result, execution: 'not_attempted' as const };
      const collected = await this.collect(input, true);
      if (collected.projection.status !== 'available') throw new InspectionAssistError('RECONCILIATION_REQUIRED');
      const request = this.saveRequest(input, collected);
      const receipt = await this.drafts!.reconcileOperation({ kind: 'candidates', request });
      if (receipt.status === 'unavailable') throw new InspectionAssistError('RECONCILIATION_REQUIRED');
      if (receipt.status === 'found') return { status: 'saved' as const, result: receipt.result, execution: 'not_attempted' as const };
      if (collected.currentRevision !== input.expectedRevision) throw new InspectionAssistError('REVISION_CONFLICT');
      const association: RecognitionSaveAssociation = { version: 1, reference: input, scope,
        runId: collected.projection.runId, stepId: collected.projection.stepId,
        actionId: collected.association.actionId, actionInputId: collected.association.actionInputId,
        inputHash: collected.association.inputHash, resultHash: collected.projection.resultHash,
        inputFingerprint: collected.projection.inputFingerprint, bindingFingerprint: collected.bindingFingerprint,
        candidateHash: requestFingerprint(request.candidates),
        commandHash: requestFingerprint({ kind: 'inspection.draft.candidates', scope, input: request }) };
      const result = await this.drafts!.saveCandidates(request, association);
      return { status: 'saved' as const, result, execution: 'not_attempted' as const };
    });
  }

  /** Read-only recovery of the SAME save. Absence is not remote no-consumption
   * evidence and does not initiate another write or generate a new operation. */
  async reconcileSave(value: unknown) {
    const input = parseInspectionInput(saveSchema, value);
    const original = await this.readSavedReceipt(input);
    if (original.status === 'found') return original;
    // Legacy receipts have no immutable recognition association. Only the
    // original full-command path can verify them; never backfill old evidence.
    const collected = await this.collect(input, true);
    if (collected.projection.status !== 'available') throw new InspectionAssistError('RECONCILIATION_REQUIRED');
    return this.drafts!.reconcileOperation({ kind: 'candidates', request: this.saveRequest(input, collected) });
  }

  async readSavedReceipt(value: unknown) {
    const input = parseInspectionInput(saveSchema, value);
    if (!this.drafts) throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    return this.drafts.reconcileRecognitionSave(input);
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
      let messages = inspectionRecognitionMessages({ ...bound, draftRevision: input.expectedRevision }, source.policy.kind!);
      const media = bound.input.media.map(ref => ({ kind: source.policy.kind, attachmentId: ref.attachmentId, attachmentRevision: ref.attachmentRevision,
        mediaType: ref.mediaType, contentHash: ref.contentHash, sizeBytes: ref.sizeBytes }));
      for (const round of persisted.history) {
        const parent = parseTaskModelInput(round.input, source.policy);
        if (taskModelFingerprint(parent, source.policy) !== round.inputHash || parent.identityHash !== taskModelIdentity(initial)
          || requestFingerprint(parent.intent.messages) !== requestFingerprint(messages)
          || requestFingerprint(parent.media) !== requestFingerprint(media)) throw changed();
        messages = continueTaskModelMaterial(parent, round.result, round.answers, source.policy).messages;
      }
      if (requestFingerprint(persisted.input.intent.messages) !== requestFingerprint(messages)
        || requestFingerprint(persisted.input.media) !== requestFingerprint(media)) throw changed();
      let values: ReturnType<typeof snapshotInspectionCandidates> = [];
      let basisIssues: InspectionRecognitionBasisIssue[] = [];
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
        if (bound.input.outputContract === 'inspection-candidate-source-text-1'
          && values.some(candidate => candidate.status === 'candidate' && (candidate.sourceText === undefined
            || candidate.value.kind !== 'boolean' && candidate.value.kind !== 'photo' && !candidate.sourceText.trim()))) {
          throw new InspectionAssistError('INVALID_INPUT');
        }
        if (values.some(candidate => candidate.sources.some(ref => ref.kind !== source.policy.kind
          || !bound.input.media.some(original => original.attachmentId === ref.attachmentId
            && original.attachmentRevision === ref.attachmentRevision
            && (ref.kind !== 'audio' || original.durationMs !== null && ref.span.endMs <= original.durationMs))))) throw changed();
        const checked = await this.candidates!.consume({ ...target, bindingFingerprint: bound.input.bindingFingerprint, candidates: values }, bound.input.basis);
        values = checked.candidates; basisIssues = checked.basisIssues;
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
      const sourceEvidence = values.map(candidate => ({ candidateId: candidate.candidateId,
        sources: candidate.sources.map(position => {
          const original = bound.input.media.find(item => item.attachmentId === position.attachmentId
            && item.attachmentRevision === position.attachmentRevision);
          if (!original) throw changed();
          return { position: structuredClone(position), contentHash: original.contentHash,
            mediaType: original.mediaType, sizeBytes: original.sizeBytes };
        }) }));
      return { currentRevision: detail.revision, bindingFingerprint: bound.input.bindingFingerprint, sourceEvidence,
        association: { actionId: result.actionId, actionInputId: persisted.actionInputId,
          inputHash: taskModelFingerprint(persisted.input, source.policy) },
        projection: { status, ...input, candidates: values, resultHash: result.contentHash, inputFingerprint: bound.input.inputFingerprint,
          basis: bound.input.basis ?? unrecordedInspectionRecognitionBasis(), basisIssues,
          reviewIssues: [...new Set(basisIssues.map(issue => issue.code))],
          runId: result.runId, stepId: result.stepId, observedAt: result.observedAt, trust: 'untrusted_candidate' as const,
          recognitionEvidence: status === 'available' ? (source.policy.kind === 'audio' ? 'persisted_audio_step' as const : 'persisted_image_step' as const) : 'not_confirmed' as const,
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
        || step.actionId !== result.actionId || step.resultRef !== result.resultId || step.toolCode !== this.modelTool
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
      const run = await tx.aiRun.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, id: result.runId } });
      if (!run || run.id !== result.runId || run.scopeId !== task.scopeId || run.taskId !== task.id) throw changed();
      const lineage = await readTaskModelRunOrigin(tx, access, { scopeId: task.scopeId, taskId: task.id,
        runId: run.id, originRunId: run.resourceOriginRunId ?? run.id, registrationRef: saved.registrationRef, includeHistory: true });
      if (lineage.registrationRef !== saved.registrationRef) throw changed();
      return { input, invocation, actionInputId: saved.id, history: lineage.history };
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
