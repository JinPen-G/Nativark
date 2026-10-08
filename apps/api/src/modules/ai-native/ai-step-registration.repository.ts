import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AI_TASK_DRAFT_VERSION, AI_TASK_STEP_CODES, type AiExecutionContext, type AiTaskEventDraft } from "@rental-os/shared";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";
import { aiTaskAccessFromContext, AiTaskRepositoryError } from "./ai-task.repository";
import { isAiStepExecutionContext } from "./task-contract-validation";

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const commandSchema = z.object({
  taskId: id, registrationRef: id, expectedTaskRevision: revision,
  lease: z.object({ runId: id, holderId: id, revision, fencingToken: z.string().regex(/^[1-9][0-9]{0,19}$/u) }).strict()
}).strict();
export type AiStepRegistrationCommand = z.infer<typeof commandSchema>;
const replaySchema = commandSchema.extend({ stepId: id, expectedStepRevision: revision });
export type AiStepReplayCommand = z.infer<typeof replaySchema>;
export interface AiStepReplayAuthority {
  resolve(command: Readonly<AiStepReplayCommand>): Promise<AiExecutionContext>;
}
const grantSchema = z.object({
  context: z.unknown(), registrationAllowed: z.literal(true), authorizationKey: id,
  taskId: id, registrationRef: id, expiresAt: z.string().datetime({ offset: true }),
  toolCode: z.enum(AI_TASK_STEP_CODES), toolVersion: id, inputRef: id,
  requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/u)
}).strict();
export interface AiStepRegistrationAuthority {
  /** Resolve an immutable server action-plan reference and its Core input fingerprint.
   * A model cannot mint the reference or grant. Registration is not permission to execute.
   */
  resolve(command: Readonly<AiStepRegistrationCommand>): Promise<z.infer<typeof grantSchema> & { context: AiExecutionContext }>;
}
const taskSelect = { id: true, scopeId: true, revision: true, eventCursor: true, status: true, contractVersion: true, cancelRequestedAt: true } satisfies Prisma.AiTaskSelect;
const stepSelect = {
  id: true, scopeId: true, taskId: true, runId: true, sequence: true, revision: true,
  actionId: true, requestFingerprint: true, inputRef: true, toolCode: true, toolVersion: true
} satisfies Prisma.AiStepSelect;
type Step = Prisma.AiStepGetPayload<{ select: typeof stepSelect }>;
const conflict = () => new AiTaskRepositoryError("AI_REVISION_CONFLICT");
const denied = () => new AiTaskRepositoryError("AI_ACCESS_DENIED");

/** Creates PENDING/NONE metadata, never a business action or a dispatch permit. */
export class AiStepRegistrationRepository {
  constructor(
    private readonly db: Pick<PrismaClient, "$transaction">,
    private readonly authority: AiStepRegistrationAuthority,
    private readonly clock: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID,
    private readonly readAuthority?: AiStepReplayAuthority
  ) {
    if (!authority || typeof authority.resolve !== "function") throw denied();
  }

  private async resolve(input: AiStepRegistrationCommand) {
    try {
      const grant = grantSchema.parse(structuredClone(await this.authority.resolve(structuredClone(input))));
      if (!isAiStepExecutionContext(grant.context)) throw denied();
      const access = aiTaskAccessFromContext(grant.context, input.taskId, this.clock());
      if (grant.taskId !== input.taskId || grant.registrationRef !== input.registrationRef || Date.parse(grant.expiresAt) <= access.now.getTime()) throw denied();
      const { context, ...evidence } = grant;
      const { authorizedAt: _, requestId: __, ...authorization } = context;
      // This namespace identifies one AI logical action. It is NOT the Core business idempotency key.
      const actionId = `ai-action-${requestFingerprint({ version: "ai-step-registration-1", scope: access.scope, taskId: input.taskId, registrationRef: input.registrationRef })}`;
      return { grant, access, actionId, digest: requestFingerprint({ ...evidence, authorization }) };
    } catch { throw denied(); }
  }

  async register(value: unknown, existingOnly = false) {
    const parsed = commandSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    const input = parsed.data, initial = await this.resolve(input);
    const verifyCurrent = async () => {
      const current = await this.resolve(input);
      if (current.access.bindingKey !== initial.access.bindingKey || current.digest !== initial.digest) throw denied();
      return current;
    };
    try {
      return await this.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: initial.access.where, select: taskSelect });
        if (!task) throw new AiTaskRepositoryError("AI_RESOURCE_UNAVAILABLE");
        if (task.id !== input.taskId || task.contractVersion !== AI_TASK_DRAFT_VERSION) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
        const existing = await tx.aiStep.findFirst({ where: { scopeId: task.scopeId, taskId: task.id, actionId: initial.actionId }, select: stepSelect });
        if (existing) {
          this.verifyExisting(existing, task, initial);
          await verifyCurrent();
          // A stale lease may read its original identity, but receives no fresh lease or dispatch authority.
          return { stepId: existing.id, runId: existing.runId, sequence: existing.sequence, stepRevision: existing.revision,
            taskRevision: task.revision, replayed: true as const, event: null, runRevision: null };
        }
        if (existingOnly) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        if (!["QUEUED", "RUNNING"].includes(task.status) || task.cancelRequestedAt !== null) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
        if (task.revision !== input.expectedTaskRevision || task.eventCursor < 0n || task.eventCursor >= 18446744073709551615n) throw conflict();
        const locked = await tx.aiTask.updateMany({
          where: { ...initial.access.where, scopeId: task.scopeId, revision: task.revision, status: task.status, eventCursor: task.eventCursor, cancelRequestedAt: null },
          data: { revision: { increment: 1 }, eventCursor: { increment: 1n } }
        });
        if (locked.count !== 1) throw conflict();
        const rows = await tx.aiStep.findMany({
          where: { scopeId: task.scopeId, taskId: task.id }, select: { runId: true, sequence: true, status: true }, take: 1001
        });
        if (rows.length >= 1000 || rows.some(row => row.status === "RUNNING" || row.status === "UNKNOWN")) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
        const lease = input.lease;
        const sequences = rows.filter(row => row.runId === lease.runId).map(row => row.sequence);
        if (sequences.some(n => !Number.isInteger(n) || n < 1 || n >= 4294967295)) throw conflict();
        const sequence = Math.max(0, ...sequences) + 1;
        const held = await tx.aiRun.updateMany({
          where: { id: lease.runId, scopeId: task.scopeId, taskId: task.id, revision: lease.revision,
            fencingToken: new Prisma.Decimal(lease.fencingToken), leaseOwnerId: lease.holderId, leaseExpiresAt: { gt: initial.access.now },
            actorKind: initial.access.actorKind, actorId: initial.access.actorId, status: { in: ["QUEUED", "RUNNING"] } },
          data: { revision: { increment: 1 } }
        });
        if (held.count !== 1) throw conflict();
        const current = await verifyCurrent();
        const live = await tx.aiRun.updateMany({
          where: { id: lease.runId, scopeId: task.scopeId, taskId: task.id, revision: lease.revision + 1,
            fencingToken: new Prisma.Decimal(lease.fencingToken), leaseOwnerId: lease.holderId, leaseExpiresAt: { gt: current.access.now },
            actorKind: current.access.actorKind, actorId: current.access.actorId, status: { in: ["QUEUED", "RUNNING"] } },
          data: { authorizedAt: current.access.authorizedAt }
        });
        if (live.count !== 1) throw conflict();
        const stepId = this.newId();
        if (!z.string().uuid().safeParse(stepId).success) throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
        await tx.aiStep.create({ data: {
          id: stepId, scopeId: task.scopeId, taskId: task.id, runId: lease.runId, sequence, revision: 1,
          actionId: initial.actionId, requestFingerprint: current.grant.requestFingerprint, inputRef: current.grant.inputRef,
          toolCode: current.grant.toolCode, toolVersion: current.grant.toolVersion, status: "PENDING", effect: "NONE", resultRef: null, errorCode: null
        }, select: { id: true } });
        const event: AiTaskEventDraft = {
          contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, taskRevision: task.revision + 1,
          cursor: (task.eventCursor + 1n).toString(), occurredAt: current.access.now.toISOString(), type: "step.registered",
          data: { stepId, runId: lease.runId, sequence, stepRevision: 1 }
        };
        await tx.aiTaskEvent.create({ data: {
          scopeId: task.scopeId, taskId: task.id, cursor: task.eventCursor + 1n, taskRevision: task.revision + 1, type: event.type, occurredAt: current.access.now,
          payload: { data: event.data, registration: { reference: input.registrationRef, digest: current.digest },
            initiator: { kind: "worker", id: lease.holderId, actorKind: current.access.actorKind, actorId: current.access.actorId } }
        }, select: { cursor: true } });
        return { stepId, runId: lease.runId, sequence, stepRevision: 1, taskRevision: task.revision + 1,
          replayed: false as const, event, runRevision: lease.revision + 1 };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      // Even a uniqueness race never retries a write; an explicit caller replay reads the existing action.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict();
      throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
    }
  }

  async readReplay(value: unknown) {
    const parsed = replaySchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    const input = parsed.data;
    const { stepId, expectedStepRevision, ...registration } = input;
    const initial = await this.resolve(registration);
    const authorizeRead = async () => {
      try {
        if (!this.readAuthority) throw denied();
        const context = structuredClone(await this.readAuthority.resolve(structuredClone(input)));
        if (!isAiStepExecutionContext(context)) throw denied();
        const access = aiTaskAccessFromContext(context, input.taskId, this.clock());
        if (access.bindingKey !== initial.access.bindingKey) throw denied();
        const { requestId: _, authorizedAt: __, ...identity } = context;
        return { access, digest: requestFingerprint(identity) };
      } catch { throw denied(); }
    };
    const before = await authorizeRead();
    try {
      return await this.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: before.access.where, select: taskSelect });
        if (!task || task.contractVersion !== AI_TASK_DRAFT_VERSION) throw new AiTaskRepositoryError("AI_RESOURCE_UNAVAILABLE");
        const row = await tx.aiStep.findFirst({ where: { id: stepId, scopeId: task.scopeId, taskId: task.id, runId: input.lease.runId },
          select: { ...stepSelect, status: true, effect: true, resultRef: true, errorCode: true } });
        if (!row) throw new AiTaskRepositoryError("AI_RESOURCE_UNAVAILABLE");
        this.verifyExisting(row, task, initial);
        if (row.id !== stepId || row.runId !== input.lease.runId || row.revision !== expectedStepRevision) throw conflict();
        const status = row.status.toLowerCase();
        if (!["pending", "running", "succeeded", "failed", "unknown", "cancelled"].includes(status)
          || (["succeeded", "failed", "unknown"].includes(status) && !id.safeParse(row.resultRef).success)
          || (status === "unknown" && row.effect !== "POSSIBLE")
          || (status === "succeeded" && !["NONE", "COMMITTED"].includes(row.effect))) throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
        const current = await this.resolve(registration);
        if (current.digest !== initial.digest) throw denied();
        const after = await authorizeRead();
        if (after.digest !== before.digest) throw denied();
        return { stepId: row.id, runId: row.runId, sequence: row.sequence, stepRevision: row.revision,
          taskRevision: task.revision, status: row.status.toLowerCase() as import("@rental-os/shared").AiStepStatusDraft,
          resultRef: row.resultRef, errorCode: row.errorCode };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
    }
  }

  private verifyExisting(row: Step, task: { id: string; scopeId: string }, initial: Awaited<ReturnType<AiStepRegistrationRepository["resolve"]>>) {
    if (row.scopeId !== task.scopeId || row.taskId !== task.id || row.actionId !== initial.actionId
      || row.requestFingerprint !== initial.grant.requestFingerprint || row.inputRef !== initial.grant.inputRef
      || row.toolCode !== initial.grant.toolCode || row.toolVersion !== initial.grant.toolVersion) throw conflict();
    if (!id.safeParse(row.id).success || !id.safeParse(row.runId).success || !Number.isInteger(row.sequence) || row.sequence < 1 || row.sequence > 4294967295
      || !Number.isInteger(row.revision) || row.revision < 1 || row.revision > 4294967295) throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
  }
}
