/** Server orchestration measurements, not business results or a second ledger.
 * Every interval reserves original ACTIVE_MS before work. Lost timing/commit
 * evidence retains occupancy; another holder never repeats that interval.
 */
import { Prisma, type PrismaClient, type AiTaskRunOverhead, type AiTaskExecutionCharge } from '@prisma/client';
import { performance } from 'node:perf_hooks';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiTaskExecutionBudgetError, type AiTaskExecutionBudgetPort, type AiTaskExecutionSettlementRequest } from '../task-execution-budget.ports';
import type { AiTaskRunnerLease, AiTaskRunnerOverheadTicket } from './ai-task-runner.ports';
import type { PrismaTaskRunEvidenceRepository } from './prisma-task-run-evidence.repository';

type Row = AiTaskRunOverhead;
type Store = {
  findUnique(input: { where: object }): Promise<Row | null>;
  findMany(input: { where: object; take: number }): Promise<Row[]>;
  create(input: { data: object }): Promise<Row>;
  updateMany(input: { where: object; data: object }): Promise<{ count: number }>;
};
type Db = Pick<PrismaClient, 'aiTask' | 'aiTaskExecutionCharge' | 'aiTaskExecutionBudget'>;
type Evidence = Pick<PrismaTaskRunEvidenceRepository, 'assertHeldRun' | 'withHeldRun' | 'assertAccountingRun' | 'withAccountingRun' | 'withReleasedAccountingRun' | 'resolve' | 'resourceOrigin'>;
const unavailable = () => new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
const unknown = () => new AiTaskExecutionBudgetError('AI_RESULT_UNKNOWN');
const denied = () => new AiTaskExecutionBudgetError('AI_ACCESS_DENIED');
const uuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
function store(db: unknown): Store {
  const value = (db as { aiTaskRunOverhead?: Store }).aiTaskRunOverhead;
  if (!value || ['findUnique', 'findMany', 'create', 'updateMany'].some(name => typeof value[name as keyof Store] !== 'function')) throw unavailable();
  return value;
}
function measurement(row: Row) {
  return requestFingerprint({ version: 'run-overhead-measurement-1', scopeId: row.scopeId, taskId: row.taskId,
    runId: row.runId, id: row.id, segment: row.segment, originHash: row.originHash, policyHash: row.policyHash,
    leaseOwnerId: row.leaseOwnerId, fencingToken: row.fencingToken.toFixed(0), runRevision: row.runRevision,
    expiresAt: row.expiresAt.toISOString(), chargeId: row.chargeId, requestFingerprint: row.requestFingerprint,
    activeMs: row.activeMs?.toString(), completedAt: row.completedAt?.toISOString() });
}
function boundRow(row: Row, key: { scopeId: string; taskId: string; runId: string }) {
  if (row.scopeId !== key.scopeId || row.taskId !== key.taskId || row.runId !== key.runId
    || row.id !== row.chargeId || !row.requestFingerprint || !/^[a-f0-9]{64}$/u.test(row.originHash)
    || !/^[a-f0-9]{64}$/u.test(row.policyHash) || !Number.isSafeInteger(row.runRevision) || row.runRevision < 1
    || !(row.startedAt instanceof Date) || !Number.isFinite(row.startedAt.getTime())
    || !(row.expiresAt instanceof Date) || !Number.isFinite(row.expiresAt.getTime()) || row.startedAt >= row.expiresAt
    || !/^[1-9][0-9]{0,19}$/u.test(row.fencingToken.toFixed(0))
    || row.completedAt !== null && (!(row.completedAt instanceof Date) || !Number.isFinite(row.completedAt.getTime())
      || row.completedAt < row.startedAt || row.completedAt >= row.expiresAt)) throw denied();
}

/** Read exact scoped charge identities once per evidence category. This is not
 * a cache or settlement port: callers still validate each original measurement.
 * Avoid interval-count round trips inside the already bounded admission window. */
export async function readOriginalRunTimeCharges(db: Pick<Db, 'aiTaskExecutionCharge'>,
  key: { scopeId: string; taskId: string; runId: string }, chargeIds: readonly string[]) {
  if (chargeIds.length > 1000) throw unavailable();
  const expected = new Set(chargeIds), charges = new Map<string, AiTaskExecutionCharge>();
  if (expected.size !== chargeIds.length || chargeIds.some(id => typeof id !== 'string' || !id)) throw denied();
  if (!chargeIds.length) return charges;
  const rows = await db.aiTaskExecutionCharge.findMany({ where: { scopeId: key.scopeId,
    taskId: key.taskId, runId: key.runId, chargeId: { in: [...chargeIds] } }, take: chargeIds.length + 1 });
  for (const row of rows) {
    if (row.scopeId !== key.scopeId || row.taskId !== key.taskId || row.runId !== key.runId
      || !expected.has(row.chargeId) || charges.has(row.chargeId)) throw denied();
    charges.set(row.chargeId, row);
  }
  return charges;
}

/** Only exact run-bound time charges may be excluded from dispatch-trace tests. */
export async function taskOverheadNonEffectChargeIds(db: Pick<Db, 'aiTaskExecutionCharge'>, key: { scopeId: string; taskId: string; runId: string }, lease: AiTaskRunnerLease) {
  if (!(db as { aiTaskRunOverhead?: unknown }).aiTaskRunOverhead) return [];
  const rows = await store(db).findMany({ where: key, take: 1001 });
  if (rows.length > 1000) throw unavailable();
  const ids: string[] = [];
  for (const row of rows) {
    if (!row.chargeId) throw unknown();
    boundRow(row, key);
  }
  const charges = await readOriginalRunTimeCharges(db, key, rows.map(row => row.id));
  for (const row of rows) {
    const charge = charges.get(row.id);
    if (!charge || charge.scopeId !== key.scopeId || charge.taskId !== key.taskId || charge.runId !== key.runId
      || charge.resource !== 'ACTIVE_MS' || charge.stepId !== null || charge.actionId !== null
      || charge.stepFingerprint !== null || charge.gatewayInvocationId !== null
      || charge.leaseOwnerId !== row.leaseOwnerId || charge.fencingToken.toFixed(0) !== row.fencingToken.toFixed(0)
      || charge.requestFingerprint !== row.requestFingerprint) throw denied();
    if (row.completedAt) {
      if (row.activeMs === null || row.measurementHash !== measurement(row) || charge.status !== 'RECORDED'
        || charge.actualAmount !== row.activeMs || row.activeMs > charge.amount
        || charge.outcomeFingerprint !== row.measurementHash || charge.evidenceRef !== `overhead:${row.id}`) throw unknown();
    } else if (row.leaseOwnerId !== lease.holderId || row.fencingToken.toFixed(0) !== lease.fencingToken || charge.status !== 'RESERVED') throw unknown();
    ids.push(row.id);
  }
  return ids;
}

export class PrismaTaskRunOverhead {
  private readonly starts = new Map<string, { at: number; taskId: string; runId: string; holder: string; fence: string;
    expiresAt: string; allowance: number; excludedMs: number; lastToolEnd: number; toolCharges: Set<string>;
    recovery: boolean; originalTimeDebt: boolean }>();
  private ledger?: Pick<import('./prisma-task-execution-budget.repository').PrismaTaskExecutionBudgetRepository,
    'rotateRunTime' | 'finalizeReleasedRunTime'>;
  private readonly pendingContinuations = new Map<string, { expiresAt: number; debts: Map<string, string> }>();
  constructor(private readonly db: Db, private readonly evidence: Evidence,
    private readonly wall: () => Date = () => new Date(), private readonly monotonic: () => number = () => performance.now()) {}

  bindLedger(ledger: NonNullable<PrismaTaskRunOverhead['ledger']>) {
    if (this.ledger || typeof ledger?.rotateRunTime !== 'function'
      || typeof ledger?.finalizeReleasedRunTime !== 'function') throw unavailable();
    this.ledger = ledger;
  }

  /** Same-process adapter observation only: exclude precisely the original
   * reserved tool span, not execute-port wall time. Result serialization, SQL,
   * COMMIT and its reply remain inside the already-reserved orchestration span.
   * Lost result delivery does not refund the tool reservation. */
  excludeToolActivity(lease: AiTaskRunnerLease, chargeId: string, started: number, ended: number) {
    const frames = [...this.starts.values()].filter(frame => frame.taskId === lease.taskId && frame.runId === lease.runId
      && frame.holder === lease.holderId && frame.fence === lease.fencingToken && frame.expiresAt === lease.expiresAt);
    if (!frames.length) return; // Standalone capture has no orchestration interval to overlap.
    if (frames.length !== 1) throw unknown();
    const frame = frames[0], now = this.monotonic();
    if (!chargeId || !Number.isFinite(started) || !Number.isFinite(ended) || !Number.isFinite(now)
      || started < frame.lastToolEnd || ended < started || ended > now || frame.toolCharges.has(chargeId)) throw unknown();
    frame.excludedMs += ended - started;
    frame.lastToolEnd = ended;
    frame.toolCharges.add(chargeId);
  }

  remaining(ticket: AiTaskRunnerOverheadTicket, lease: AiTaskRunnerLease) {
    const frame = this.starts.get(ticket.key), now = this.monotonic();
    if (!frame || frame.taskId !== lease.taskId || frame.runId !== lease.runId || frame.holder !== lease.holderId
      || frame.fence !== lease.fencingToken || frame.expiresAt !== lease.expiresAt || !Number.isFinite(now)
      || now < frame.lastToolEnd) throw unknown();
    return frame.allowance - Math.ceil(now - frame.at - frame.excludedMs);
  }

  private continuationKey(lease: AiTaskRunnerLease) {
    return JSON.stringify([lease.taskId, lease.runId, lease.holderId, lease.fencingToken, lease.expiresAt]);
  }

  private timeDebt(row: Row, charge: AiTaskExecutionCharge | undefined | null, lease: AiTaskRunnerLease,
    originHash: string, policyHash: string, recovery = false) {
    boundRow(row, { scopeId: row.scopeId, taskId: lease.taskId, runId: lease.runId });
    if (!charge || row.originHash !== originHash || row.policyHash !== policyHash
      || row.completedAt !== null || row.activeMs !== null || row.measurementHash !== null
      || (recovery ? row.runRevision > lease.revision || BigInt(row.fencingToken.toFixed(0)) > BigInt(lease.fencingToken)
        || row.fencingToken.toFixed(0) === lease.fencingToken && row.leaseOwnerId !== lease.holderId
        : row.runRevision >= lease.revision || BigInt(row.fencingToken.toFixed(0)) >= BigInt(lease.fencingToken))
      || charge.chargeId !== row.id || charge.scopeId !== row.scopeId || charge.taskId !== row.taskId || charge.runId !== row.runId
      || charge.resource !== 'ACTIVE_MS' || charge.stepId !== null || charge.actionId !== null
      || charge.stepFingerprint !== null || charge.gatewayInvocationId !== null || charge.amount <= 0n
      || !['RESERVED', 'UNKNOWN'].includes(charge.status) || charge.actualAmount !== null
      || charge.outcomeFingerprint !== null || charge.evidenceRef !== null
      || charge.leaseOwnerId !== row.leaseOwnerId || charge.fencingToken.toFixed(0) !== row.fencingToken.toFixed(0)
      || charge.requestFingerprint !== row.requestFingerprint) throw unknown();
    return requestFingerprint({ id: row.id, scopeId: row.scopeId, originHash, policyHash, owner: row.leaseOwnerId,
      fence: row.fencingToken.toFixed(0), revision: row.runRevision, segment: row.segment,
      startedAt: row.startedAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
      requestFingerprint: row.requestFingerprint, amount: charge.amount.toString(), status: charge.status });
  }

  /** A fresh ordinary claim is not enough. Under the original Task/Run locks,
   * prove that only its first PENDING identity exists and no effect was started.
   * Keep old time debt intact; never use this observation to re-time it. */
  private async admitPending(tx: Prisma.TransactionClient, scopeId: string, lease: AiTaskRunnerLease,
    plan: import('./ai-task-runner.ports').AiTaskRunnerPlan,
    intervals: Row[], debts: Map<string, string>, originHash: string, policyHash: string) {
      const key = { scopeId, taskId: lease.taskId, runId: lease.runId };
      const steps = await tx.aiStep.findMany({ where: key, take: 2 }), first = plan.steps[0];
      const input = first && await tx.aiTaskActionInput.findFirst({ where: { ...key, registrationRef: first.registrationRef } });
      if (steps.length !== 1 || !first || !input || input.scopeId !== scopeId || input.taskId !== key.taskId
        || input.runId !== key.runId || input.registrationRef !== first.registrationRef
        || input.toolCode !== first.toolCode || input.toolVersion !== first.toolVersion
        || requestFingerprint(input.payload) !== input.fingerprint
        || steps.some(step => step.scopeId !== scopeId || step.taskId !== key.taskId
        || step.runId !== key.runId || step.status !== 'PENDING' || step.effect !== 'NONE'
        || step.sequence !== 1 || step.revision !== 1 || step.resultRef !== null || step.errorCode !== null
        || step.toolCode !== first.toolCode || step.toolVersion !== first.toolVersion
        || step.inputRef !== input.id || step.requestFingerprint !== input.fingerprint)) throw unknown();
      const [charge, invocation, phase, artifact] = await Promise.all([
        tx.aiTaskExecutionCharge.findFirst({ where: { ...key, chargeId: {
          notIn: intervals.filter(row => row.runId === key.runId && row.scopeId === scopeId).map(row => row.id) } } }),
        tx.aiGatewayInvocation.findFirst({ where: key }),
        tx.aiTaskExecutionPhaseStart.findFirst({ where: key }),
        tx.aiTaskResultArtifact.findFirst({ where: key })
      ]);
      if (charge || invocation || phase || artifact) throw unknown();
      for (const [id, fingerprint] of debts) {
        const row = await store(tx).findUnique({ where: { scopeId_taskId_id: { scopeId, taskId: key.taskId, id } } });
        const original = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: key.taskId, chargeId: id } } });
        if (!row || row.scopeId !== scopeId || this.timeDebt(row, original, lease, originHash, policyHash) !== fingerprint) throw unknown();
      }
  }

  async begin(leaseValue: AiTaskRunnerLease, segment: string, maximumMs: number | undefined, retainStepAllowance: boolean,
    recovery: boolean, budget: AiTaskExecutionBudgetPort, pendingStart = false): Promise<AiTaskRunnerOverheadTicket> {
    const at = this.monotonic(), lease = structuredClone(leaseValue);
    if (!Number.isFinite(at) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(segment)
      || maximumMs !== undefined && (!Number.isSafeInteger(maximumMs) || maximumMs < 1)) throw unavailable();
    const scopeId = await this.evidence.assertHeldRun(lease), key = { scopeId, taskId: lease.taskId, runId: lease.runId };
    const task = await this.db.aiTask.findFirst({ where: { scopeId, id: lease.taskId } });
    if (!task) throw denied();
    const plan = await this.evidence.resolve({ taskId: task.id, revision: task.revision,
      status: task.status.toLowerCase() as import('@rental-os/shared').AiTaskStatusDraft,
      cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null }, lease, recovery);
    const origin = await this.evidence.resourceOrigin(plan, lease);
    const originHash = requestFingerprint({ taskId: origin.taskId, runId: origin.runId, steps: origin.steps, limits: origin.limits });
    let snapshot = recovery ? await budget.load(lease.taskId, lease) : await budget.initialize(lease.taskId, lease);
    if (snapshot.scopeId !== scopeId || snapshot.taskId !== lease.taskId) throw denied();
    const intervals = await store(this.db).findMany({ where: { scopeId, taskId: lease.taskId }, take: 1001 });
    if (intervals.length > 1000) throw unavailable();
    // Unknown timing never licenses repeating its interval. An explicit fresh
    // ordinary claim may start a distinct, original PENDING action only after a
    // locked no-execution proof. Its time debt still occupies the same budget.
    // A current recovery lease can observe original results while retaining
    // that debt; its own bounded local time never repeats the old interval.
    const continuationKey = this.continuationKey(lease);
    for (const [key, value] of this.pendingContinuations) if (value.expiresAt <= this.wall().getTime()) this.pendingContinuations.delete(key);
    let retained = this.pendingContinuations.get(continuationKey)?.debts;
    let pendingAdmission = false, recoveryTimeDebt = false;
    if (!recovery && (lease as AiTaskRunnerLease & { purpose?: string }).purpose === 'recovery_only') throw denied();
    if (intervals.length) {
      const charges = await this.db.aiTaskExecutionCharge.findMany({ where: { scopeId, taskId: lease.taskId,
        chargeId: { in: intervals.map(row => row.id) } }, take: 1001 });
      if (charges.length !== intervals.length) throw unknown();
      const debts = new Map<string, string>();
      for (const row of intervals) {
        let charge = charges.find(candidate => candidate.chargeId === row.id);
        if (row.scopeId !== scopeId || row.taskId !== lease.taskId) throw denied();
        if (row.completedAt) {
          // Only an existing exact measurement can settle its original charge.
          // Lost timing below is retained untouched; a different Run is never
          // reconciled through this lease or assigned a replacement identity.
          if (recovery && row.runId === lease.runId && charge && ['RESERVED', 'UNKNOWN'].includes(charge.status)) {
            await budget.reconcile({ taskId: lease.taskId, lease, chargeId: row.id, evidenceRef: `overhead:${row.id}` });
            charge = await this.db.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: {
              scopeId, taskId: lease.taskId, chargeId: row.id } } }) ?? undefined;
            snapshot = await budget.load(lease.taskId, lease);
          }
          if (row.activeMs === null || row.chargeId !== row.id || !charge
            || charge.status !== 'RECORDED' || charge.scopeId !== row.scopeId || charge.taskId !== row.taskId
            || charge.runId !== row.runId || charge.resource !== 'ACTIVE_MS' || charge.stepId !== null
            || charge.actionId !== null || charge.stepFingerprint !== null || charge.gatewayInvocationId !== null
            || charge.leaseOwnerId !== row.leaseOwnerId || charge.fencingToken.toFixed(0) !== row.fencingToken.toFixed(0)
            || charge.requestFingerprint !== row.requestFingerprint || charge.actualAmount !== row.activeMs
            || row.measurementHash !== measurement(row) || charge.outcomeFingerprint !== row.measurementHash
            || charge.evidenceRef !== `overhead:${row.id}` || row.policyHash !== snapshot.policy.fingerprint) throw unknown();
        } else {
          const debt = this.timeDebt(row, charge, lease, originHash, snapshot.policy.fingerprint, recovery);
          if (recovery) recoveryTimeDebt = true;
          else debts.set(row.id, debt);
        }
      }
      if (debts.size) {
        if (retained) {
          if (retained.size !== debts.size || [...debts].some(([id, hash]) => retained!.get(id) !== hash)) throw unknown();
        } else {
          if (!pendingStart || segment !== 'startup' || !retainStepAllowance || this.pendingContinuations.size >= 1000) throw unknown();
          pendingAdmission = true;
          retained = debts;
        }
      }
    }
    // Preserve a full step allowance when possible. If only orchestration fits,
    // persist the original pending successor before stopping: an absent step is
    // not proof that the completed prefix satisfied the whole immutable plan.
    // This interval never grants a step reservation/start or borrows old debt.
    const available = snapshot.policy.limits.active_ms - snapshot.consumed.active_ms - snapshot.reserved.active_ms;
    const stepAllowanceUnavailable = retainStepAllowance && available <= BigInt(plan.limits.maxStepMs);
    const free = available - (retainStepAllowance && !stepAllowanceUnavailable ? BigInt(plan.limits.maxStepMs) : 0n);
    // Startup has no caller-side plan yet. Resolve its window from the original
    // authorized plan here, not a second fixed five-second work policy. This
    // changes no stored ceiling, occupancy or bounded reservation reply wait.
    const maximum = maximumMs ?? plan.limits.maxStepMs;
    const allowance = Math.min(maximum, Number(free), Date.parse(lease.expiresAt) - this.wall().getTime());
    if (!Number.isSafeInteger(allowance) || allowance < 1) throw new AiTaskExecutionBudgetError('AI_RUN_LIMIT');
    const id = uuid(requestFingerprint({ version: 'run-overhead-charge-1', ...key, holder: lease.holderId,
      fence: lease.fencingToken, segment, ...(recovery ? { recoveryRevision: lease.revision } : {}) }));
    const existing = await store(this.db).findUnique({ where: { scopeId_taskId_id: { scopeId, taskId: lease.taskId, id } } });
    // One key names one attempted local interval. Recovery uses the held CAS
    // revision to meter its observation; repeated/ambiguous observation cannot
    // reopen the same interval, refund old debt or dispatch another effect.
    if (existing) throw unknown();
    let attempted = false;
    try {
      await this.evidence.withHeldRun(lease, async (tx, currentScope) => {
        if (currentScope !== scopeId) throw denied();
        if (pendingAdmission) await this.admitPending(tx, scopeId, lease, plan, intervals, retained!, originHash, snapshot.policy.fingerprint);
        attempted = true;
        await store(tx).create({ data: { ...key, id, segment, originHash, policyHash: snapshot.policy.fingerprint,
          leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken), runRevision: lease.revision,
          expiresAt: new Date(lease.expiresAt), startedAt: this.wall() } });
      });
      const reserved = await budget.reserve({ taskId: lease.taskId, lease, chargeId: id, resource: 'active_ms', amount: BigInt(allowance), target: { kind: 'run' } });
      if (reserved.replayed) throw unknown();
      await this.evidence.withHeldRun(lease, async (tx, currentScope) => {
        if (currentScope !== scopeId) throw denied();
        if ((await store(tx).updateMany({ where: { ...key, id, chargeId: null, completedAt: null,
          leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken), runRevision: lease.revision },
          data: { chargeId: id, requestFingerprint: reserved.charge.requestFingerprint } })).count !== 1) throw unknown();
      });
      const elapsed = this.monotonic() - at, remainingMs = allowance - Math.ceil(elapsed);
      if (!Number.isFinite(elapsed) || elapsed < 0 || remainingMs < 1) throw unknown();
      this.starts.set(id, { at, taskId: lease.taskId, runId: lease.runId, holder: lease.holderId,
        fence: lease.fencingToken, expiresAt: lease.expiresAt, allowance, excludedMs: 0, lastToolEnd: at, toolCharges: new Set(),
        recovery, originalTimeDebt: recoveryTimeDebt || !recovery && !!retained?.size });
      if (retained?.size) this.pendingContinuations.set(continuationKey, { expiresAt: Date.parse(lease.expiresAt), debts: retained });
      return { key: id, remainingMs, ...(stepAllowanceUnavailable ? { stepAllowanceUnavailable: true as const } : {}),
        ...(recoveryTimeDebt || !recovery && retained?.size ? { originalTimeDebt: true as const } : {}) };
    } catch (error) {
      this.starts.delete(id);
      if (attempted) {
        await budget.markUnknown({ taskId: lease.taskId, lease, chargeId: id, reason: 'orchestration_interval_uncertain' }).catch(() => {});
        throw unknown();
      }
      throw error;
    }
  }

  /** Same-process old measurement and next original reservation meet at one
   * clock sample inside the ledger transaction. COMMIT/reply belongs to the
   * already-reserved successor, never to a free gap or a replayed interval. */
  async rotate(ticket: AiTaskRunnerOverheadTicket, leaseValue: AiTaskRunnerLease, segment: string,
    maximumMs: number | undefined, retainStepAllowance: boolean, budget: AiTaskExecutionBudgetPort): Promise<AiTaskRunnerOverheadTicket> {
    const lease = structuredClone(leaseValue), frame = this.starts.get(ticket.key);
    if (!this.ledger || !frame || frame.taskId !== lease.taskId || frame.runId !== lease.runId
      || frame.holder !== lease.holderId || frame.fence !== lease.fencingToken || frame.expiresAt !== lease.expiresAt) throw unknown();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(segment)
      || maximumMs !== undefined && (!Number.isSafeInteger(maximumMs) || maximumMs < 1)) throw unavailable();
    const scopeId = await this.evidence.assertHeldRun(lease), key = { scopeId, taskId: lease.taskId, runId: lease.runId };
    const task = await this.db.aiTask.findFirst({ where: { scopeId, id: lease.taskId } });
    if (!task) throw denied();
    const plan = await this.evidence.resolve({ taskId: task.id, revision: task.revision,
      status: task.status.toLowerCase() as import('@rental-os/shared').AiTaskStatusDraft,
      cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null }, lease, frame.recovery);
    const origin = await this.evidence.resourceOrigin(plan, lease);
    const originHash = requestFingerprint({ taskId: origin.taskId, runId: origin.runId, steps: origin.steps, limits: origin.limits });
    const nextId = uuid(requestFingerprint({ version: 'run-overhead-charge-1', ...key, holder: lease.holderId, fence: lease.fencingToken, segment,
      ...(frame.recovery ? { recoveryRevision: lease.revision } : {}) }));
    let nextAt = 0, nextWall: Date | undefined, nextPolicyHash = '';
    try {
      const rotated = await this.ledger.rotateRunTime({ taskId: lease.taskId, lease, expiresAt: lease.expiresAt,
        previousChargeId: ticket.key, nextChargeId: nextId, maximumMs: maximumMs ?? plan.limits.maxStepMs,
        retainMs: retainStepAllowance ? BigInt(plan.limits.maxStepMs) : 0n }, {
        close: async (tx, currentScope, charge, policyFingerprint) => {
          if (currentScope !== scopeId) throw denied();
          nextPolicyHash = policyFingerprint;
          const row = await store(tx).findUnique({ where: { scopeId_taskId_id: { scopeId, taskId: lease.taskId, id: ticket.key } } });
          if (!row) throw unknown(); boundRow(row, key);
          if (row.chargeId !== ticket.key || row.completedAt !== null || row.activeMs !== null || row.measurementHash !== null
            || row.originHash !== originHash || row.policyHash !== policyFingerprint || row.requestFingerprint !== charge.requestFingerprint
            || row.leaseOwnerId !== lease.holderId || row.fencingToken.toFixed(0) !== lease.fencingToken
            || row.runRevision > lease.revision || row.expiresAt.toISOString() !== lease.expiresAt) throw unknown();
          if (!frame.recovery) {
            const retained = this.pendingContinuations.get(this.continuationKey(lease))?.debts ?? new Map<string, string>();
            const rows = await store(tx).findMany({ where: { scopeId, taskId: lease.taskId }, take: 1001 });
            if (rows.length > 1000) throw unavailable();
            const debts = new Map<string, string>();
            for (const candidate of rows) if (candidate.id !== ticket.key && !candidate.completedAt) {
              const original = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: {
                scopeId, taskId: lease.taskId, chargeId: candidate.id } } });
              debts.set(candidate.id, this.timeDebt(candidate, original, lease, originHash, policyFingerprint));
            }
            if (retained.size !== debts.size || [...debts].some(([id, hash]) => retained.get(id) !== hash)) throw unknown();
          }
          nextAt = this.monotonic(); nextWall = this.wall();
          const elapsed = nextAt - frame.at - frame.excludedMs;
          if (!Number.isFinite(nextAt) || nextAt < frame.lastToolEnd || elapsed < 0 || elapsed > Number(charge.amount)) throw unknown();
          const completed = { ...row, completedAt: nextWall, activeMs: BigInt(Math.ceil(elapsed)) };
          boundRow(completed, key);
          const hash = measurement(completed);
          if ((await store(tx).updateMany({ where: { ...key, id: ticket.key, completedAt: null,
            chargeId: ticket.key, requestFingerprint: charge.requestFingerprint }, data: {
            completedAt: nextWall, activeMs: completed.activeMs, measurementHash: hash } })).count !== 1) throw unknown();
          return { scopeId, taskId: lease.taskId, runId: lease.runId, chargeId: ticket.key,
            requestFingerprint: charge.requestFingerprint, resource: 'active_ms', actualAmount: completed.activeMs,
            evidenceHash: hash, evidenceRef: `overhead:${ticket.key}`, dispatchToken: null, gatewayInvocationId: null };
        },
        open: async (tx, currentScope, charge) => {
          if (currentScope !== scopeId || !nextWall || !Number.isFinite(nextAt) || !/^[a-f0-9]{64}$/u.test(nextPolicyHash)) throw unknown();
          await store(tx).create({ data: { ...key, id: nextId, segment, originHash, policyHash: nextPolicyHash,
            leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken), runRevision: lease.revision,
            expiresAt: new Date(lease.expiresAt), startedAt: nextWall, chargeId: nextId, requestFingerprint: charge.requestFingerprint } });
        }
      });
      await this.evidence.assertHeldRun(lease);
      const elapsed = this.monotonic() - nextAt, remainingMs = Number(rotated.amount) - Math.ceil(elapsed);
      if (!Number.isFinite(elapsed) || elapsed < 0 || remainingMs < 1) throw unknown();
      this.starts.delete(ticket.key);
      this.starts.set(nextId, { ...frame, at: nextAt, allowance: Number(rotated.amount), excludedMs: 0,
        lastToolEnd: nextAt, toolCharges: new Set() });
      return { key: nextId, remainingMs, ...(rotated.stepAllowanceUnavailable ? { stepAllowanceUnavailable: true as const } : {}),
        ...(frame.originalTimeDebt ? { originalTimeDebt: true as const } : {}) };
    } catch (error) {
      if (error instanceof AiTaskExecutionBudgetError && error.code === 'AI_RUN_LIMIT') throw error;
      this.starts.delete(ticket.key);
      await budget.markUnknown({ taskId: lease.taskId, lease, chargeId: nextId, reason: 'orchestration_handoff_uncertain' }).catch(() => {});
      throw unknown();
    }
  }

  /** Infrastructure-only handoff from the original preparation clock. The
   * callback is bound by the persistent composition, never supplied by a task,
   * model or receipt. The common clock sample precedes both SQL writes. */
  async beginFromPreparation(leaseValue: AiTaskRunnerLease, previousChargeId: string,
    recovery: boolean, retainStepAllowance: boolean, close: (tx: Prisma.TransactionClient, scopeId: string,
      charge: AiTaskExecutionCharge, policyFingerprint: string) => Promise<{
        evidence: import('../task-execution-budget.ports').AiTaskExecutionChargeEvidence; at: number; wall: Date
      }>, budget: AiTaskExecutionBudgetPort): Promise<AiTaskRunnerOverheadTicket> {
    if (!this.ledger || typeof close !== 'function') throw unavailable();
    const lease = structuredClone(leaseValue), scopeId = await this.evidence.assertHeldRun(lease);
    const key = { scopeId, taskId: lease.taskId, runId: lease.runId };
    const task = await this.db.aiTask.findFirst({ where: { scopeId, id: lease.taskId } });
    if (!task) throw denied();
    const plan = await this.evidence.resolve({ taskId: task.id, revision: task.revision,
      status: task.status.toLowerCase() as import('@rental-os/shared').AiTaskStatusDraft,
      cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null }, lease, recovery);
    const origin = await this.evidence.resourceOrigin(plan, lease);
    const originHash = requestFingerprint({ taskId: origin.taskId, runId: origin.runId, steps: origin.steps, limits: origin.limits });
    const id = uuid(requestFingerprint({ version: 'run-overhead-charge-1', ...key,
      holder: lease.holderId, fence: lease.fencingToken, segment: 'startup' }));
    if (this.starts.has(id)) throw unknown();
    let at = 0, wall: Date | undefined, policyHash = '';
    try {
      const result = await this.ledger.rotateRunTime({ taskId: lease.taskId, lease, expiresAt: lease.expiresAt,
        previousChargeId, nextChargeId: id, maximumMs: plan.limits.maxStepMs,
        retainMs: retainStepAllowance ? BigInt(plan.limits.maxStepMs) : 0n }, {
        close: async (tx, currentScope, charge, fingerprint) => {
          if (currentScope !== scopeId) throw denied();
          // A preparation receipt cannot clear an earlier unmeasured Run. Do not
          // admit a startup or borrow its occupancy to continue unknown work.
          const intervals = await store(tx).findMany({ where: { scopeId, taskId: lease.taskId }, take: 1001 });
          if (intervals.length > 1000 || intervals.some(row => !row.completedAt)) throw unknown();
          policyHash = fingerprint;
          const measured = await close(tx, currentScope, charge, fingerprint);
          at = measured.at; wall = measured.wall;
          if (!Number.isFinite(at) || !(wall instanceof Date) || !Number.isFinite(wall.getTime())
            || wall.getTime() >= Date.parse(lease.expiresAt)) throw unknown();
          return measured.evidence;
        },
        open: async (tx, currentScope, charge) => {
          if (currentScope !== scopeId || !wall || !/^[a-f0-9]{64}$/u.test(policyHash)) throw unknown();
          await store(tx).create({ data: { ...key, id, segment: 'startup', originHash, policyHash,
            leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken), runRevision: lease.revision,
            expiresAt: new Date(lease.expiresAt), startedAt: wall, chargeId: id, requestFingerprint: charge.requestFingerprint } });
        }
      });
      await this.evidence.assertHeldRun(lease);
      const spent = this.monotonic() - at, remainingMs = Number(result.amount) - Math.ceil(spent);
      if (!Number.isFinite(spent) || spent < 0 || remainingMs < 1) throw unknown();
      this.starts.set(id, { at, taskId: lease.taskId, runId: lease.runId, holder: lease.holderId,
        fence: lease.fencingToken, expiresAt: lease.expiresAt, allowance: Number(result.amount),
        excludedMs: 0, lastToolEnd: at, toolCharges: new Set(), recovery, originalTimeDebt: false });
      return { key: id, remainingMs, ...(result.stepAllowanceUnavailable ? { stepAllowanceUnavailable: true as const } : {}) };
    } catch {
      // Even a local rollback does not make a spent preparation repeatable. A
      // committed but undelivered startup retains its original unknown charge.
      this.starts.delete(id);
      await budget.markUnknown({ taskId: lease.taskId, lease, chargeId: id, reason: 'preparation_startup_handoff_uncertain' }).catch(() => {});
      throw unknown();
    }
  }

  async complete(ticket: AiTaskRunnerOverheadTicket, lease: AiTaskRunnerLease, budget: AiTaskExecutionBudgetPort) {
    return this.closeMeasurement(ticket, lease, budget);
  }

  async completeAfterRelease(ticket: AiTaskRunnerOverheadTicket, lease: AiTaskRunnerLease,
    receipt: { released: true; revision: number }, budget: AiTaskExecutionBudgetPort) {
    if (receipt?.released !== true || receipt.revision !== lease.revision + 1) throw unknown();
    return this.closeMeasurement(ticket, lease, budget, structuredClone(receipt));
  }

  private async closeMeasurement(ticket: AiTaskRunnerOverheadTicket, leaseValue: AiTaskRunnerLease,
    budget: AiTaskExecutionBudgetPort, release?: { released: true; revision: number }) {
    const lease = structuredClone(leaseValue), started = this.starts.get(ticket.key);
    if (!started || started.taskId !== lease.taskId || started.runId !== lease.runId || started.holder !== lease.holderId
      || started.fence !== lease.fencingToken || started.expiresAt !== lease.expiresAt) throw unknown();
    const accountingLease = release ? { ...lease, revision: release.revision, expiresAt: '' } : lease;
    const scopeId = await this.evidence.assertAccountingRun(accountingLease), key = { scopeId, taskId: lease.taskId, runId: lease.runId };
    try {
      const write = async (tx: Prisma.TransactionClient, currentScope: string) => {
        if (currentScope !== scopeId) throw denied();
        const row = await store(tx).findUnique({ where: { scopeId_taskId_id: { scopeId, taskId: lease.taskId, id: ticket.key } } });
        if (!row) throw unknown();
        boundRow(row, key);
        const charge = await tx.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: lease.taskId, chargeId: ticket.key } } });
        const ended = this.monotonic(), elapsed = ended - started.at - started.excludedMs;
        if (ended < started.lastToolEnd) throw unknown();
        if (!charge || charge.status !== 'RESERVED' || charge.resource !== 'ACTIVE_MS' || charge.runId !== lease.runId
          || charge.scopeId !== scopeId || charge.taskId !== lease.taskId || charge.stepId !== null
          || charge.actionId !== null || charge.stepFingerprint !== null || charge.gatewayInvocationId !== null
          || charge.leaseOwnerId !== row.leaseOwnerId
          || charge.fencingToken.toFixed(0) !== row.fencingToken.toFixed(0) || charge.requestFingerprint !== row.requestFingerprint
          || row.completedAt || row.runRevision > lease.revision || row.leaseOwnerId !== lease.holderId
          || row.expiresAt.toISOString() !== lease.expiresAt
          || row.fencingToken.toFixed(0) !== lease.fencingToken || !Number.isFinite(elapsed) || elapsed < 0 || elapsed > Number(charge.amount)) throw unknown();
        const completed = { ...row, completedAt: this.wall(), activeMs: BigInt(Math.ceil(elapsed)) };
        boundRow(completed, key);
        const hash = measurement(completed);
        if ((await store(tx).updateMany({ where: { ...key, id: row.id, completedAt: null, chargeId: row.id,
          requestFingerprint: row.requestFingerprint }, data: { completedAt: completed.completedAt,
          activeMs: completed.activeMs, measurementHash: hash } })).count !== 1) throw unknown();
        return { scopeId, taskId: lease.taskId, runId: lease.runId, chargeId: ticket.key,
          requestFingerprint: charge.requestFingerprint, resource: 'active_ms' as const, actualAmount: completed.activeMs,
          evidenceHash: hash, evidenceRef: `overhead:${ticket.key}`, dispatchToken: null, gatewayInvocationId: null };
      };
      if (release) {
        if (!this.ledger) throw unavailable();
        // After this sample only the original receipt/ledger settlement remains;
        // it neither reopens active execution nor creates another timing charge.
        await this.ledger.finalizeReleasedRunTime({ taskId: lease.taskId, lease, expiresAt: lease.expiresAt,
          chargeId: ticket.key, release }, { measure: write, verify: async (_tx, currentScope) => {
            if (currentScope !== scopeId) throw denied();
            await this.evidence.assertAccountingRun(accountingLease);
          } });
      } else {
        await this.evidence.withAccountingRun(lease, write);
        await budget.record({ taskId: lease.taskId, lease: accountingLease, chargeId: ticket.key, evidenceRef: `overhead:${ticket.key}` });
      }
    } catch { throw unknown(); }
    finally { this.starts.delete(ticket.key); }
  }

  async abandon(ticket: AiTaskRunnerOverheadTicket, lease: AiTaskRunnerLease, budget: AiTaskExecutionBudgetPort) {
    this.starts.delete(ticket.key);
    await budget.markUnknown({ taskId: lease.taskId, lease, chargeId: ticket.key, reason: 'orchestration_interval_uncertain' });
  }

  async read(input: AiTaskExecutionSettlementRequest, _reconcile: boolean) {
    const lease = { ...structuredClone(input.lease), expiresAt: '' }, scopeId = await this.evidence.assertAccountingRun(lease);
    if (input.taskId !== lease.taskId || input.evidenceRef !== `overhead:${input.chargeId}`) throw denied();
    const row = await store(this.db).findUnique({ where: { scopeId_taskId_id: { scopeId, taskId: lease.taskId, id: input.chargeId } } });
    if (!row) throw unknown();
    boundRow(row, { scopeId, taskId: lease.taskId, runId: lease.runId });
    const task = await this.db.aiTask.findFirst({ where: { scopeId, id: lease.taskId } });
    const originalBudget = await this.db.aiTaskExecutionBudget.findUnique({ where: { scopeId_taskId: { scopeId, taskId: lease.taskId } } });
    if (!task || !originalBudget || originalBudget.scopeId !== scopeId || originalBudget.taskId !== lease.taskId
      || originalBudget.policyFingerprint !== row.policyHash || row.runRevision > lease.revision
      || BigInt(row.fencingToken.toFixed(0)) > BigInt(lease.fencingToken)
      || row.fencingToken.toFixed(0) === lease.fencingToken && row.leaseOwnerId !== lease.holderId) throw denied();
    // Read immutable provenance under current receipt authority, not a fresh
    // execution policy. A closed policy cannot erase the original measurement.
    const plan = await this.evidence.resolve({ taskId: task.id, revision: task.revision,
      status: task.status.toLowerCase() as import('@rental-os/shared').AiTaskStatusDraft,
      cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null }, lease, true, true);
    const origin = await this.evidence.resourceOrigin(plan, lease, true);
    if (row.originHash !== requestFingerprint({ taskId: origin.taskId, runId: origin.runId, steps: origin.steps, limits: origin.limits })) throw denied();
    const charge = await this.db.aiTaskExecutionCharge.findUnique({ where: { scopeId_taskId_chargeId: { scopeId, taskId: lease.taskId, chargeId: input.chargeId } } });
    if (!row.completedAt || row.activeMs === null || row.measurementHash !== measurement(row) || !charge
      || charge.scopeId !== scopeId || charge.taskId !== lease.taskId || charge.runId !== lease.runId
      || charge.stepId !== null || charge.actionId !== null || charge.stepFingerprint !== null || charge.gatewayInvocationId !== null
      || charge.resource !== 'ACTIVE_MS' || charge.leaseOwnerId !== row.leaseOwnerId
      || charge.fencingToken.toFixed(0) !== row.fencingToken.toFixed(0) || charge.requestFingerprint !== row.requestFingerprint
      || row.activeMs < 0n || row.activeMs > charge.amount) throw denied();
    await this.evidence.assertAccountingRun(lease);
    return { scopeId, taskId: lease.taskId, runId: lease.runId, chargeId: input.chargeId,
      requestFingerprint: charge.requestFingerprint, resource: 'active_ms' as const, actualAmount: row.activeMs,
      evidenceHash: row.measurementHash!, evidenceRef: input.evidenceRef, dispatchToken: null, gatewayInvocationId: null };
  }
}
