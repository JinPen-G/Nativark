/** Current-authorized original conversation/model material for display preparation.
 * Reads the existing Task, input lineage, measured Artifact and business source
 * reader. This internal packet is not an HTTP response or display admission;
 * reading it cannot publish a plan, renew execution rights or invoke a model. */
import type { PrismaClient } from '@prisma/client';
import { hasEffectivePermission } from '../../common/permission-match';
import { AI_TASK_CENTER_ENTRY_PERMISSIONS, AI_TOOL_DRAFT_VERSION,
  type AiConversationModelResultReadDraft } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository } from './ai-task.repository';
import type { AiScopeRepository } from './ai-scope.repository';
import type { AiConversationRepository } from './conversation.repository';
import { conversationCommand } from './conversation-contract';
import type { PrismaModelStepEvidenceAuthority } from './model-input/prisma-model-step-evidence.authority';
import { TASK_TEXT_MODEL_TOOL, parseTaskModelInput, taskModelFingerprint, taskModelPolicy,
  type TaskModelPolicy } from './model-input/task-model-input';
import { parseTaskModelDisplayWitness } from './model-input/task-model-display-witness';
import { isGatewayResult } from './gateway-contract-validation';
import { readOriginalSceneEnvelope } from './scenes/original-scene-knowledge';
import { validateAiSceneModelObservation } from './scenes/scene-observation-contracts';
import type { PrismaOriginalRequestRepository } from './task-request/prisma-original-request.repository';
import { readOriginalTaskModelProvenance } from './task-request/prisma-original-request.repository';
import { originalIdentityHash } from './task-request/original-request.authority';
import { freezeOriginalInput } from './task-request/original-request.validation';
import { readTaskModelRunOrigin } from './task-input/prisma-task-input.repository';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiTaskActionInput' | 'aiTaskResultArtifact'>;
export interface AiWorkbenchDisplayOriginalDependencies {
  db: Db;
  scopes: Pick<AiScopeRepository, 'resolveCurrent'>;
  conversations: Pick<AiConversationRepository, 'readAdmission'>;
  originals: Pick<PrismaOriginalRequestRepository, 'readHistorical'>;
  tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  evidence: Pick<PrismaModelStepEvidenceAuthority, 'readOriginalCompletedEvidence'>;
  observations: { readModelResult(value: unknown): Promise<unknown> };
  policy: TaskModelPolicy;
  /** Operator-only control provenance. Ordinary hosts keep the answer reader. */
  readRunOrigin?: typeof readTaskModelRunOrigin;
}
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);
function receiptBinding(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  const { state: _state, ...original } = value as Record<string, unknown>;
  // Natural expiry changes the read projection, never the frozen source record.
  return requestFingerprint(original);
}
function taskBinding(row: NonNullable<Awaited<ReturnType<Db['aiTask']['findFirst']>>>) {
  return { id: row.id, scopeId: row.scopeId, ownerKind: row.ownerKind, ownerId: row.ownerId,
    audience: row.audience, scopeKind: row.scopeKind, creationKey: row.creationKey,
    inputRef: row.inputRef, inputRevision: row.inputRevision, inputHash: row.inputHash,
    sceneCode: row.sceneCode, sceneVersion: row.sceneVersion, revision: row.revision,
    status: row.status, resultRef: row.resultRef, archivedAt: row.archivedAt?.toISOString() ?? null,
    cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null };
}
function inputBinding(row: NonNullable<Awaited<ReturnType<Db['aiTaskActionInput']['findFirst']>>>) {
  return { id: row.id, scopeId: row.scopeId, taskId: row.taskId, runId: row.runId,
    registrationRef: row.registrationRef, toolCode: row.toolCode, toolVersion: row.toolVersion,
    fingerprint: row.fingerprint, payloadHash: requestFingerprint(row.payload),
    policyRevision: row.policyRevision, expiresAt: row.expiresAt.toISOString() };
}

export class AiWorkbenchDisplayOriginalReader {
  private readonly policy: TaskModelPolicy;
  constructor(private readonly input: AiWorkbenchDisplayOriginalDependencies) {
    this.policy = taskModelPolicy(input.policy);
    if (this.policy.kind || typeof input.observations?.readModelResult !== 'function') throw unavailable();
  }
  private async current() {
    const current = await this.input.scopes.resolveCurrent(), context = current.context;
    if (context.audience !== 'operator' || context.actor.kind !== 'user' || context.scope.kind !== 'workspace'
      || !('access' in context) || !AI_TASK_CENTER_ENTRY_PERMISSIONS.some(code => hasEffectivePermission(context.access.permissions, code))) throw denied();
    return { ...current, ownerId: context.actor.userId, identity: originalIdentityHash(context) };
  }

  async read(value: unknown) {
    const command = conversationCommand('AiConversationModelResultReadDraft', value);
    const reference = { draftVersion: command.draftVersion, conversationId: command.conversationId, admissionKey: command.admissionKey };
    const before = await this.current(), admission = await this.input.conversations.readAdmission(reference), turn = admission.result;
    if (!turn?.task || turn.material !== 'retained' || turn.capabilityCode !== this.policy.sceneCode) throw unavailable();
    const original = await this.input.originals.readHistorical(turn.original);
    if (original.receipt.state === 'revoked' || originalIdentityHash(original.context) !== before.identity) throw denied();
    if (original.receipt.inputRef !== turn.original.inputRef || original.receipt.requestKey !== turn.originalRequestKey
      || original.receipt.sceneCode !== turn.capabilityCode || original.receipt.sceneVersion !== turn.capabilityVersion
      || requestFingerprint(original.request) !== turn.requestHash) throw unavailable();
    const access = await this.input.tasks.resolveAccess(turn.task.taskId, 'read_step_terminal');
    if (access.actorKind !== 'USER' || access.actorId !== before.ownerId || access.audience !== 'OPERATOR') throw denied();
    const task = await this.input.db.aiTask.findFirst({ where: access.where });
    if (!task || task.id !== turn.task.taskId || task.scopeId !== before.scope.id || task.ownerId !== before.ownerId
      || task.ownerKind !== 'USER' || task.audience !== 'OPERATOR' || task.scopeKind !== 'WORKSPACE'
      || task.inputRef !== original.receipt.inputRef || task.inputHash !== original.receipt.contentHash
      || task.inputRevision !== original.receipt.revision || task.sceneCode !== turn.capabilityCode
      || task.sceneVersion !== turn.capabilityVersion || task.creationKey !== `scene-request:${task.inputRef}`) throw denied();
    const key = { scopeId: task.scopeId, taskId: task.id };
    const locator = await this.input.db.aiTaskResultArtifact.findFirst({ where: { ...key, id: command.resultId }, select: { stepId: true } });
    if (!locator) throw unavailable();
    const completed = await this.input.evidence.readOriginalCompletedEvidence(task.id, locator.stepId, command.resultId);
    if (originalIdentityHash(completed.context) !== before.identity || completed.step.scopeId !== key.scopeId
      || completed.step.taskId !== task.id || completed.step.resultRef !== command.resultId
      || completed.step.toolCode !== TASK_TEXT_MODEL_TOOL || completed.step.toolVersion !== AI_TOOL_DRAFT_VERSION
      || !completed.step.inputRef) throw denied();
    const stored = await this.input.db.aiTaskActionInput.findFirst({ where: { ...key, runId: completed.step.runId, id: completed.step.inputRef } });
    if (!stored || stored.id !== completed.step.inputRef || stored.scopeId !== key.scopeId || stored.taskId !== key.taskId
      || stored.runId !== completed.step.runId || stored.toolCode !== completed.step.toolCode
      || stored.toolVersion !== completed.step.toolVersion || stored.fingerprint !== completed.step.fingerprint) throw denied();
    const modelInput = parseTaskModelInput(stored.payload, this.policy), envelope = readOriginalSceneEnvelope(modelInput);
    // The trusted publisher seals this witness before the original plan/input
    // fingerprint. An ordinary completed result can never acquire it on read.
    if (!modelInput.displayWitness) throw unavailable();
    const witness = parseTaskModelDisplayWitness(modelInput.displayWitness);
    if (!same(witness.binding.original, turn.original) || witness.binding.conversationId !== command.conversationId
      || witness.binding.turnId !== turn.turnId || witness.binding.taskId !== task.id
      || witness.binding.capabilityCode !== turn.capabilityCode || witness.binding.capabilityVersion !== turn.capabilityVersion
      || witness.binding.inputFingerprint !== task.inputHash || witness.binding.materialHash !== envelope.materialHash
      || !same(witness.context.scope, before.context.scope)
      || Date.parse(witness.sourceExpiresAt) > Date.parse(original.receipt.expiresAt)) throw denied();
    if (Date.parse(witness.sourceExpiresAt) <= Date.parse(before.context.authorizedAt)) throw unavailable();
    if (taskModelFingerprint(modelInput, this.policy) !== completed.step.fingerprint
      || completed.evidence.inputRef !== stored.id || completed.evidence.inputHash !== requestFingerprint(modelInput)
      || requestFingerprint(envelope.facts) !== envelope.materialHash
      || receiptBinding(envelope.original) !== receiptBinding(original.receipt)) throw denied();
    const readLineage = (currentTask: typeof task, currentAccess: typeof access) => this.input.db.$transaction(async tx => {
      const provenance = await readOriginalTaskModelProvenance(tx, currentTask);
      const run = await tx.aiRun.findFirst({ where: { ...key, id: completed.step.runId } });
      if (!run || run.id !== completed.step.runId || run.scopeId !== key.scopeId || run.taskId !== task.id
        || run.actorKind !== currentAccess.actorKind || run.actorId !== currentAccess.actorId
        || !Number.isSafeInteger(run.sequence) || run.sequence < 1 || run.sequence > 4294967294) throw denied();
      const origin = await (this.input.readRunOrigin ?? readTaskModelRunOrigin)(tx, currentAccess, { ...key, runId: completed.step.runId,
        originRunId: turn.task!.runId, registrationRef: `scene-model:${original.receipt.inputRef}`, includeHistory: true });
      if (origin.registrationRef !== stored.registrationRef || provenance.authorizationHash !== modelInput.identityHash) throw denied();
      if (witness.presentationRevision !== run.sequence) throw denied();
      return { provenance, origin, generationRevision: run.sequence };
    });
    const lineage = await readLineage(task, access);
    const gateway = completed.artifact.payload;
    if (!isGatewayResult(gateway) || gateway.status !== 'completed' || gateway.usage.kind !== 'reported'
      || gateway.requestId !== modelInput.intent.requestId || !same(gateway.actual, modelInput.configuration)) throw unavailable();
    const observation = validateAiSceneModelObservation(await this.input.observations.readModelResult({ original: turn.original, resultId: command.resultId }));
    if (observation.status !== 'available' || observation.taskId !== task.id || observation.runId !== completed.step.runId
      || observation.resultId !== command.resultId || observation.sceneCode !== turn.capabilityCode
      || observation.materialHash !== envelope.materialHash || receiptBinding(observation.original) !== receiptBinding(original.receipt)) throw unavailable();
    const afterAdmission = await this.input.conversations.readAdmission(reference);
    const afterOriginal = await this.input.originals.readHistorical(turn.original);
    const afterAccess = await this.input.tasks.resolveAccess(task.id, 'read_step_terminal');
    const afterTask = await this.input.db.aiTask.findFirst({ where: afterAccess.where });
    const afterStored = await this.input.db.aiTaskActionInput.findFirst({ where: { ...key, id: stored.id, runId: stored.runId } });
    if (!afterTask || !afterStored || !same(taskBinding(task), taskBinding(afterTask))
      || !same(inputBinding(stored), inputBinding(afterStored)) || !same(lineage, await readLineage(afterTask, afterAccess))) throw denied();
    const afterEvidence = await this.input.evidence.readOriginalCompletedEvidence(task.id, locator.stepId, command.resultId);
    const after = await this.current();
    if (before.identity !== after.identity || before.scope.id !== after.scope.id || !same(admission, afterAdmission)
      || afterOriginal.receipt.state === 'revoked' || originalIdentityHash(afterOriginal.context) !== before.identity
      || receiptBinding(afterOriginal.receipt) !== receiptBinding(original.receipt) || access.bindingKey !== afterAccess.bindingKey
      || originalIdentityHash(afterEvidence.context) !== before.identity || !same(completed.step, afterEvidence.step)
      || !same(completed.artifact, afterEvidence.artifact) || !same(completed.evidence, afterEvidence.evidence)) throw denied();
    if (Date.parse(witness.sourceExpiresAt) <= Date.parse(after.context.authorizedAt)) throw unavailable();
    const bindingHash = requestFingerprint({ identity: before.identity, scopeId: key.scopeId, admission,
      original: receiptBinding(original.receipt), taskId: task.id, taskRevision: task.revision,
      inputRef: stored.id, inputFingerprint: stored.fingerprint, inputHash: requestFingerprint(modelInput),
      step: completed.step, resultHash: completed.artifact.contentHash, lineage });
    return freezeOriginalInput({ command, bindingHash, context: after.context, scopeId: key.scopeId, turn,
      witness, generationRevision: lineage.generationRevision,
      original: afterOriginal.receipt, request: original.request, task: { taskId: task.id, originRunId: turn.task.runId,
        revision: task.revision, status: task.status, inputFingerprint: task.inputHash, inputRevision: task.inputRevision },
      model: { step: completed.step, inputRef: stored.id, registrationRef: stored.registrationRef,
        inputFingerprint: stored.fingerprint, input: modelInput, result: completed.artifact, evidence: completed.evidence },
      envelope, lineage: lineage.origin, observation });
  }
  async revalidate(value: AiConversationModelResultReadDraft, bindingHash: string) {
    const current = await this.read(value);
    if (!/^[a-f0-9]{64}$/u.test(bindingHash) || current.bindingHash !== bindingHash) throw denied();
    return current;
  }
}
export type AiWorkbenchDisplayOriginalMaterial = Awaited<ReturnType<AiWorkbenchDisplayOriginalReader['read']>>;
