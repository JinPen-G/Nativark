import { Prisma, type PrismaClient, type AiActorKind, type AiAudience } from "@prisma/client";
import { z } from "zod";
import { AI_CONTRACT_DRAFT_VERSION, AI_TASK_DRAFT_VERSION, type AiExecutionContext } from "@rental-os/shared";
import { aiPersistenceScopeColumns } from "./persistence-scope";
import { requestFingerprint } from "../rental-core/rental-idempotency.repository";

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().min(1).max(4294967294);
const token = z.string().regex(/^(0|[1-9][0-9]{0,19})$/u);
const leaseInput = z.object({
  taskId: id, runId: id, holderId: id, expectedTaskRevision: revision,
  expectedRunRevision: revision, expectedFencingToken: token, leaseMs: z.number().int().min(1).max(120000)
}).strict();
const releaseInput = leaseInput.omit({ leaseMs: true }).extend({ expectedFencingToken: token.refine(value => value !== "0") }).strict();
const recoveryLeaseInput = z.object({ taskId: id, runId: id, holderId: id, revision,
  fencingToken: token.refine(value => value !== '0'), expiresAt: z.string().datetime({ offset: true }), purpose: z.literal('recovery_only') }).strict();
const actorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: id }).strict(),
  z.object({ kind: z.literal("saas_admin"), userId: id }).strict(),
  z.object({ kind: z.literal("customer"), customerId: id }).strict(),
  z.object({ kind: z.literal("automation"), subjectId: id, policyId: id, policyRevision: revision, expiresAt: z.string().datetime({ offset: true }) }).strict()
]);
const identitySchema = z.object({
  contractVersion: z.literal(AI_CONTRACT_DRAFT_VERSION), requestId: id,
  authorizedAt: z.string().datetime({ offset: true }),
  audience: z.enum(["operator", "staff", "client", "automation"]), actor: actorSchema
});
const taskSelect = {
  id: true, status: true, revision: true, sceneCode: true, sceneVersion: true,
  createdAt: true, updatedAt: true, cancelRequestedAt: true
} satisfies Prisma.AiTaskSelect;
const runnable = ["QUEUED", "RUNNING"] as const;
const maxFence = 99999999999999999999n;

export class AiTaskRepositoryError extends Error {
  constructor(readonly code: "AI_INVALID_INPUT" | "AI_ACCESS_DENIED" | "AI_RESOURCE_UNAVAILABLE" | "AI_REVISION_CONFLICT" | "AI_STORAGE_UNAVAILABLE") {
    super(code);
    this.name = "AiTaskRepositoryError";
  }
}

/** Bound by the application to the real request/job credential, never supplied by a model. */
export type AiTaskRepositoryOperation = "read_metadata" | "read_events" | "claim_run" | "claim_recovery_run" | "release_run" | "transition_task" | "read_step_terminal" | "takeover_run" | "request_input" | "submit_input" | "resume_input";
export interface AiTaskRepositoryAuthority {
  resolve(taskId: string, operation: AiTaskRepositoryOperation): Promise<AiExecutionContext>;
}

/** Validate a context already resolved by a required authority; this helper grants no permission. */
export function aiTaskAccessFromContext(context: AiExecutionContext, taskId: string, now: Date) {
  if (!id.safeParse(taskId).success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
  const parsed = identitySchema.safeParse(context);
  if (!parsed.success) throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
  let scope;
  try { scope = aiPersistenceScopeColumns(context.scope); }
  catch { throw new AiTaskRepositoryError("AI_ACCESS_DENIED"); }
  const actor = parsed.data.actor, audience = parsed.data.audience;
  const allowedShape = actor.kind === "saas_admin" ? audience === "operator" && scope.kind === "PLATFORM"
    : scope.kind !== "PLATFORM" && (actor.kind === "user" ? audience === "operator" || audience === "staff"
      : actor.kind === "customer" ? audience === "client" : audience === "automation");
  if (!allowedShape || !(now instanceof Date) || !Number.isFinite(now.getTime()) || Date.parse(parsed.data.authorizedAt) > now.getTime()
    || (actor.kind === "automation" && Date.parse(actor.expiresAt) <= now.getTime())) throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
  const ownerKind = actor.kind.toUpperCase() as AiActorKind;
  const ownerId = actor.kind === "customer" ? actor.customerId : actor.kind === "automation" ? actor.subjectId : actor.userId;
  const where: Prisma.AiTaskWhereInput = {
    id: taskId, archivedAt: null, scopeKind: scope.kind, scope: { is: scope },
    audience: audience.toUpperCase() as AiAudience, ownerKind, ownerId,
    ...(actor.kind === "automation" ? { policyId: actor.policyId, policyRevision: actor.policyRevision, policyExpiresAt: { gt: now } } : {})
  };
  // The original tuple is persisted in creation fingerprints; changing it would
  // orphan valid old receipts. It is NOT a current authorization revision.
  const ownershipBindingKey = JSON.stringify([scope, audience, ownerKind, ownerId,
    actor.kind === "automation" ? [actor.policyId, actor.policyRevision, actor.expiresAt] : null]);
  // All existing before/after delivery and recovery checks also bind the current
  // permission/data/location/organization projection. Correlation time is not
  // authority, and this hash never grants access or replaces the required source.
  const bindingKey = requestFingerprint({ ownershipBindingKey,
    ...("access" in context ? { access: context.access }
      : "permissions" in context ? { permissions: context.permissions } : {}) });
  return { where, now, actorKind: ownerKind, actorId: ownerId, authorizedAt: new Date(parsed.data.authorizedAt),
    bindingKey, ownershipBindingKey, scope, audience: audience.toUpperCase() as AiAudience, actor, requestId: parsed.data.requestId };
}

/**
 * Not registered in Nest or a worker. The required authority re-resolves each call;
 * owner-only access is deliberate until a separately authorized task-sharing path exists.
 * Lease CAS is not permission to dispatch: AIN-04/06 still reauthorize each business step.
 */
export class AiTaskRepository {
  constructor(
    private readonly db: Pick<PrismaClient, "aiTask" | "aiRun">,
    private readonly authority: AiTaskRepositoryAuthority,
    private readonly clock: () => Date = () => new Date()
  ) {
    if (!authority || typeof authority.resolve !== "function") throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
  }

  /** Internal shared access resolver for metadata and transactional repositories; never expose over HTTP. */
  async resolveAccess(taskId: string, operation: AiTaskRepositoryOperation) {
    if (!id.safeParse(taskId).success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    let context: AiExecutionContext;
    try { context = await this.authority.resolve(taskId, operation); }
    catch { throw new AiTaskRepositoryError("AI_ACCESS_DENIED"); }
    return aiTaskAccessFromContext(context, taskId, this.clock());
  }

  private async stored<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch { throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE"); }
  }

  async readMetadata(taskId: string) {
    const initial = await this.resolveAccess(taskId, "read_metadata");
    const read = await this.stored(() => this.db.aiTask.findFirst({ where: initial.where, select: taskSelect }))
      .then(row => ({ row }), failure => ({ failure }));
    // Even an empty or failed query must not hide revocation during its await.
    // Metadata cannot establish permission for the next event/result/effect.
    const current = await this.resolveAccess(taskId, "read_metadata");
    if (current.bindingKey !== initial.bindingKey) throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
    if ("failure" in read) throw read.failure;
    const row = read.row;
    // Missing and invisible are indistinguishable. No input/result reference or stored identity is returned.
    if (!row) throw new AiTaskRepositoryError("AI_RESOURCE_UNAVAILABLE");
    return {
      taskId: row.id, status: row.status.toLowerCase(), revision: row.revision,
      sceneCode: row.sceneCode, sceneVersion: row.sceneVersion,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null
    };
  }

  async claimRun(value: unknown) {
    return this.claimLease(value, "claim_run");
  }

  /** Reacquire the original run to reload/reconcile waiting or cancelling work.
   * Never resumes the task, clears cancellation, creates an action or dispatches a tool.
   * The returned purpose is a routing hint, not permission; every next mutation reauthorizes.
   */
  async claimRecoveryRun(value: unknown) {
    const lease = await this.claimLease(value, "claim_recovery_run");
    return { ...lease, purpose: "recovery_only" as const };
  }

  private recoveryTrace(taskId: string, runId: string): Prisma.AiRunWhereInput {
    return { id: runId, executionPlan: { is: { taskId, runId } }, OR: [
      { steps: { some: { status: { in: ['RUNNING', 'UNKNOWN', 'SUCCEEDED', 'FAILED'] } } } },
      // A base-admission COMMIT can outlive its reply while the original Step
      // stays PENDING. Admit only observation of this occupied planned Run;
      // neither a partial group nor an existing charge grants start/cleanup.
      { steps: { some: { status: 'PENDING', effect: 'NONE' } },
        executionCharges: { some: { taskId, runId, stepId: { not: null }, resource: 'STEPS', amount: 1n,
          status: { in: ['RESERVED', 'UNKNOWN'] } } } },
      // A lost pre-step acknowledgement may leave only original Run time debt.
      // Its pure ACTIVE_MS occupancy admits observation of that same planned
      // Run, not a Step start, a synthesized result, a refund or a new action.
      { executionCharges: { some: { resource: 'ACTIVE_MS', stepId: null, actionId: null,
        stepFingerprint: null, gatewayInvocationId: null, amount: { gt: 0n },
        status: { in: ['RESERVED', 'UNKNOWN'] } } } }
    ] };
  }

  async assertRecoveryRun(value: unknown) {
    const parsed = recoveryLeaseInput.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const lease = parsed.data, access = await this.resolveAccess(lease.taskId, 'claim_recovery_run');
    const row = await this.stored(() => this.db.aiRun.findFirst({ where: {
      id: lease.runId, taskId: lease.taskId, revision: lease.revision, fencingToken: new Prisma.Decimal(lease.fencingToken),
      leaseOwnerId: lease.holderId, leaseExpiresAt: { gt: access.now }, actorKind: access.actorKind, actorId: access.actorId,
      status: { in: [...runnable] }, task: { is: { ...access.where, contractVersion: AI_TASK_DRAFT_VERSION,
        runs: { some: this.recoveryTrace(lease.taskId, lease.runId) },
        OR: [{ status: { in: ['RUNNING', 'WAITING_INPUT', 'WAITING_CONFIRMATION', 'WAITING_EXTERNAL'] }, cancelRequestedAt: null },
          { status: 'CANCEL_REQUESTED', cancelRequestedAt: { not: null } }] } }
    }, select: { id: true, taskId: true, revision: true, fencingToken: true, leaseOwnerId: true, leaseExpiresAt: true, actorId: true } }));
    if (!row || row.id !== lease.runId || row.taskId !== lease.taskId || row.revision !== lease.revision
      || row.fencingToken.toFixed(0) !== lease.fencingToken || row.leaseOwnerId !== lease.holderId || row.actorId !== access.actorId
      || !row.leaseExpiresAt || row.leaseExpiresAt.getTime() !== Date.parse(lease.expiresAt)) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    const current = await this.resolveAccess(lease.taskId, 'claim_recovery_run');
    if (current.bindingKey !== access.bindingKey || row.leaseExpiresAt <= current.now) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  }

  private async claimLease(value: unknown, operation: "claim_run" | "claim_recovery_run") {
    const parsed = leaseInput.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    const input = parsed.data, fence = BigInt(input.expectedFencingToken);
    if (fence >= maxFence || (operation === "claim_recovery_run" && fence === 0n)) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    const access = await this.resolveAccess(input.taskId, operation);
    const expiresAt = new Date(access.now.getTime() + input.leaseMs);
    const taskState: Prisma.AiTaskWhereInput = operation === "claim_run"
      ? { status: { in: [...runnable] }, cancelRequestedAt: null }
      : { OR: [
        // Crash before aggregate publication may leave started work or only
        // original pure Run time occupancy. Fence that original planned Run
        // for current observation; do not resume/mutate the task or dispatch.
        { status: 'RUNNING', cancelRequestedAt: null,
          runs: { some: this.recoveryTrace(input.taskId, input.runId) } },
        { status: { in: ["WAITING_INPUT", "WAITING_CONFIRMATION", "WAITING_EXTERNAL"] }, cancelRequestedAt: null },
        { status: "CANCEL_REQUESTED", cancelRequestedAt: { not: null } }
      ] };
    const result = await this.stored(() => this.db.aiRun.updateMany({
      where: {
        id: input.runId, taskId: input.taskId, revision: input.expectedRunRevision,
        fencingToken: new Prisma.Decimal(input.expectedFencingToken), status: { in: [...runnable] },
        task: { is: { ...access.where, revision: input.expectedTaskRevision, contractVersion: AI_TASK_DRAFT_VERSION, ...taskState } },
        OR: [
          { leaseOwnerId: null, leaseExpiresAt: null },
          { leaseOwnerId: { not: null }, leaseExpiresAt: { lte: access.now } }
        ]
      },
      data: {
        revision: { increment: 1 }, fencingToken: { increment: new Prisma.Decimal(1) },
        leaseOwnerId: input.holderId, leaseExpiresAt: expiresAt,
        actorKind: access.actorKind, actorId: access.actorId, authorizedAt: access.authorizedAt
      }
    }));
    if (result.count !== 1) throw new AiTaskRepositoryError("AI_REVISION_CONFLICT");
    // Derived only from matched CAS values: no second read can accidentally return another holder's lease.
    return { taskId: input.taskId, runId: input.runId, holderId: input.holderId, revision: input.expectedRunRevision + 1, fencingToken: (fence + 1n).toString(), expiresAt: expiresAt.toISOString() };
  }

  async releaseRun(value: unknown) {
    const parsed = releaseInput.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    const input = parsed.data;
    const access = await this.resolveAccess(input.taskId, "release_run");
    const result = await this.stored(() => this.db.aiRun.updateMany({
      where: {
        id: input.runId, taskId: input.taskId, revision: input.expectedRunRevision,
        fencingToken: new Prisma.Decimal(input.expectedFencingToken), leaseOwnerId: input.holderId,
        leaseExpiresAt: { gt: access.now },
        task: { is: { ...access.where, revision: input.expectedTaskRevision } }
      },
      data: { revision: { increment: 1 }, leaseOwnerId: null, leaseExpiresAt: null }
    }));
    if (result.count !== 1) throw new AiTaskRepositoryError("AI_REVISION_CONFLICT");
    return { released: true as const, revision: input.expectedRunRevision + 1 };
  }
}
