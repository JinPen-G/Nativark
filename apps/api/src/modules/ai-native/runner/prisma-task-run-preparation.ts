/** Original Run preparation evidence and quota admission.
 * No executable plan is synthesized: input/plan publication remains with the
 * registered host. This store has no counters or monetary ledger. An incomplete
 * start never authorizes re-preparation, even after expiry or a new holder.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskExecutionBudgetError, type AiTaskExecutionBudgetPort, type AiTaskExecutionLease,
  type AiTaskExecutionPolicy, type AiTaskExecutionSettlementRequest } from '../task-execution-budget.ports';
import { aiTaskRunPlanSchema, type AiTaskPlanEvidenceAuthority, type PrismaTaskRunEvidenceRepository } from './prisma-task-run-evidence.repository';
import { taskPreparationDefinitionSchema, type AiTaskPreparationDefinition, type AiTaskPreparationTicket,
  type AiTaskControlResourceOrigin } from './task-run-preparation.ports';
import type { AiTaskRunnerLease } from './ai-task-runner.ports';
import { readOriginalRunTimeCharges, taskOverheadNonEffectChargeIds } from './prisma-task-run-overhead';

type Db = Pick<PrismaClient, 'aiTask' | 'aiRun' | 'aiStep' | 'aiTaskRunPlan' | 'aiTaskExecutionCharge' | 'aiTaskInputReceipt' | 'aiTaskInputRequest'>
  & Partial<Pick<PrismaClient, 'aiTaskRunPreparation'>>;
type Row = Prisma.AiTaskRunPreparationGetPayload<{}>;
const fail = () => new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
const unknown = () => new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
const conflict = () => new AiTaskExecutionBudgetError('AI_REVISION_CONFLICT');
const uuid = (hash: string) => `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
const proofSchema = z.object({ authorityHash: z.string().regex(/^[a-f0-9]{64}$/u), policyVersion: z.string().min(1).max(64),
  expiresAt: z.string().datetime({ offset: true }) }).strict();

function preparationMeasurement(row: Row) {
  return requestFingerprint({ version: 'run-preparation-measurement-1', scopeId: row.scopeId, taskId: row.taskId, runId: row.runId,
    definitionHash: row.definitionHash, authorityHash: row.authorityHash, policyVersion: row.policyVersion,
    leaseOwnerId: row.leaseOwnerId, fencingToken: row.fencingToken.toFixed(0), runRevision: row.runRevision,
    chargeId: row.chargeId, requestFingerprint: row.requestFingerprint, prepared: row.prepared, planHash: row.planHash, activeMs: row.activeMs?.toString() });
}

/** Only verified original preparation charges are non-dispatch traces. Never
 * ignore arbitrary run/null-step charges, or incomplete previous generations. */
export async function taskPreparationNonEffectChargeIds(db: Partial<Pick<PrismaClient, 'aiTaskRunPreparation'>> & Pick<PrismaClient, 'aiTaskExecutionCharge'>,
  key: { scopeId: string; taskId: string; runId: string }, lease: AiTaskRunnerLease): Promise<string[]> {
  const ids = await taskOverheadNonEffectChargeIds(db, key, lease);
  if (!db.aiTaskRunPreparation) return ids;
  const rows = await db.aiTaskRunPreparation.findMany({ where: { scopeId: key.scopeId, taskId: key.taskId, runId: key.runId }, take: 1001 });
  if (rows.length > 1000) throw fail();
  const charges = await readOriginalRunTimeCharges(db, key, rows.flatMap(row => row.chargeId ? [row.chargeId] : []));
  for (const row of rows) {
    if (!row.chargeId) continue;
    const definition = taskPreparationDefinitionSchema.parse(row.definition);
    const charge = charges.get(row.chargeId);
    if (row.scopeId !== key.scopeId || row.taskId !== key.taskId || row.runId !== key.runId || row.id !== row.chargeId
      || definition.taskId !== key.taskId || requestFingerprint(definition) !== row.definitionHash
      || !charge || charge.scopeId !== key.scopeId || charge.taskId !== key.taskId || charge.runId !== key.runId
      || charge.resource !== 'ACTIVE_MS' || charge.stepId !== null || charge.actionId !== null
      || charge.stepFingerprint !== null || charge.gatewayInvocationId !== null || charge.requestFingerprint !== row.requestFingerprint
      || charge.leaseOwnerId !== row.leaseOwnerId || charge.fencingToken.toFixed(0) !== row.fencingToken.toFixed(0)) throw denied();
    if (row.completedAt) {
      if (row.activeMs === null || row.measurementHash !== preparationMeasurement(row) || charge.status !== 'RECORDED'
        || charge.actualAmount !== row.activeMs || row.activeMs > charge.amount) throw unknown();
    } else if (row.leaseOwnerId !== lease.holderId || row.fencingToken.toFixed(0) !== lease.fencingToken
      || row.runRevision !== lease.revision || charge.status !== 'RESERVED') throw unknown();
    ids.push(row.chargeId);
  }
  return ids;
}

export class PrismaTaskRunPreparation {
  private readonly starts = new Map<string, { at: number; lease: string }>();
  constructor(private readonly db: Db,
    private readonly evidence: Pick<PrismaTaskRunEvidenceRepository, 'assertHeldRun' | 'assertExecutable' | 'withHeldRun' | 'resolve' | 'resourceOrigin'>
      & Partial<Pick<PrismaTaskRunEvidenceRepository, 'assertAccountingRun'>>,
    private readonly authority: AiTaskPlanEvidenceAuthority, private readonly wall: () => Date = () => new Date(),
    private readonly monotonic: () => number = () => performance.now(),
    private readonly controlResourceOrigin?: AiTaskControlResourceOrigin) {}

  private store(db: Partial<Pick<PrismaClient, 'aiTaskRunPreparation'>> = this.db) {
    const value = db.aiTaskRunPreparation;
    if (!value || typeof value.findUnique !== 'function' || typeof value.findFirst !== 'function' || typeof value.findMany !== 'function' || typeof value.create !== 'function' || typeof value.updateMany !== 'function') throw fail();
    return value;
  }
  private async scope(lease: AiTaskExecutionLease, accountingOnly = false) {
    const current = { ...structuredClone(lease), expiresAt: '' };
    return accountingOnly && this.evidence.assertAccountingRun
      ? this.evidence.assertAccountingRun(current) : this.evidence.assertHeldRun(current);
  }
  private definition(row: Row, key: { scopeId: string; taskId: string; runId: string }) {
    const definition = taskPreparationDefinitionSchema.parse(structuredClone(row.definition));
    if (Object.entries(key).some(([name, value]) => row[name as keyof Row] !== value)
      || definition.taskId !== key.taskId || requestFingerprint(definition) !== row.definitionHash
      || !/^[a-f0-9]{64}$/u.test(row.authorityHash) || !row.policyVersion
      || !(row.startedAt instanceof Date) || !(row.expiresAt instanceof Date)
      || !Number.isSafeInteger(row.runRevision) || row.runRevision < 1) throw denied();
    return definition;
  }
  private async origin(definition: AiTaskPreparationDefinition, lease: AiTaskRunnerLease, scopeId: string) {
    const key = { scopeId, taskId: lease.taskId };
    const run = await this.db.aiRun.findFirst({ where: { ...key, id: lease.runId } });
    if (!run || run.id !== lease.runId || run.scopeId !== scopeId || run.taskId !== lease.taskId) throw denied();
    const currentDefinition = run.id === definition.runId;
    if (currentDefinition && run.inputReceiptId == null && run.resourceOriginRunId == null) {
      if (run.sequence !== 1) throw denied();
      return definition;
    }
    // A registered successor host may prepare a different formal action after
    // clarification. Its current plan is not a new cumulative resource origin.
    // Preserve the exact original answer/parent chain before accepting either.
    const originId = run.resourceOriginRunId;
    if (run.inputReceiptId == null && originId && run.sequence > 1 && this.controlResourceOrigin) {
      if (run.actorKind !== 'USER' || (!currentDefinition && originId !== definition.runId)) throw denied();
      const original = aiTaskRunPlanSchema.parse(await this.controlResourceOrigin({ ...key, runId: run.id,
        resourceOriginRunId: originId }));
      const saved = await this.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { ...key, runId: originId } } });
      if (!saved || saved.scopeId !== scopeId || saved.taskId !== lease.taskId || saved.runId !== originId
        || original.taskId !== lease.taskId || original.runId !== originId
        || saved.planHash !== requestFingerprint(saved.payload) || saved.planHash !== requestFingerprint(original)
        || (currentDefinition ? typeof this.authority.authorizePreparation !== 'function'
          || Object.entries(original.limits).some(([name, ceiling]) => definition.limits[name as keyof typeof definition.limits] > ceiling)
          : requestFingerprint(original.steps) !== requestFingerprint(definition.steps)
            || requestFingerprint(original.limits) !== requestFingerprint(definition.limits))) throw denied();
      return original;
    }
    if (!run.inputReceiptId || !originId || run.sequence < 2
      || (!currentDefinition && originId !== definition.runId)) throw denied();
    const receipt = await this.db.aiTaskInputReceipt.findUnique({ where: { scopeId_taskId_id: { ...key, id: run.inputReceiptId } } });
    const request = receipt && await this.db.aiTaskInputRequest.findUnique({ where: { scopeId_taskId_id: { ...key, id: receipt.requestId } } });
    if (!receipt || receipt.id !== run.inputReceiptId || receipt.scopeId !== scopeId || receipt.taskId !== lease.taskId
      || receipt.actorKind !== run.actorKind || receipt.actorId !== run.actorId || !receipt.consumedAt || !receipt.consumedTaskRevision
      || !request || request.id !== receipt.requestId || request.scopeId !== scopeId || request.taskId !== lease.taskId
      || request.status !== 'CONSUMED' || request.planHash !== receipt.planHash
      || request.waitingTaskRevision + 1 !== receipt.consumedTaskRevision) throw denied();
    const parent = await this.db.aiRun.findFirst({ where: { ...key, id: request.runId } });
    const origin = await this.db.aiRun.findFirst({ where: { ...key, id: originId } });
    if (!parent || parent.scopeId !== scopeId || parent.taskId !== lease.taskId || parent.id !== request.runId
      || parent.sequence + 1 !== run.sequence || parent.status !== 'SUCCEEDED'
      || (parent.resourceOriginRunId ?? parent.id) !== originId
      || !origin || origin.id !== originId || origin.scopeId !== scopeId || origin.taskId !== lease.taskId
      || origin.sequence !== 1 || origin.status !== 'SUCCEEDED' || origin.inputReceiptId != null || origin.resourceOriginRunId != null) throw denied();
    const saved = await this.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: { ...key, runId: origin.id } } });
    if (!saved || saved.scopeId !== scopeId || saved.taskId !== lease.taskId || saved.runId !== origin.id
      || requestFingerprint(saved.payload) !== saved.planHash) throw denied();
    const original = aiTaskRunPlanSchema.parse(saved.payload);
    if (original.taskId !== definition.taskId || original.runId !== originId) throw denied();
    if (currentDefinition) {
      // Only a real preparation authorizer can admit an unpublished successor
      // action. Its limits cannot exceed the original frozen plan; accounting
      // below still uses that original plan's fingerprint and ceilings.
      if (typeof this.authority.authorizePreparation !== 'function'
        || Object.entries(original.limits).some(([name, ceiling]) => definition.limits[name as keyof typeof definition.limits] > ceiling)) throw denied();
    } else if (requestFingerprint(original.steps) !== requestFingerprint(definition.steps)
      || requestFingerprint(original.limits) !== requestFingerprint(definition.limits)) throw denied();
    return original;
  }
  private async validatePredecessor(previous: Row, key: { scopeId: string; taskId: string; runId: string },
    definition: AiTaskPreparationDefinition, lease: AiTaskRunnerLease, origin: Awaited<ReturnType<PrismaTaskRunPreparation['origin']>>,
    db: Pick<Db, 'aiTaskRunPlan'> = this.db) {
    const prior = this.definition(previous, key);
    if (!previous.completedAt || previous.activeMs === null || previous.chargeId !== previous.id) throw unknown();
    if (previous.definitionHash === requestFingerprint(definition)) return;
    // A rejected model continuation can leave a measured, unpublished phase on
    // the answer Run. Only a newly authorized, different formal action may follow
    // it under a later held generation; it cannot replay the old callback or debt.
    if (definition.runId !== lease.runId || origin.runId === lease.runId
      || prior.runId !== origin.runId || previous.prepared || previous.planHash !== null
      || previous.measurementHash !== this.measurement(previous)
      || BigInt(previous.fencingToken.toFixed(0)) >= BigInt(lease.fencingToken)
      || previous.runRevision >= lease.revision
      || requestFingerprint(prior.steps) !== requestFingerprint(origin.steps)
      || requestFingerprint(prior.limits) !== requestFingerprint(origin.limits)
      || requestFingerprint(prior.steps) === requestFingerprint(definition.steps)
      || await db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } })) throw conflict();
  }
  private async admission(definition: AiTaskPreparationDefinition, lease: AiTaskRunnerLease, tx?: Prisma.TransactionClient) {
    if (this.authority.authorizePreparation) return proofSchema.parse(await this.authority.authorizePreparation(structuredClone(definition), structuredClone(lease), tx));
    // Legacy suppliers can only meter an already real, authorized saved plan.
    // Absence never manufactures inputs or a plan to initialize its budget.
    const scopeId = await this.scope(lease);
    const task = await this.db.aiTask.findFirst({ where: { scopeId, id: lease.taskId } });
    if (!task) throw denied();
    const plan = await this.evidence.resolve({ taskId: task.id, revision: task.revision,
      status: task.status.toLowerCase() as import('@rental-os/shared').AiTaskStatusDraft,
      cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null }, lease, false);
    const origin = await this.evidence.resourceOrigin(plan, lease);
    if (origin.runId !== definition.runId || requestFingerprint(origin.steps) !== requestFingerprint(definition.steps)
      || requestFingerprint(origin.limits) !== requestFingerprint(definition.limits)) throw denied();
    return proofSchema.parse(await this.authority.authorize(plan, lease));
  }
  async resourcePolicy(taskId: string, value: AiTaskExecutionLease, originalOnly: boolean): Promise<AiTaskExecutionPolicy | null> {
    const lease = { ...structuredClone(value), expiresAt: '' }, scopeId = await this.scope(lease, originalOnly);
    const key = { scopeId, taskId, runId: lease.runId };
    // A real plan always owns the ordinary policy path; a corrupt one cannot
    // fall back to a more permissive preparation definition.
    if (await this.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } })) return null;
    const row = await this.store().findFirst({ where: key, orderBy: { fencingToken: 'desc' } });
    if (!row) return null;
    const definition = this.definition(row, key), resourceOrigin = await this.origin(definition, lease, scopeId);
    if (!originalOnly) {
      const proof = await this.admission(definition, lease);
      if (proof.authorityHash !== row.authorityHash || proof.policyVersion !== row.policyVersion
        || Date.parse(proof.expiresAt) <= this.wall().getTime()) throw denied();
    }
    const stable = { version: 'saved-plan-resource-1', taskId, runId: resourceOrigin.runId,
      steps: resourceOrigin.steps, limits: resourceOrigin.limits };
    await this.scope(lease);
    return { version: stable.version, fingerprint: requestFingerprint(stable), limits: {
      steps: BigInt(resourceOrigin.limits.maxSteps), calls: BigInt(resourceOrigin.limits.maxCalls),
      active_ms: BigInt(resourceOrigin.limits.maxTotalMs), output_bytes: BigInt(resourceOrigin.limits.maxOutputBytes) } };
  }
  async begin(leaseValue: AiTaskRunnerLease, provided: AiTaskPreparationDefinition | undefined, maximumMs: number,
    budget: AiTaskExecutionBudgetPort, signal?: AbortSignal): Promise<AiTaskPreparationTicket> {
    const started = this.monotonic(), lease = structuredClone(leaseValue);
    if (!Number.isFinite(started) || signal?.aborted || !Number.isSafeInteger(maximumMs) || maximumMs < 1) throw fail();
    await this.evidence.assertExecutable(lease);
    const scopeId = await this.scope(lease), key = { scopeId, taskId: lease.taskId, runId: lease.runId };
    let definition: AiTaskPreparationDefinition;
    if (provided) definition = taskPreparationDefinitionSchema.parse(structuredClone(provided));
    else {
      const task = await this.db.aiTask.findFirst({ where: { scopeId, id: lease.taskId } });
      if (!task) throw denied();
      const current = await this.evidence.resolve({ taskId: task.id, revision: task.revision,
        status: task.status.toLowerCase() as import('@rental-os/shared').AiTaskStatusDraft,
        cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null }, lease, false);
      const origin = await this.evidence.resourceOrigin(current, lease);
      definition = { taskId: origin.taskId, runId: origin.runId, steps: structuredClone(origin.steps), limits: structuredClone(origin.limits),
        bindingHash: requestFingerprint({ version: 'existing-plan-preparation-1', plan: requestFingerprint(origin) }) };
    }
    if (definition.taskId !== lease.taskId) throw denied();
    const origin = await this.origin(definition, lease, scopeId);
    const proof = await this.admission(definition, lease);
    if (Date.parse(proof.expiresAt) <= this.wall().getTime() || signal?.aborted) throw fail();
    if (await this.db.aiStep.findFirst({ where: { ...key, status: { in: ['RUNNING', 'UNKNOWN'] } } })) throw unknown();
    const originalCharges = await this.db.aiTaskExecutionCharge.findMany({ where: key, take: 5001 });
    if (originalCharges.length > 5000 || originalCharges.some(charge => charge.stepId !== null && ['RESERVED', 'UNKNOWN'].includes(charge.status))) throw unknown();
    const definitionHash = requestFingerprint(definition), chargeId = uuid(requestFingerprint({ version: 'task-preparation-charge-1', ...key,
      holderId: lease.holderId, fencingToken: lease.fencingToken, runRevision: lease.revision }));
    const completed = await this.store().findMany({ where: key, take: 1001 });
    if (completed.length > 1000) throw fail();
    for (const previous of completed) {
      await this.validatePredecessor(previous, key, definition, lease, origin);
      // Finish only the original local resource accounting from its existing
      // receipt. No preparation/effect is replayed to obtain that evidence.
      await budget.reconcile({ taskId: lease.taskId, lease, chargeId: previous.id, evidenceRef: `preparation:${previous.id}` });
    }
    let attempted = false;
    try {
      const row = await this.evidence.withHeldRun(lease, async (tx, actualScope) => {
        if (actualScope !== scopeId || signal?.aborted) throw denied();
        const current = await this.admission(definition, lease, tx);
        if (current.authorityHash !== proof.authorityHash || current.policyVersion !== proof.policyVersion
          || Date.parse(current.expiresAt) <= this.wall().getTime()) throw denied();
        const predecessors = await this.store(tx).findMany({ where: key, take: 1001 });
        if (predecessors.length > 1000) throw fail();
        for (const previous of predecessors) {
          await this.validatePredecessor(previous, key, definition, lease, origin, tx);
        }
        const prior = predecessors.find(previous => previous.id === chargeId);
        if (prior) return prior;
        attempted = true;
        return this.store(tx).create({ data: { ...key, id: chargeId, definition: definition as unknown as Prisma.InputJsonValue, definitionHash,
          authorityHash: proof.authorityHash, policyVersion: proof.policyVersion, expiresAt: new Date(proof.expiresAt),
          leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken), runRevision: lease.revision,
          startedAt: this.wall() } });
      });
      if (signal?.aborted) throw unknown();
      if (row.completedAt) {
        if (!row.prepared) throw unknown();
        return { key: chargeId, prepared: true };
      }
      const snapshot = await budget.initialize(lease.taskId, lease);
      const remaining = snapshot.policy.limits.active_ms - snapshot.consumed.active_ms - snapshot.reserved.active_ms;
      const allowance = Math.min(maximumMs, Number(remaining), Math.max(0, Date.parse(lease.expiresAt) - this.wall().getTime()));
      if (!Number.isSafeInteger(allowance) || allowance < 1) throw unknown();
      if (signal?.aborted) throw unknown();
      const reserved = await budget.reserve({ taskId: lease.taskId, lease, chargeId, resource: 'active_ms', amount: BigInt(allowance), target: { kind: 'run' } });
      if (reserved.replayed) throw unknown();
      await this.evidence.withHeldRun(lease, async (tx, actualScope) => {
        if (actualScope !== scopeId || signal?.aborted) throw unknown();
        const charge = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: lease.taskId, chargeId } } });
        if (!charge || charge.runId !== lease.runId || charge.stepId !== null || charge.resource !== 'ACTIVE_MS'
          || charge.leaseOwnerId !== lease.holderId || charge.fencingToken.toFixed(0) !== lease.fencingToken
          || charge.requestFingerprint !== reserved.charge.requestFingerprint || charge.status !== 'RESERVED') throw denied();
        if ((await this.store(tx).updateMany({ where: { ...key, id: chargeId, definitionHash, completedAt: null, chargeId: null,
          leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken), runRevision: lease.revision },
          data: { chargeId, requestFingerprint: charge.requestFingerprint } })).count !== 1) throw unknown();
      });
      if (signal?.aborted) throw unknown();
      const spent = this.monotonic() - started;
      const remainingMs = allowance - Math.ceil(spent);
      // Admission/marker/charge waits already belong to this original interval.
      // A small remaining budget cannot buy a fresh default host work window.
      if (!Number.isFinite(spent) || spent < 0 || !Number.isSafeInteger(remainingMs) || remainingMs < 1) throw unknown();
      this.starts.set(chargeId, { at: started, lease: requestFingerprint(lease) });
      return { key: chargeId, prepared: false, remainingMs };
    } catch (error) {
      this.starts.delete(chargeId);
      if (attempted) {
        await budget.markUnknown({ taskId: lease.taskId, lease, chargeId, reason: 'run_preparation_uncertain' }).catch(() => {});
        throw unknown();
      }
      throw error;
    }
  }
  private measurement(row: Row) { return preparationMeasurement(row); }

  private async measure(ticket: AiTaskPreparationTicket, lease: AiTaskRunnerLease, scopeId: string,
    tx: Prisma.TransactionClient, requirePrepared = false) {
    const started = this.starts.get(ticket.key), key = { scopeId, taskId: lease.taskId, runId: lease.runId };
    if (ticket.prepared || !started || started.lease !== requestFingerprint(lease)) throw unknown();
    const task = await tx.aiTask.findFirst({ where: { scopeId, id: lease.taskId } });
    if (!task) throw denied();
    const saved = await tx.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
    const published = saved ? aiTaskRunPlanSchema.parse(structuredClone(saved.payload)) : null;
    if (saved && (!published || saved.scopeId !== scopeId || saved.taskId !== lease.taskId || saved.runId !== lease.runId
      || published.taskId !== lease.taskId || published.runId !== lease.runId
      || requestFingerprint(published) !== saved.planHash)) throw denied();
    const plan = saved ? await this.evidence.resolve({ taskId: task.id, revision: task.revision,
      status: task.status.toLowerCase() as import('@rental-os/shared').AiTaskStatusDraft,
      cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null }, lease, true) : null;
    // resolve substitutes the current CAS revision for execution. The original
    // time receipt must bind the immutable published plan, not that projection.
    if (plan && saved && published && requestFingerprint({ ...plan, taskRevision: published.taskRevision }) !== saved.planHash) throw denied();
    const origin = plan ? await this.evidence.resourceOrigin(plan, lease) : null;
    if (requirePrepared && !plan) throw unknown();
    const row = await this.store(tx).findUnique({ where: { scopeId_taskId_id: { scopeId, taskId: lease.taskId, id: ticket.key } } });
    if (!row) throw unknown();
    const definition = this.definition(row, key), preparedBasis = plan?.runId === definition.runId ? plan : origin;
    if (requirePrepared) {
      const proof = await this.admission(definition, lease, tx);
      if (proof.authorityHash !== row.authorityHash || proof.policyVersion !== row.policyVersion
        || Date.parse(proof.expiresAt) <= this.wall().getTime()) throw denied();
    }
    const charge = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: lease.taskId, chargeId: ticket.key } } });
    const at = this.monotonic(), wall = this.wall(), elapsed = at - started.at;
    // Current published successor and cumulative origin remain distinct. A
    // successful preparation does not manufacture a plan or execution grant.
    if (!Number.isFinite(elapsed) || elapsed < 0 || !charge || elapsed > Number(charge.amount)
      || row.completedAt || row.chargeId !== ticket.key || row.leaseOwnerId !== lease.holderId
      || row.fencingToken.toFixed(0) !== lease.fencingToken || row.runRevision !== lease.revision
      || row.requestFingerprint !== charge.requestFingerprint || charge.resource !== 'ACTIVE_MS'
      || charge.runId !== lease.runId || charge.stepId !== null || charge.status !== 'RESERVED'
      || preparedBasis && (preparedBasis.runId !== definition.runId || requestFingerprint(preparedBasis.steps) !== requestFingerprint(definition.steps)
        || requestFingerprint(preparedBasis.limits) !== requestFingerprint(definition.limits))) throw unknown();
    const completed = { ...row, completedAt: wall, activeMs: BigInt(Math.ceil(elapsed)),
      prepared: plan !== null, planHash: saved?.planHash ?? null };
    const measurementHash = this.measurement(completed);
    if ((await this.store(tx).updateMany({ where: { ...key, id: ticket.key, chargeId: ticket.key, completedAt: null,
      definitionHash: row.definitionHash, requestFingerprint: charge.requestFingerprint,
      leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken), runRevision: lease.revision },
      data: { completedAt: wall, activeMs: completed.activeMs, prepared: completed.prepared,
        planHash: completed.planHash, measurementHash } })).count !== 1) throw unknown();
    return { at, wall, evidence: { scopeId, taskId: lease.taskId, runId: lease.runId, chargeId: ticket.key,
      requestFingerprint: charge.requestFingerprint, resource: 'active_ms' as const, actualAmount: completed.activeMs,
      evidenceHash: measurementHash, evidenceRef: `preparation:${ticket.key}`, dispatchToken: null, gatewayInvocationId: null } };
  }

  async handoff(ticket: AiTaskPreparationTicket, leaseValue: AiTaskRunnerLease,
    overhead: Pick<import('./prisma-task-run-overhead').PrismaTaskRunOverhead, 'beginFromPreparation'>,
    budget: AiTaskExecutionBudgetPort, recovery: boolean, retainStepAllowance: boolean) {
    const lease = structuredClone(leaseValue);
    if (ticket.prepared || this.starts.get(ticket.key)?.lease !== requestFingerprint(lease)) throw unknown();
    try {
      return await overhead.beginFromPreparation(lease, ticket.key, recovery, retainStepAllowance,
        (tx, scopeId) => this.measure(ticket, lease, scopeId, tx, true), budget);
    } finally { this.starts.delete(ticket.key); }
  }

  async complete(ticket: AiTaskPreparationTicket, leaseValue: AiTaskRunnerLease, budget: AiTaskExecutionBudgetPort) {
    const lease = structuredClone(leaseValue), scopeId = await this.scope(lease), key = { scopeId, taskId: lease.taskId, runId: lease.runId };
    try {
      if (!ticket.prepared) await this.evidence.withHeldRun(lease, async (tx, actualScope) => {
        if (actualScope !== scopeId) throw denied();
        await this.measure(ticket, lease, scopeId, tx);
      });
      const request = { taskId: lease.taskId, lease, chargeId: ticket.key, evidenceRef: `preparation:${ticket.key}` };
      await (ticket.prepared ? budget.reconcile(request) : budget.record(request));
      const receipt = await this.store().findUnique({ where: { scopeId_taskId_id: { scopeId, taskId: lease.taskId, id: ticket.key } } });
      if (!receipt?.prepared) throw unknown();
    } catch { throw unknown(); }
    finally { this.starts.delete(ticket.key); }
  }
  async abandon(ticket: AiTaskPreparationTicket, lease: AiTaskRunnerLease, budget: AiTaskExecutionBudgetPort) {
    this.starts.delete(ticket.key);
    await budget.markUnknown({ taskId: lease.taskId, lease, chargeId: ticket.key, reason: 'run_preparation_uncertain' });
  }
  async read(input: AiTaskExecutionSettlementRequest, _reconcile: boolean) {
    // Original measured time is an accounting receipt, not another held
    // preparation. A released Run still requires its current independent read
    // authority; initialization and new reservations retain the held path.
    const lease = { ...structuredClone(input.lease), expiresAt: '' }, scopeId = await this.scope(lease, true);
    if (input.taskId !== lease.taskId || input.evidenceRef !== `preparation:${input.chargeId}`) throw denied();
    const key = { scopeId, taskId: lease.taskId, runId: lease.runId };
    const row = await this.store().findUnique({ where: { scopeId_taskId_id: { scopeId, taskId: lease.taskId, id: input.chargeId } } });
    if (!row) throw unknown();
    this.definition(row, key);
    const charge = await this.db.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: lease.taskId, chargeId: input.chargeId } } });
    const saved = await this.db.aiTaskRunPlan.findUnique({ where: { scopeId_taskId_runId: key } });
    if (!row.completedAt || row.activeMs === null || row.chargeId !== input.chargeId || row.measurementHash !== this.measurement(row)
      || !charge || charge.scopeId !== scopeId || charge.taskId !== lease.taskId || charge.runId !== lease.runId
      || charge.stepId !== null || charge.actionId !== null || charge.stepFingerprint !== null || charge.gatewayInvocationId !== null
      || charge.resource !== 'ACTIVE_MS' || charge.leaseOwnerId !== row.leaseOwnerId
      || charge.fencingToken.toFixed(0) !== row.fencingToken.toFixed(0) || charge.requestFingerprint !== row.requestFingerprint
      || row.activeMs < 0n || row.activeMs > charge.amount
      || (row.prepared ? !saved || saved.planHash !== row.planHash || requestFingerprint(saved.payload) !== row.planHash : row.planHash !== null)) throw denied();
    await this.scope(lease, true);
    return { scopeId, taskId: lease.taskId, runId: lease.runId, chargeId: input.chargeId, requestFingerprint: charge.requestFingerprint,
      resource: 'active_ms' as const, actualAmount: row.activeMs, evidenceHash: row.measurementHash!, evidenceRef: input.evidenceRef,
      dispatchToken: null, gatewayInvocationId: null };
  }
}
