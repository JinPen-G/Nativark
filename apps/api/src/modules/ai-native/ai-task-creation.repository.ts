import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { AI_TASK_DRAFT_VERSION, type AiExecutionContext } from "@rental-os/shared";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";
import { aiTaskAccessFromContext, AiTaskRepositoryError } from "./ai-task.repository";

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const commandSchema = z.object({ creationKey: id.max(128), sceneCode: id.max(128), inputRef: id }).strict();
const grantSchema = z.object({
  context: z.unknown(), creationAllowed: z.literal(true), sceneCode: id.max(128), sceneVersion: id.max(64),
  inputRef: id, inputRevision: z.number().int().positive().max(4294967295), inputHash: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict();

/** Must authorize the real principal, scene and immutable input reference. No allow-all implementation is supplied. */
export interface AiTaskCreationAuthority {
  resolve(sceneCode: string, inputRef: string): Promise<{
    context: AiExecutionContext; creationAllowed: true; sceneCode: string; sceneVersion: string;
    inputRef: string; inputRevision: number; inputHash: string;
  }>;
}
const selectedTask = {
  id: true, status: true, revision: true, contractVersion: true, archivedAt: true, creationKey: true, creationFingerprint: true,
  runs: { where: { sequence: 1 }, select: { id: true }, take: 1 }
} satisfies Prisma.AiTaskSelect;
type TaskRow = Prisma.AiTaskGetPayload<{ select: typeof selectedTask }>;

/** Creates metadata only. No tool, provider call, input body or business transaction is executed. */
export class AiTaskCreationRepository {
  constructor(
    private readonly db: Pick<PrismaClient, "$transaction" | "aiScope" | "aiTask">,
    private readonly authority: AiTaskCreationAuthority,
    private readonly clock: () => Date = () => new Date(),
    private readonly newId: () => string = randomUUID
  ) {
    if (!authority || typeof authority.resolve !== "function") throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
  }

  private async grant(sceneCode: string, inputRef: string, candidateId: string) {
    let value: unknown;
    try { value = await this.authority.resolve(sceneCode, inputRef); }
    catch { throw new AiTaskRepositoryError("AI_ACCESS_DENIED"); }
    const parsed = grantSchema.safeParse(value);
    if (!parsed.success || parsed.data.sceneCode !== sceneCode || parsed.data.inputRef !== inputRef) throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
    const grant = parsed.data;
    const access = aiTaskAccessFromContext(grant.context as AiExecutionContext, candidateId, this.clock());
    return { grant, access, fingerprint: requestFingerprint({
      version: "ai-task-creation-1", scope: access.scope, audience: access.audience, ownerKind: access.actorKind, ownerId: access.actorId,
      authorizationBinding: access.bindingKey, sceneCode: grant.sceneCode, sceneVersion: grant.sceneVersion,
      inputRef: grant.inputRef, inputRevision: grant.inputRevision, inputHash: grant.inputHash
    }) };
  }

  private result(row: TaskRow, creationKey: string, fingerprint: string, replayed: boolean) {
    if (row.creationKey !== creationKey || row.creationFingerprint !== fingerprint) throw new AiTaskRepositoryError("AI_REVISION_CONFLICT");
    if (row.contractVersion !== AI_TASK_DRAFT_VERSION) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    if (row.archivedAt) throw new AiTaskRepositoryError("AI_RESOURCE_UNAVAILABLE");
    if (row.runs.length !== 1) throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
    return { taskId: row.id, runId: row.runs[0].id, status: row.status.toLowerCase(), revision: row.revision, replayed };
  }

  async readCreation(value: unknown) {
    const parsed = commandSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    const input = parsed.data;
    const initial = await this.grant(input.sceneCode, input.inputRef, input.creationKey);
    const where: Prisma.AiTaskWhereInput = {
      scope: { is: initial.access.scope }, scopeKind: initial.access.scope.kind,
      audience: initial.access.audience, ownerKind: initial.access.actorKind, ownerId: initial.access.actorId, creationKey: input.creationKey
    };
    let row: TaskRow | null = null, observed = false;
    try { row = await this.db.aiTask.findFirst({ where, select: selectedTask }); observed = true; }
    catch { /* A failed read cannot prove that the original creation did not commit. */ }
    const current = await this.grant(input.sceneCode, input.inputRef, input.creationKey);
    if (current.access.bindingKey !== initial.access.bindingKey) throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
    if (current.fingerprint !== initial.fingerprint) throw new AiTaskRepositoryError("AI_REVISION_CONFLICT");
    if (!observed || !row) return { state: observed ? "not_observed" as const : "unknown" as const,
      creationKey: input.creationKey, retryable: false as const, nextAction: "reconcile" as const, task: null };
    return { state: "observed" as const, creationKey: input.creationKey, retryable: false as const,
      nextAction: "read_original_task" as const, task: this.result(row, input.creationKey, initial.fingerprint, true) };
  }

  async create(value: unknown) {
    const parsed = commandSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    const input = parsed.data, candidateId = this.newId();
    if (!z.string().uuid().safeParse(candidateId).success) throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
    const initial = await this.grant(input.sceneCode, input.inputRef, candidateId);
    const where: Prisma.AiTaskWhereInput = {
      scope: { is: initial.access.scope }, scopeKind: initial.access.scope.kind,
      audience: initial.access.audience, ownerKind: initial.access.actorKind, ownerId: initial.access.actorId, creationKey: input.creationKey
    };
    const verifyCurrent = async () => {
      const current = await this.grant(input.sceneCode, input.inputRef, candidateId);
      if (current.access.bindingKey !== initial.access.bindingKey) throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
      if (current.fingerprint !== initial.fingerprint) throw new AiTaskRepositoryError("AI_REVISION_CONFLICT");
    };
    try {
      return await this.db.$transaction(async tx => {
        const scope = await tx.aiScope.upsert({
          where: { scopeKey: initial.access.scope.scopeKey }, create: initial.access.scope, update: {},
          select: { id: true, kind: true, scopeKey: true, tenantId: true, workspaceId: true }
        });
        // MySQL text collation must not turn a differently-cased scope key into authority.
        const exact = initial.access.scope;
        if (scope.kind !== exact.kind || scope.scopeKey !== exact.scopeKey || scope.tenantId !== exact.tenantId || scope.workspaceId !== exact.workspaceId) throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
        const existing = await tx.aiTask.findFirst({ where: { ...where, scopeId: scope.id }, select: selectedTask });
        if (existing) {
          const result = this.result(existing, input.creationKey, initial.fingerprint, true);
          await verifyCurrent();
          return result;
        }
        const actor = initial.access.actor;
        const policy = actor.kind === "automation" ? {
          policyId: actor.policyId, policyRevision: actor.policyRevision, policyExpiresAt: new Date(actor.expiresAt)
        } : { policyId: null, policyRevision: null, policyExpiresAt: null };
        await tx.aiTask.create({ data: {
          id: candidateId, scopeId: scope.id, scopeKind: scope.kind, audience: initial.access.audience,
          ownerKind: initial.access.actorKind, ownerId: initial.access.actorId, ...policy,
          contractVersion: AI_TASK_DRAFT_VERSION, sceneCode: initial.grant.sceneCode, sceneVersion: initial.grant.sceneVersion,
          traceId: initial.access.requestId, inputRef: initial.grant.inputRef, inputRevision: initial.grant.inputRevision, inputHash: initial.grant.inputHash,
          creationKey: input.creationKey, creationFingerprint: initial.fingerprint, status: "QUEUED", revision: 1, eventCursor: 0n
        }, select: { id: true } });
        const runId = this.newId();
        if (!z.string().uuid().safeParse(runId).success) throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
        await tx.aiRun.create({ data: {
          id: runId, scopeId: scope.id, taskId: candidateId, actorKind: initial.access.actorKind, actorId: initial.access.actorId,
          authorizedAt: initial.access.authorizedAt, sequence: 1, revision: 1, status: "QUEUED", fencingToken: new Prisma.Decimal(0),
          leaseOwnerId: null, leaseExpiresAt: null
        }, select: { id: true } });
        await verifyCurrent();
        return { taskId: candidateId, runId, status: "queued", revision: 1, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // A concurrent winner may have committed. Reauthorize and only read it; never retry a write.
        await verifyCurrent();
        let winner: TaskRow | null;
        try { winner = await this.db.aiTask.findFirst({ where, select: selectedTask }); }
        catch { throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE"); }
        if (!winner) throw new AiTaskRepositoryError("AI_REVISION_CONFLICT");
        const result = this.result(winner, input.creationKey, initial.fingerprint, true);
        await verifyCurrent();
        return result;
      }
      // Commit uncertainty is not permission to create another task under a new key.
      throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
    }
  }
}
