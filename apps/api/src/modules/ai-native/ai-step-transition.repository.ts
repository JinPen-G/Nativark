import { Prisma, type PrismaClient, type AiStepStatus, type AiStepEffect } from "@prisma/client";
import { z } from "zod";
import { isAiStepExecutionContext as validContext, isAiStepState as validStep } from "./task-contract-validation";
import { createHash } from "node:crypto";
import {
  AI_TASK_DRAFT_VERSION, AI_STEP_TRANSITION_REASONS_DRAFT, AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE,
  type AiExecutionContext, type AiStepStateDraft, type AiTaskEventDraft
} from "@rental-os/shared";
import { aiTaskAccessFromContext, AiTaskRepositoryError } from "./ai-task.repository";
import { aiPersistenceScopeColumns } from "./persistence-scope";
import { evaluateAiStepTransitionDraft } from "./task-transition-draft";
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const commandSchema = z.object({
  taskId: id, stepId: id, expectedTaskRevision: revision, expectedStepRevision: revision,
  evidenceId: id, reason: z.enum(AI_STEP_TRANSITION_REASONS_DRAFT),
  lease: z.object({ runId: id, holderId: id, revision, fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict()
}).strict();
export type AiStepTransitionCommand = z.infer<typeof commandSchema>;

/** Supplied by a server evidence reader, never a model or a client-provided outcome.
 * The authority must recheck the real subject, permissions, action input and immutable
 * result/reconciliation evidence. No default authority or dispatch is provided here.
 */
export interface AiStepTransitionGrant {
  context: AiExecutionContext;
  transitionAllowed: true;
  authorizationKey: string;
  taskId: string;
  evidenceId: string;
  evidenceRevision: number;
  expiresAt: string;
  reason: AiStepTransitionCommand["reason"];
  previous: AiStepStateDraft;
  next: AiStepStateDraft;
  previousResultRef: string | null;
  resultRef: string | null;
}
export interface AiStepTransitionAuthority {
  resolve(command: Readonly<AiStepTransitionCommand>, tx?: Prisma.TransactionClient): Promise<AiStepTransitionGrant>;
}
/** The transaction callback finished, but COMMIT acknowledgement was not
 * reliable. The durable step/event may exist; never replay the business effect. */
export class AiStepTransitionResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN' as const;
  readonly retryable = false;
  readonly nextAction = 'reconcile' as const;
  constructor() { super('AI_RESULT_UNKNOWN'); }
}
const grantSchema = z.object({
  context: z.unknown(), transitionAllowed: z.literal(true), authorizationKey: id, taskId: id,
  evidenceId: id, evidenceRevision: revision, expiresAt: z.string().datetime({ offset: true }),
  reason: z.enum(AI_STEP_TRANSITION_REASONS_DRAFT), previous: z.unknown(), next: z.unknown(),
  previousResultRef: id.nullable(), resultRef: id.nullable()
}).strict();

const errorCode = (step: AiStepStateDraft) => "error" in step.outcome ? step.outcome.error.code : null;
const hasResult = (step: AiStepStateDraft) => ["succeeded", "failed", "unknown"].includes(step.outcome.status);
const denied = () => new AiTaskRepositoryError("AI_ACCESS_DENIED");
const conflict = () => new AiTaskRepositoryError("AI_REVISION_CONFLICT");
const taskSelect = { id: true, scopeId: true, revision: true, eventCursor: true, status: true, contractVersion: true, cancelRequestedAt: true } satisfies Prisma.AiTaskSelect;
const stepSelect = {
  id: true, scopeId: true, taskId: true, runId: true, sequence: true, revision: true,
  actionId: true, requestFingerprint: true, toolCode: true, toolVersion: true,
  status: true, effect: true, resultRef: true, errorCode: true
} satisfies Prisma.AiStepSelect;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

/** Writes only step lifecycle metadata under the task lock; never executes a business tool.
 * Existing steps must have been registered separately. An ambiguous commit is not retried.
 */
export class AiStepTransitionRepository {
  constructor(
    private readonly db: Pick<PrismaClient, "$transaction">,
    private readonly authority: AiStepTransitionAuthority,
    private readonly clock: () => Date = () => new Date()
  ) {
    if (!authority || typeof authority.resolve !== "function") throw denied();
  }

  private async resolve(command: AiStepTransitionCommand, tx?: Prisma.TransactionClient) {
    try {
      const raw = structuredClone(await this.authority.resolve(structuredClone(command), tx));
      const metadata = grantSchema.parse(raw);
      if (!validContext(metadata.context) || !validStep(metadata.previous) || !validStep(metadata.next)) throw denied();
      const grant = raw; // The cloned authority value has passed the closed envelope and C04 schemas.
      const access = aiTaskAccessFromContext(grant.context, command.taskId, this.clock());
      if (grant.taskId !== command.taskId || grant.evidenceId !== command.evidenceId || grant.reason !== command.reason
        || Date.parse(grant.expiresAt) <= access.now.getTime() || grant.previous.stepId !== command.stepId
        || grant.previous.runId !== command.lease.runId || grant.previous.revision !== command.expectedStepRevision
        || hasResult(grant.previous) !== (grant.previousResultRef !== null) || hasResult(grant.next) !== (grant.resultRef !== null)) throw denied();
      for (const step of [grant.previous, grant.next]) {
        if (!Number.isInteger(step.sequence) || step.sequence > 4294967295 || step.revision > 4294967295) throw denied();
        if (step.outcome.status === "succeeded") {
          if (step.outcome.effect === "committed" && !step.outcome.facts.some(fact => fact.basis.kind === "current" || fact.basis.kind === "snapshot")) throw denied();
          for (const fact of step.outcome.facts) {
            if (canonical(aiPersistenceScopeColumns(fact.scope)) !== canonical(access.scope) || Date.parse(fact.observedAt) > access.now.getTime()) throw denied();
          }
        }
      }
      const { context, ...evidence } = grant;
      const { authorizedAt: _, requestId: __, ...authorization } = context;
      const encoded = canonical({ ...evidence, authorization });
      if (Buffer.byteLength(encoded) > 131072) throw denied();
      return { access, grant, digest: createHash("sha256").update(encoded).digest("hex") };
    } catch { throw denied(); }
  }

  async transition(value: unknown) {
    const parsed = commandSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    const input = parsed.data, initial = await this.resolve(input);
    let writeAttempted = false, callbackCompleted = false;
    try {
      return await this.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: initial.access.where, select: taskSelect });
        if (!task) throw new AiTaskRepositoryError("AI_RESOURCE_UNAVAILABLE");
        if (task.id !== input.taskId || task.contractVersion !== AI_TASK_DRAFT_VERSION || !["RUNNING", "WAITING_EXTERNAL", "CANCEL_REQUESTED"].includes(task.status)
          || (task.status === "CANCEL_REQUESTED") !== (task.cancelRequestedAt !== null)) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
        const terminalModel = [AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE]
          .some(code => code === initial.grant.next.toolCode) && ['succeeded', 'failed'].includes(initial.grant.next.outcome.status);
        if (terminalModel) {
          // Publish only an actual, measured artifact belonging to this exact
          // transition. A result reference/unknown outcome alone proves nothing.
          const artifact = await tx.aiTaskResultArtifact.findFirst({ where: { id: initial.grant.resultRef!,
            scopeId: task.scopeId, taskId: task.id, runId: input.lease.runId, stepId: input.stepId } });
          if (!artifact || artifact.id !== initial.grant.resultRef || artifact.scopeId !== task.scopeId || artifact.taskId !== task.id
            || artifact.runId !== input.lease.runId || artifact.stepId !== input.stepId
            || artifact.actionId !== initial.grant.next.actionId || artifact.stepFingerprint !== initial.grant.next.requestFingerprint
            || artifact.outcome.toLowerCase() !== initial.grant.next.outcome.status || !artifact.completeMeasurement
            || requestFingerprint(artifact.payload) !== artifact.contentHash
            || typeof artifact.outputBytes !== 'bigint' || artifact.outputBytes < 0n
            || BigInt(Buffer.byteLength(JSON.stringify(artifact.payload), 'utf8')) !== artifact.outputBytes) throw denied();
        }
        const eventCount = terminalModel ? 2n : 1n;
        if (task.revision !== input.expectedTaskRevision || task.eventCursor < 0n || task.eventCursor > 18446744073709551615n - eventCount) throw conflict();
        writeAttempted = true;
        const reserved = await tx.aiTask.updateMany({
          where: { ...initial.access.where, scopeId: task.scopeId, revision: task.revision, eventCursor: task.eventCursor, status: task.status, cancelRequestedAt: task.cancelRequestedAt },
          data: { revision: { increment: 1 }, eventCursor: { increment: eventCount } }
        });
        if (reserved.count !== 1) throw conflict();
        const row = await tx.aiStep.findFirst({ where: { id: input.stepId, scopeId: task.scopeId, taskId: task.id, runId: input.lease.runId }, select: stepSelect });
        if (!row) throw new AiTaskRepositoryError("AI_RESOURCE_UNAVAILABLE");
        const previous = initial.grant.previous;
        if (row.id !== previous.stepId || row.scopeId !== task.scopeId || row.taskId !== task.id
          || row.runId !== previous.runId || row.sequence !== previous.sequence || row.revision !== previous.revision
          || row.actionId !== previous.actionId || row.requestFingerprint !== previous.requestFingerprint
          || row.toolCode !== previous.toolCode || row.toolVersion !== previous.toolVersion
          || row.status.toLowerCase() !== previous.outcome.status || row.effect.toLowerCase() !== previous.outcome.effect
          || row.errorCode !== errorCode(previous) || row.resultRef !== initial.grant.previousResultRef) throw conflict();
        const lease = input.lease;
        // Acquire the run row after the task lock. Reauthorize after any lease-lock wait.
        const held = await tx.aiRun.updateMany({
          where: { id: lease.runId, scopeId: task.scopeId, taskId: task.id, revision: lease.revision,
            fencingToken: new Prisma.Decimal(lease.fencingToken), leaseOwnerId: lease.holderId,
            leaseExpiresAt: { gt: initial.access.now }, actorKind: initial.access.actorKind, actorId: initial.access.actorId,
            status: { in: ["QUEUED", "RUNNING"] } },
          data: { revision: { increment: 1 } }
        });
        if (held.count !== 1) throw conflict();
        const current = await this.resolve(input, tx);
        if (current.access.bindingKey !== initial.access.bindingKey || current.digest !== initial.digest) throw denied();
        const next = current.grant.next;
        if (next.outcome.status === "running" && (task.status !== "RUNNING" || task.cancelRequestedAt !== null)) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
        const decision = evaluateAiStepTransitionDraft(previous, next, input.reason);
        if (!decision.allowed) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
        const live = await tx.aiRun.updateMany({
          where: { id: lease.runId, scopeId: task.scopeId, taskId: task.id, revision: lease.revision + 1,
            fencingToken: new Prisma.Decimal(lease.fencingToken), leaseOwnerId: lease.holderId,
            leaseExpiresAt: { gt: current.access.now }, actorKind: current.access.actorKind, actorId: current.access.actorId,
            status: { in: ["QUEUED", "RUNNING"] } },
          data: { authorizedAt: current.access.authorizedAt }
        });
        if (live.count !== 1) throw conflict();
        const changed = await tx.aiStep.updateMany({
          where: { ...row },
          data: { status: next.outcome.status.toUpperCase() as AiStepStatus, effect: next.outcome.effect.toUpperCase() as AiStepEffect,
            revision: { increment: 1 }, resultRef: current.grant.resultRef, errorCode: errorCode(next) }
        });
        if (changed.count !== 1) throw conflict();
        const event: AiTaskEventDraft = {
          contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, cursor: (task.eventCursor + 1n).toString(),
          taskRevision: task.revision + 1, occurredAt: current.access.now.toISOString(), type: "step.changed",
          data: { stepId: row.id, runId: row.runId, stepRevision: decision.nextRevision, status: next.outcome.status, reason: input.reason }
        };
        await tx.aiTaskEvent.create({ data: {
          scopeId: task.scopeId, taskId: task.id, cursor: task.eventCursor + 1n, taskRevision: task.revision + 1,
          type: event.type, occurredAt: current.access.now,
          payload: { data: event.data, initiator: { kind: "worker", id: lease.holderId, actorKind: current.access.actorKind, actorId: current.access.actorId },
            evidence: { id: current.grant.evidenceId, revision: current.grant.evidenceRevision, digest: current.digest } }
        }, select: { cursor: true } });
        if (terminalModel) await tx.aiTaskEvent.create({ data: {
          scopeId: task.scopeId, taskId: task.id, cursor: task.eventCursor + 2n, taskRevision: task.revision + 1,
          type: 'task.output_ready', occurredAt: current.access.now,
          payload: { data: { resultId: current.grant.resultRef! },
            initiator: { kind: 'worker', id: lease.holderId, actorKind: current.access.actorKind, actorId: current.access.actorId },
            evidence: { id: current.grant.evidenceId, revision: current.grant.evidenceRevision, digest: current.digest } }
        }, select: { cursor: true } });
        callbackCompleted = true;
        return { event, runRevision: lease.revision + 1 };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 10000 });
    } catch (error) {
      // Once the callback returned, an error-shaped acknowledgement cannot
      // prove rollback, even if it resembles a known CAS/access refusal.
      if (callbackCompleted) throw new AiStepTransitionResultUnknownError();
      if (error instanceof AiTaskRepositoryError) throw error;
      if (writeAttempted) throw new AiStepTransitionResultUnknownError();
      throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
    }
  }
}
