/**
 * 职责：根据受权计划与持久租约推进任务步骤，协调暂停、恢复和确认继续等执行路径。
 * 边界：权限、步骤副作用、存储与资源计量经注入 ports 完成，不直接派发供应商请求。
 * 恢复必须保留 fencing 和原操作关联；租约过期或取消不证明外部副作用未发生。
 */
import {
  type AiTaskRunnerClock, type AiTaskRunnerDependencies, type AiTaskRunnerEffectResult, type AiTaskRunnerClaimInput,
  type AiTaskRunnerInput, type AiTaskRunnerLease, type AiTaskRunnerLimits,
  type AiTaskRunnerOutcome, type AiTaskRunnerPlan, type AiTaskRunnerStepPlan,
  type AiTaskRunnerStepCommit, type AiTaskRunnerStepRef, type AiTaskRunnerTaskOutcome,
  type AiTaskRunnerOutcomePort, type AiTaskRunnerResourceTicket,
  type AiTaskRunnerRecoveryLease, type AiTaskRunnerTaskMetadata,
  type AiTaskRunnerConfirmationRequest, type AiTaskRunnerConfirmationContinuation
} from "./ai-task-runner.ports";

export class AiTaskRunnerError extends Error {
  constructor(readonly code: "AI_INVALID_INPUT" | "AI_RESOURCE_UNAVAILABLE" | "AI_RUN_LIMIT" | "AI_RESULT_UNKNOWN" | "AI_STORAGE_UNAVAILABLE", message: string = code) {
    super(message);
    this.name = "AiTaskRunnerError";
  }
}

/** Only the resource adapter's read-only preflight may emit this proof. A
 * timeout or rejection after an attempted write keeps the ordinary unknown path. */
export class AiTaskRunnerPreReservationLimitError extends AiTaskRunnerError {
  constructor() { super('AI_RUN_LIMIT', 'original task resources cannot admit the next step'); }
}

/** Claim acknowledgement, not a later lease read, owns execution/cleanup.
 * Share this check with original business recovery hosts; an uncertain claim
 * may already have committed, so no guessed release or second claim is safe. */
export function snapshotAiTaskRunnerClaimLease(input: AiTaskRunnerClaimInput, value: unknown): AiTaskRunnerLease {
  let lease: AiTaskRunnerLease;
  try { lease = structuredClone(value) as AiTaskRunnerLease; }
  catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'lease claim acknowledgement is not snapshot-safe'); }
  const fence = /^(0|[1-9][0-9]{0,19})$/u;
  if (!lease || lease.taskId !== input.taskId || lease.runId !== input.runId || lease.holderId !== input.holderId
    || !finiteInteger(input.expectedRunRevision, 1, 4294967294)
    || lease.revision !== input.expectedRunRevision + 1
    || typeof input.expectedFencingToken !== 'string' || !fence.test(input.expectedFencingToken)
    || typeof lease.fencingToken !== 'string' || !fence.test(lease.fencingToken)
    || BigInt(lease.fencingToken) !== BigInt(input.expectedFencingToken) + 1n
    || typeof lease.expiresAt !== 'string' || !Number.isFinite(Date.parse(lease.expiresAt))) {
    throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'lease claim does not match the original CAS');
  }
  return lease;
}

const defaultClock: AiTaskRunnerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/** Shared wait boundary for the runner and its explicit recovery hosts.
 * Interruption only stops local continuation; it never attests rollback. */
export function callAiTaskRunnerDependency<T>(operation: (signal: AbortSignal) => Promise<T>, limitMs: number,
  phase: string, signal?: AbortSignal, clock: AiTaskRunnerClock = defaultClock): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false, timer: unknown, timerStarted = false;
    const clear = () => {
      try { if (timerStarted) clock.clearTimeout(timer); } catch { /* cleanup cannot revive a closed wait */ }
      signal?.removeEventListener('abort', onAbort);
    };
    const stop = (code: 'AI_RESULT_UNKNOWN' | 'AI_RUN_LIMIT', message: string) => {
      if (settled) return;
      settled = true; clear(); controller.abort();
      reject(new AiTaskRunnerError(code, message));
    };
    const onAbort = () => stop('AI_RESULT_UNKNOWN', `${phase} interrupted`);
    if (signal?.aborted) { onAbort(); return; }
    try {
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = clock.setTimeout(() => stop(phase === 'reconcile' ? 'AI_RESULT_UNKNOWN' : 'AI_RUN_LIMIT', `${phase} deadline exceeded`), limitMs);
      timerStarted = true;
      if (settled) { clear(); return; }
      if (signal?.aborted) { onAbort(); return; }
      Promise.resolve(operation(controller.signal)).then(value => {
        if (!settled) { settled = true; clear(); resolve(value); }
      }, error => {
        if (!settled) { settled = true; clear(); reject(error); }
      });
    } catch (error) { settled = true; clear(); reject(error); }
  });
}

function finiteInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function validateLimits(value: AiTaskRunnerLimits): AiTaskRunnerLimits {
  if (!value || !finiteInteger(value.maxSteps, 1, 1000) || !finiteInteger(value.maxTotalMs, 1, 86_400_000)
    || !finiteInteger(value.maxStepMs, 1, value.maxTotalMs) || !finiteInteger(value.maxOutputBytes, 1, 16 * 1024 * 1024)
    || !finiteInteger(value.maxConcurrent, 1, 1) || !finiteInteger(value.maxCalls, 1, 1000)) {
    throw new AiTaskRunnerError("AI_RUN_LIMIT", "trusted runner limits are missing or invalid");
  }
  return value;
}

function validatePlan(plan: AiTaskRunnerPlan, input: Pick<AiTaskRunnerInput, 'taskId' | 'runId'>, modelCallsMetered = false): AiTaskRunnerPlan {
  if (!plan || plan.taskId !== input.taskId || plan.runId !== input.runId || !Array.isArray(plan.steps)) {
    throw new AiTaskRunnerError("AI_RESOURCE_UNAVAILABLE", "authorized task plan is unavailable");
  }
  const limits = validateLimits(plan.limits);
  // Persistent calls are Gateway invocations, not business reads or original
  // receipt reconciliation. The resource gate owns their durable admission.
  // Legacy isolated consumers have no classifier and retain the stricter cap.
  if (plan.steps.length > limits.maxSteps || (!modelCallsMetered && plan.steps.length > limits.maxCalls)) throw new AiTaskRunnerError("AI_RUN_LIMIT");
  for (const step of plan.steps) {
    if (!step || typeof step.registrationRef !== "string" || step.registrationRef.length < 1 || step.registrationRef.length > 191
      || typeof step.toolCode !== "string" || step.toolCode.length < 1 || step.toolCode.length > 191
      || typeof step.toolVersion !== "string" || step.toolVersion.length < 1 || step.toolVersion.length > 191
      || !["readonly", "idempotent", "external_unknown"].includes(step.operation)) throw new AiTaskRunnerError("AI_RESOURCE_UNAVAILABLE");
  }
  if (new Set(plan.steps.map(step => step.registrationRef)).size !== plan.steps.length) throw new AiTaskRunnerError("AI_INVALID_INPUT");
  return { ...plan, limits };
}

function boundedResult(result: AiTaskRunnerEffectResult, maxOutputBytes: number): AiTaskRunnerEffectResult {
  if (!result || !["succeeded", "failed", "paused", "unknown"].includes(result.kind)
    || (result.kind === "paused" && !["input", "confirmation", "external"].includes(result.pause))
    || (result.kind === "failed" && (typeof result.errorCode !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(result.errorCode)))) throw new AiTaskRunnerError("AI_RESOURCE_UNAVAILABLE");
  if (!finiteInteger(result.outputBytes, 0, maxOutputBytes)) throw new AiTaskRunnerError("AI_RUN_LIMIT");
  if (result.resultRef !== undefined && result.resultRef !== null
    && (typeof result.resultRef !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(result.resultRef))) throw new AiTaskRunnerError("AI_RESOURCE_UNAVAILABLE");
  return result;
}

/** Server composition callback only, never accepted in a task request DTO. */
export type AiTaskHeldPreparation = (held: { lease: AiTaskRunnerLease; taskRevision: number; signal?: AbortSignal }) => Promise<void>;
const heldPreparationWindows = new WeakMap<AiTaskHeldPreparation, number>();
const heldPreparationDefinitions = new WeakMap<AiTaskHeldPreparation, import('./task-run-preparation.ports').AiTaskPreparationDefinition>();

/** Registered server metadata only. Properties on a callback or task DTO cannot
 * grant quotas; the persistent preparation authority validates this definition. */
export function withAiTaskHeldPreparationDefinition(prepare: AiTaskHeldPreparation,
  definition: import('./task-run-preparation.ports').AiTaskPreparationDefinition): AiTaskHeldPreparation {
  if (typeof prepare !== 'function' || heldPreparationDefinitions.has(prepare)) throw new AiTaskRunnerError('AI_INVALID_INPUT');
  heldPreparationDefinitions.set(prepare, structuredClone(definition));
  return prepare;
}

/** A server guard wrapper retains the original resource definition/window. */
export function inheritAiTaskHeldPreparation(prepare: AiTaskHeldPreparation, original: AiTaskHeldPreparation): AiTaskHeldPreparation {
  const definition = heldPreparationDefinitions.get(original);
  if (!definition) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
  withAiTaskHeldPreparationDefinition(prepare, definition);
  const window = heldPreparationWindows.get(original);
  if (window !== undefined && !heldPreparationWindows.has(prepare)) withAiTaskHeldPreparationWindow(prepare, window);
  else if (window !== undefined && heldPreparationWindows.get(prepare) !== window) throw new AiTaskRunnerError('AI_INVALID_INPUT');
  return prepare;
}

/** A fixed server composition may budget its bounded publication sequence.
 * Keep the default 5s for other hosts; callback properties/model input cannot
 * grant a window. The runner also clamps this bound to its original lease. */
export function withAiTaskHeldPreparationWindow(prepare: AiTaskHeldPreparation, maximumMs: number): AiTaskHeldPreparation {
  if (typeof prepare !== 'function' || !finiteInteger(maximumMs, 1, 120000)
    || heldPreparationWindows.has(prepare)) throw new AiTaskRunnerError('AI_INVALID_INPUT');
  heldPreparationWindows.set(prepare, maximumMs);
  return prepare;
}

export class AiTaskRunner {
  private readonly clock: AiTaskRunnerClock;

  constructor(private readonly deps: AiTaskRunnerDependencies) {
    if (!deps?.leases || !deps.steps || !deps.plan || !deps.effects
      || typeof deps.leases.claimRun !== "function" || typeof deps.leases.claimRecoveryRun !== "function"
      || typeof deps.leases.releaseRun !== "function" || typeof deps.leases.readMetadata !== "function"
      || typeof deps.steps.register !== "function" || typeof deps.steps.start !== "function"
      || typeof deps.steps.succeed !== "function" || typeof deps.steps.fail !== "function"
      || typeof deps.steps.pause !== "function" || typeof deps.steps.unknown !== "function"
      || typeof deps.plan.resolve !== "function" || typeof deps.effects.execute !== "function"
      || (deps.resources !== undefined && (typeof deps.resources.open !== 'function' || typeof deps.resources.reserve !== 'function'
        || typeof deps.resources.record !== 'function' || typeof deps.resources.markUnknown !== 'function'))
      || (deps.inputs !== undefined && typeof deps.inputs.afterSucceeded !== 'function')
      || (deps.taskOutcome !== undefined && typeof deps.taskOutcome.commit !== "function")) throw new AiTaskRunnerError("AI_RESOURCE_UNAVAILABLE");
    this.clock = deps.clock ?? defaultClock;
  }

  // Host interruption stops dispatch, not business facts, reconciliation receipts or lease cleanup.
  async run(input: AiTaskRunnerInput, signal?: AbortSignal): Promise<AiTaskRunnerOutcome> {
    return this.runInternal(input, signal);
  }

  async runPrepared(input: AiTaskRunnerInput, prepare: AiTaskHeldPreparation, signal?: AbortSignal): Promise<AiTaskRunnerOutcome> {
    if (typeof prepare !== 'function' || input.recovery) throw new AiTaskRunnerError('AI_INVALID_INPUT');
    return this.runInternal(input, signal, prepare);
  }

  /** Explicit application continuation only. Ordinary workers/recovery never
   * opt into the locked PENDING proof or borrow this host's time-debt binding. */
  async continuePending(input: AiTaskRunnerInput, signal?: AbortSignal, prepare?: AiTaskHeldPreparation): Promise<AiTaskRunnerOutcome> {
    if (input.recovery || !this.deps.resources || prepare !== undefined && typeof prepare !== 'function') throw new AiTaskRunnerError('AI_INVALID_INPUT');
    return this.runInternal(input, signal, prepare, true);
  }

  private async runInternal(input: AiTaskRunnerInput, signal?: AbortSignal, prepare?: AiTaskHeldPreparation, pendingStart = false): Promise<AiTaskRunnerOutcome> {
    if (signal?.aborted) return { status: 'unavailable', completedSteps: 0, cleanupFailed: 0 };
    input = structuredClone(input);
    const recovery = input.recovery === true;
    const { recovery: _recovery, ...claimInput } = input;
    let initial: AiTaskRunnerTaskMetadata;
    try {
      initial = structuredClone(await this.callBounded(() => this.deps.leases.readMetadata(input.taskId), 5000, 'initial_metadata', signal));
    } catch (error) {
      // No claim was attempted. Stop this host without inventing a task
      // failure, releasing somebody else's lease or starting another run.
      if (signal?.aborted || error instanceof AiTaskRunnerError && error.code === 'AI_RUN_LIMIT') {
        return { status: 'unavailable', completedSteps: 0, cleanupFailed: 0 };
      }
      throw error;
    }
    if (initial.taskId !== input.taskId) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
    if (signal?.aborted) return { status: 'unavailable', completedSteps: 0, cleanupFailed: 0 };
    if (initial.status === 'waiting_input') return { status: 'paused', completedSteps: 0, cleanupFailed: 0 };
    let lease: AiTaskRunnerLease;
    try {
      const observed = await this.callBounded(() => recovery
        ? this.deps.leases.claimRecoveryRun(structuredClone(claimInput))
        : this.deps.leases.claimRun(structuredClone(claimInput)), 5000, 'claim_run', signal);
      lease = snapshotAiTaskRunnerClaimLease(claimInput, observed);
    } catch (error) {
      // A transaction may have committed. A late acknowledgement is observed
      // by callBounded but NEVER re-enters runHeld or grants execution rights.
      // No automatic second claim or guessed lease release is safe here.
      if (error instanceof AiTaskRunnerError && ['AI_RUN_LIMIT', 'AI_RESULT_UNKNOWN'].includes(error.code)) {
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'lease claim acknowledgement is uncertain');
      }
      throw error;
    }
    return this.runHeld(input, recovery, initial, lease, signal, false, prepare, undefined, pendingStart);
  }

  async recover(lease: AiTaskRunnerRecoveryLease, signal?: AbortSignal): Promise<AiTaskRunnerOutcome> {
    if (!this.deps.resources || typeof this.deps.leases.assertRecoveryRun !== 'function' || lease?.purpose !== 'recovery_only') {
      throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
    }
    lease = structuredClone(lease);
    const initial = structuredClone(await this.callReadBounded(() => this.deps.leases.readMetadata(lease.taskId), 5000, 'recovery_metadata', signal));
    if (initial.taskId !== lease.taskId) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
    return this.runHeld({ taskId: lease.taskId, runId: lease.runId }, true, initial, lease, signal, true);
  }

  async continueConfirmation(value: AiTaskRunnerConfirmationRequest, signal?: AbortSignal): Promise<AiTaskRunnerOutcome> {
    const input = structuredClone(value);
    if (!this.deps.confirmation || !this.deps.effects.continueConfirmation || signal?.aborted) return { status: 'unavailable', completedSteps: 0, cleanupFailed: 0 };
    const initial = structuredClone(await this.callReadBounded(() => this.deps.leases.readMetadata(input.taskId), 5000, 'confirmation_metadata', signal));
    if (initial.taskId !== input.taskId || initial.taskId !== input.lease.taskId || initial.revision !== input.expectedTaskRevision || initial.status !== 'waiting_confirmation'
      || initial.cancelRequestedAt !== null) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
    let committed: Awaited<ReturnType<NonNullable<AiTaskRunnerDependencies['confirmation']>['resume']>>;
    // Both commands and acknowledgements cross asynchronous ports. Preserve
    // the original basis and holder even if their producer reuses an object.
    // Confirmation rechecks the persisted human material and current rights;
    // its finite wait must include the enclosing transaction and readbacks.
    // A timeout still leaves the original resume unknown, never a new lease.
    const observed = await this.callWriteBounded(() => this.deps.confirmation!.resume(structuredClone(input)), 15000, 'confirmation_resume', signal);
    try { committed = structuredClone(observed); }
    catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'confirmation resume acknowledgement is not snapshot-safe'); }
    if (!committed || !committed.lease || !committed.continuation
      || committed.taskRevision !== initial.revision + 1 || committed.lease.taskId !== input.taskId || committed.lease.runId !== input.lease.runId
      || committed.lease.holderId !== input.lease.holderId || committed.lease.fencingToken !== input.lease.fencingToken
      || committed.lease.expiresAt !== input.lease.expiresAt
      || committed.lease.revision !== input.lease.revision + 1 || committed.continuation.stepId !== input.stepId
      || committed.continuation.stepRevision !== input.expectedStepRevision || committed.continuation.checkpointRef !== input.checkpointRef
      || !['approved', 'rejected'].includes(committed.continuation.decision)
      || typeof committed.continuation.decisionRef !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u.test(committed.continuation.decisionRef)
      || !finiteInteger(committed.continuation.remainingActiveMs, 1, 86400000)
      || !finiteInteger(committed.continuation.remainingOutputBytes, 1, 16 * 1024 * 1024)
      || typeof committed.lease.expiresAt !== 'string' || !Number.isFinite(Date.parse(committed.lease.expiresAt))) {
      // Resume advances the original CAS; it does not renew its lease. It may
      // already be durable, so a rewritten deadline cannot authorize execution,
      // another approval consumption, a guessed outcome or releasing its holder.
      throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'confirmation resume acknowledgement requires original receipt');
    }
    const current = structuredClone(await this.callWriteBounded(() => this.deps.leases.readMetadata(input.taskId), 5000, 'confirmation_readback', signal));
    if (current.taskId !== input.taskId || current.revision !== committed.taskRevision
      || current.status !== 'running' || current.cancelRequestedAt !== null) {
      throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'confirmation state changed before continuation');
    }
    return this.runHeld({ taskId: input.taskId, runId: input.lease.runId }, false, current, committed.lease,
      signal, false, undefined, committed.continuation);
  }

  private async runHeld(input: Pick<AiTaskRunnerInput, 'taskId' | 'runId'> & Partial<Pick<AiTaskRunnerInput, 'leaseMs'>>, recovery: boolean,
    initial: AiTaskRunnerTaskMetadata, lease: AiTaskRunnerLease, signal?: AbortSignal, adoptedRecovery = false, prepare?: AiTaskHeldPreparation,
    continuation?: AiTaskRunnerConfirmationContinuation, pendingStart = false): Promise<AiTaskRunnerOutcome> {
    const heldStartedAt = this.clock.now();
    let taskRevision = initial.revision;
    let completedSteps = 0, cleanupFailed = 0, legacyCalls = 0, outputBytes = 0;
    let activeResourceTicket: AiTaskRunnerResourceTicket | undefined;
    let overheadTicket: import('./ai-task-runner.ports').AiTaskRunnerOverheadTicket | undefined;
    let overheadStartedAt = 0;
    let orchestrationAdmissionStopped = false;
    let originalTimeDebt = false;
    // Accounting admission includes current Auth, original-plan reads and several
    // local commits. Its reply guard is not a new work/lease/quota allowance.
    const overheadReplyMs = Math.min(15000, input.leaseMs ?? 15000);
    const adoptOverhead = (ticket: import('./ai-task-runner.ports').AiTaskRunnerOverheadTicket, maximumMs?: number) => {
      if (!ticket || typeof ticket.key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(ticket.key)
        || !finiteInteger(ticket.remainingMs, 1, maximumMs ?? 86400000)
        || ticket.stepAllowanceUnavailable !== undefined && ticket.stepAllowanceUnavailable !== true
        || ticket.originalTimeDebt !== undefined && ticket.originalTimeDebt !== true)
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
      originalTimeDebt ||= ticket.originalTimeDebt === true;
      overheadTicket = ticket; overheadStartedAt = this.clock.now();
    };
    const beginOverhead = async (segment: string, retainStepAllowance: boolean, maximumMs?: number) => {
      const port = this.deps.resources?.overhead;
      if (!port) return;
      if (port.rotate && (typeof port.completeAfterRelease !== 'function' || !port.includesEffectInterval
        || typeof port.remaining !== 'function')) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
      // Post-result and terminal work retain the existing admission even if new
      // execution closes. Rotate only before another new step, never to obtain
      // a fresh grant for result/accounting recovery.
      if (overheadTicket && (!port.rotate || !segment.startsWith('pre:'))) return;
      let ticket: import('./ai-task-runner.ports').AiTaskRunnerOverheadTicket;
      try {
        ticket = structuredClone(await this.callWriteBounded(() => overheadTicket && port.rotate
          ? port.rotate(structuredClone(overheadTicket), structuredClone(lease), segment, maximumMs, retainStepAllowance)
          : port.begin(structuredClone(lease), segment, maximumMs, retainStepAllowance, recovery, pendingStart),
        overheadReplyMs, 'overhead_reserve'));
      } catch (error) {
        if (error instanceof AiTaskRunnerPreReservationLimitError) orchestrationAdmissionStopped = true;
        throw error;
      }
      adoptOverhead(ticket, maximumMs);
    };
    const overheadRemainingMs = () => {
      if (!overheadTicket) return Infinity;
      const port = this.deps.resources?.overhead;
      if (port?.includesEffectInterval) {
        if (typeof port.remaining !== 'function') throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
        const remaining = port.remaining(structuredClone(overheadTicket), structuredClone(lease));
        if (!Number.isSafeInteger(remaining)) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        return remaining;
      }
      return overheadTicket.remainingMs - (this.clock.now() - overheadStartedAt);
    };
    const closeOverhead = async (deferUntilRelease = false) => {
      if (!overheadTicket || !this.deps.resources?.overhead) return;
      if (this.deps.resources.overhead.rotate || deferUntilRelease && this.deps.resources.overhead.completeAfterRelease) return;
      await this.callWriteBounded(() => this.deps.resources!.overhead!.complete(structuredClone(overheadTicket!),
        structuredClone(lease)), overheadReplyMs, 'overhead_record');
      overheadTicket = undefined;
    };
    let outcomeAttempted = false;
    let outcomeAcknowledged = false;
    let primaryUnknown: Error | undefined;
    let propagatedError: unknown;
    let settledInputFailure = false;
    const advance = (commit: AiTaskRunnerStepCommit, ref?: AiTaskRunnerStepRef) => {
      if (!commit || !finiteInteger(commit.taskRevision, taskRevision, 4294967295)
        || !commit.lease || commit.lease.taskId !== lease.taskId || commit.lease.runId !== lease.runId
        || commit.lease.holderId !== lease.holderId || commit.lease.fencingToken !== lease.fencingToken
        || commit.lease.expiresAt !== lease.expiresAt
        || !finiteInteger(commit.lease.revision, lease.revision + 1, 4294967295)
        || commit.lease.revision !== lease.revision + 1) {
        // A step/task CAS advances this run once; it does not renew its lease
        // or attest intervening mutations. Treat a changed deadline or skipped
        // revision as an uncertain receipt before adopting it for further work.
        // Every caller has already attempted a durable task/step transition.
        // Without that exact tuple we cannot release the old holder or report
        // an ordinary unavailable result and imply safe retry.
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'persistent step acknowledgement requires original receipt');
      }
      lease = structuredClone(commit.lease); taskRevision = commit.taskRevision;
      if (ref) ref.registered = { ...ref.registered, stepRevision: ref.registered.stepRevision + 1, taskRevision, runRevision: lease.revision };
    };
    const finish = async (outcome: AiTaskRunnerTaskOutcome): Promise<AiTaskRunnerOutcome> => {
      // A first PENDING action or recovered original result can be durable while
      // old Run timing remains unknowable. Preserve that result and debt without
      // fabricating a terminal aggregate. Recovery may still report unknown.
      if (originalTimeDebt && (!recovery || outcome.status !== 'unknown')) {
        await closeOverhead(true);
        return { status: 'unavailable', completedSteps, cleanupFailed, nextAction: 'manual_handoff' };
      }
      if (!this.deps.taskOutcome) { await closeOverhead(true); return outcome; }
      // Aggregate reads, CAS and their acknowledgement are active work too.
      // Terminal Run accounting closes this original interval, never reopens it.
      await beginOverhead('finish', false);
      const finishMs = () => {
        if (!overheadTicket) return 5000;
        const remaining = Math.floor(overheadRemainingMs());
        if (!Number.isSafeInteger(remaining) || remaining < 1) throw new AiTaskRunnerError('AI_RUN_LIMIT');
        return Math.min(5000, remaining);
      };
      if (outcome.status === 'unknown') {
        const current = await this.callReadBounded(() => this.deps.leases.readMetadata(input.taskId), finishMs(), 'outcome_metadata');
        if (current.status === 'waiting_external' || current.status === 'cancel_requested') {
          taskRevision = current.revision;
          await closeOverhead(true);
          return outcome;
        }
      }
      if (outcome.status !== "unknown" && outcome.status !== "paused") {
        const current = await this.callReadBounded(() => this.deps.leases.readMetadata(input.taskId), finishMs(), 'outcome_metadata');
        if (current.cancelRequestedAt !== null || current.status === "cancel_requested") {
          taskRevision = current.revision;
          outcome = { status: "cancelled", completedSteps, cleanupFailed };
        }
      }
      outcomeAttempted = true;
      const committed = await this.commitTaskOutcome(outcome, lease, taskRevision,
        (recovery || adoptedRecovery) && initial.status === 'waiting_external', finishMs());
      if (committed.resumed) advance(committed.resumed);
      advance(committed);
      outcomeAcknowledged = true;
      await closeOverhead(true);
      return committed.outcome;
    };
    try {
      if (signal?.aborted) return { status: 'unavailable', completedSteps, cleanupFailed };
      if (adoptedRecovery) await this.callReadBounded(() => this.deps.leases.assertRecoveryRun!({ ...structuredClone(lease), purpose: 'recovery_only' }), 5000, 'recovery_authority', signal);
      if (initial.status === 'waiting_input' || initial.status === 'waiting_confirmation') return { status: 'paused', completedSteps, cleanupFailed };
      if (!recovery && initial.status === 'queued') {
        if (!this.deps.taskOutcome?.start) return { status: 'unavailable', completedSteps, cleanupFailed };
        if (!prepare) validatePlan(structuredClone(await this.callReadBounded(() => this.deps.plan.resolve(structuredClone(initial), structuredClone(lease), false), 5000, 'initial_plan', signal)), input, this.deps.resources !== undefined);
        if (signal?.aborted) return { status: 'unavailable', completedSteps, cleanupFailed };
        advance(await this.callWriteBounded(() => this.deps.taskOutcome!.start!({ taskId: input.taskId, taskRevision, lease: structuredClone(lease) }), 5000, 'task_start'));
        initial = { ...initial, status: 'running', revision: taskRevision };
      }
      if (signal?.aborted) return { status: 'unavailable', completedSteps, cleanupFailed };
      if (prepare) {
        const controller = new AbortController(), abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        let ticket: import('./task-run-preparation.ports').AiTaskPreparationTicket | undefined;
        let preparationSettled = false, measurementAttempted = false;
        const resources = this.deps.resources?.preparation;
        try {
          if (signal?.aborted) abort();
          const preparationMs = Math.min(heldPreparationWindows.get(prepare) ?? 5000, input.leaseMs ?? 5000);
          // Admission reserves its accounting reply interval as well as the
          // unchanged preparation work window. Accept that same bounded reply;
          // the ticket's remainder and current lease still gate all later work.
          const preparationBudgetMs = preparationMs + 10000;
          const preparationReplyMs = Math.min(preparationBudgetMs, input.leaseMs ?? 5000);
          if (this.deps.resources) {
            if (!resources) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
            const overhead = this.deps.resources.overhead;
            if (overhead?.rotate && !resources.handoff || resources.handoff && (!overhead?.includesEffectInterval
              || typeof overhead.remaining !== 'function' || typeof overhead.rotate !== 'function'
              || typeof overhead.completeAfterRelease !== 'function')) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
            // Admission can reconcile original receipts and wait for its charge
            // COMMIT reply. That time already consumes this preparation's original
            // reservation; use the trusted hook window, not an unrelated 5s cap.
            // The returned remainder still clamps work, without changing any quota.
            ticket = structuredClone(await this.callWriteBounded(() => resources.begin(structuredClone(lease),
              heldPreparationDefinitions.get(prepare), preparationBudgetMs, controller.signal), preparationReplyMs, 'preparation_reserve'));
            if (!ticket || typeof ticket.prepared !== 'boolean' || typeof ticket.key !== 'string'
              || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,35}$/u.test(ticket.key)
              || !ticket.prepared && !finiteInteger(ticket.remainingMs, 1, preparationMs + 10000)) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
          }
          if (!ticket?.prepared) await this.callWriteBounded(async () => {
            try { await prepare({ lease: structuredClone(lease), taskRevision, signal: controller.signal }); }
            finally { preparationSettled = true; }
          }, ticket ? Math.min(preparationMs, ticket.remainingMs!) : preparationMs, 'held_prepare');
          if (ticket) {
            measurementAttempted = true;
            if (!ticket.prepared && resources?.handoff) {
              // Both original time accounts cross one transaction boundary. Its
              // COMMIT/reply and the metadata read below belong to startup, not
              // an unreserved gap after the preparation was already recorded.
              const startup = structuredClone(await this.callWriteBounded(() => resources.handoff!(structuredClone(ticket!),
                structuredClone(lease), recovery, !recovery && !continuation), overheadReplyMs, 'preparation_handoff'));
              adoptOverhead(startup);
            } else await this.callWriteBounded(() => resources!.complete(structuredClone(ticket!), structuredClone(lease)), 5000, 'preparation_record');
          }
        } catch (error) {
          // A settled local preparation can have a known time even if its SQL
          // reply is uncertain. Capture only that measurement, never grant execution.
          if (ticket && resources && preparationSettled && !measurementAttempted) {
            measurementAttempted = true;
            await this.callWriteBounded(() => resources.complete(structuredClone(ticket!), structuredClone(lease)), 5000, 'preparation_error_measurement').catch(() => {});
          }
          if (ticket && resources) await this.callWriteBounded(() => resources.abandon(structuredClone(ticket!), structuredClone(lease)), 5000, 'preparation_unknown').catch(() => {});
          throw error;
        } finally { controller.abort(); signal?.removeEventListener('abort', abort); }
        const remaining = overheadRemainingMs();
        if (remaining < 1) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
        const current = await this.callReadBounded(() => this.deps.leases.readMetadata(input.taskId), Math.min(5000, remaining), 'prepared_metadata', signal);
        if (current.taskId !== input.taskId || current.revision !== taskRevision || current.status !== 'running'
          || current.cancelRequestedAt !== null) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
        if (signal?.aborted) return { status: 'unavailable', completedSteps, cleanupFailed };
      }
      if (this.deps.resources && !this.deps.resources.overhead?.opensBudget)
        await this.callWriteBounded(() => this.deps.resources!.open(structuredClone(lease), recovery), 5000, 'resource_open');
      await beginOverhead('startup', !recovery && !continuation);
      if (signal?.aborted) return { status: 'unavailable', completedSteps, cleanupFailed };
      const plan = validatePlan(structuredClone(await this.callReadBounded(() => this.deps.plan.resolve(structuredClone(initial), structuredClone(lease), recovery), 5000, 'execution_plan', signal)), input, this.deps.resources !== undefined);
      if (continuation) {
        if (recovery || !finiteInteger(continuation.remainingActiveMs, 1, plan.limits.maxStepMs)
          || !finiteInteger(continuation.remainingOutputBytes, 1, plan.limits.maxOutputBytes)) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
        outputBytes = plan.limits.maxOutputBytes - continuation.remainingOutputBytes;
      }
      // Loading the trusted plan and opening its persistent resource gate are
      // part of this held run, not a free prefix followed by a fresh timeout.
      // Original result/charge checkpointing retains its separate bounded wait:
      // an expired work window cannot prove rollback or justify abandoning debt.
      const startedAt = heldStartedAt;
      let stepStartedAt: number | null = null;
      const workMs = () => {
        const now = this.clock.now(), elapsed = now - startedAt,
          stepElapsed = stepStartedAt === null ? 0 : now - stepStartedAt;
        if (!Number.isFinite(elapsed) || !Number.isFinite(stepElapsed) || elapsed < 0 || stepElapsed < 0)
          throw new AiTaskRunnerError('AI_RUN_LIMIT');
        const overheadRemaining = overheadRemainingMs();
        const remaining = Math.floor(Math.min(plan.limits.maxTotalMs - elapsed, plan.limits.maxStepMs - stepElapsed, overheadRemaining));
        if (remaining < 1) throw new AiTaskRunnerError('AI_RUN_LIMIT');
        return remaining;
      };
      const checkCancel = async (beforeNewWork = false) => {
        // A host abort must not skip reconciliation/checkpointing of a result
        // already persisted. This read remains bounded independently.
        const current = await this.callReadBounded(() => this.deps.leases.readMetadata(input.taskId), beforeNewWork ? workMs() : plan.limits.maxStepMs, 'cancel_metadata');
        if (current.cancelRequestedAt === null && current.status !== "cancel_requested") return false;
        taskRevision = current.revision;
        return true;
      };
      const pauseForInput = async (ref: AiTaskRunnerStepRef) => {
        if (!this.deps.inputs || await checkCancel()) return false;
        const current = { ...structuredClone(ref), registered: { ...ref.registered, taskRevision, runRevision: lease.revision } };
        const remaining = overheadTicket ? Math.floor(overheadRemainingMs()) : plan.limits.maxStepMs;
        if (!Number.isSafeInteger(remaining) || remaining < 1) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'input checkpoint outside original active window');
        const committed = structuredClone(await this.callWriteBounded(async () => {
          try { return await this.deps.inputs!.afterSucceeded(current, structuredClone(lease)); }
          catch (error) {
            // A settled callback still has its original local clock. A deadline
            // alone never proves settlement; the outer unknown gate stays closed.
            settledInputFailure = true;
            throw error;
          }
        }, Math.min(plan.limits.maxStepMs, remaining), 'input_wait'));
        if (!committed) return false;
        if ('kind' in committed) {
          if (committed.kind !== 'input_limit_reached' || Object.keys(committed).length !== 1)
            throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
          // All registered steps may have succeeded without satisfying the
          // user's goal. The existing FSM must not falsely mark that success,
          // fail a successful step or invent an unresolved external effect.
          return 'input_limit_reached' as const;
        }
        if (committed.taskRevision !== taskRevision + 1 || committed.lease?.revision !== lease.revision + 1) throw new AiTaskRunnerError('AI_STORAGE_UNAVAILABLE');
        advance(committed);
        return true;
      };
      if (plan.steps.length === 0 && await checkCancel()) {
        return this.deps.taskOutcome ? await finish({ status: "cancelled", completedSteps, cleanupFailed }) : { status: "cancel_requested", completedSteps, cleanupFailed };
      }
      for (const stepPlan of plan.steps) {
        await beginOverhead(`pre:${stepPlan.registrationRef}`, !recovery && !continuation, plan.limits.maxStepMs);
        stepStartedAt = this.clock.now();
        if (signal?.aborted) return { status: 'unavailable', completedSteps, cleanupFailed };
        workMs();
        if (!this.deps.resources && legacyCalls >= plan.limits.maxCalls) throw new AiTaskRunnerError("AI_RUN_LIMIT");
        const cancelling = await checkCancel(true);
        if (signal?.aborted) return { status: 'unavailable', completedSteps, cleanupFailed };
        if (cancelling && !recovery) return this.deps.taskOutcome ? await finish({ status: "cancelled", completedSteps, cleanupFailed }) : { status: "cancel_requested", completedSteps, cleanupFailed };
        const registered = structuredClone(await this.callWriteBounded(() => this.deps.steps.register(structuredClone(stepPlan), structuredClone(lease), recovery || continuation !== undefined), workMs(), 'step_register'));
        taskRevision = registered.taskRevision;
        if (registered.runRevision != null) lease = { ...lease, revision: registered.runRevision };
        if (signal?.aborted) return { status: 'unavailable', completedSteps, cleanupFailed };
        const ref: AiTaskRunnerStepRef = { plan: stepPlan, registered };
        if (registered.runId !== lease.runId) return { status: "unavailable", completedSteps, cleanupFailed };
        if (registered.replayed && registered.existingStatus === "succeeded") {
          // A durable business result is not proof that its resource accounting
          // committed. Recover and reconcile original receipts, never re-execute.
          if (this.deps.resources) {
            if (!this.deps.resources.recover) return { status: 'unavailable', completedSteps, cleanupFailed };
            let ticket: AiTaskRunnerResourceTicket | undefined;
            try {
              ticket = structuredClone(await this.callBounded(() => this.deps.resources!.recover!(structuredClone(ref), structuredClone(lease)), plan.limits.maxStepMs, 'resource_recover'));
              await this.callBounded(() => this.deps.resources!.record(ticket!, structuredClone(ref), structuredClone(lease), true), plan.limits.maxStepMs, 'resource_reconcile');
            } catch {
              if (ticket) await this.callBounded(() => this.deps.resources!.markUnknown(ticket!, structuredClone(lease)), plan.limits.maxStepMs, 'resource_unknown').catch(() => {});
              return { status: 'unknown', completedSteps, cleanupFailed };
            }
          }
          completedSteps++;
          const pause = await pauseForInput(ref);
          await closeOverhead(Boolean(pause));
          if (pause === 'input_limit_reached') return { status: 'unavailable', completedSteps, cleanupFailed,
            stopReason: 'input_limit_reached', nextAction: 'manual_handoff' };
          if (pause) return { status: 'paused', completedSteps, cleanupFailed };
          continue;
        }
        if (registered.replayed && registered.existingStatus === 'failed' && this.deps.resources) {
          // A failed business receipt can still have unsettled resource charges.
          // Read and settle original evidence, never emit a failed->failed event.
          if (!this.deps.resources.recover || !this.deps.effects.readInterrupted || !registered.resultRef) return { status: 'unavailable', completedSteps, cleanupFailed };
          let ticket: AiTaskRunnerResourceTicket | undefined;
          try {
            ticket = structuredClone(await this.callBounded(() => this.deps.resources!.recover!(structuredClone(ref), structuredClone(lease)), plan.limits.maxStepMs, 'resource_recover'));
            const result = boundedResult(structuredClone(await this.callBounded(signal => this.deps.effects.readInterrupted!(
              structuredClone(stepPlan), signal, structuredClone(lease)), plan.limits.maxStepMs, 'receipt_read')), plan.limits.maxOutputBytes - outputBytes);
            if (result.kind !== 'failed' || result.resultRef !== registered.resultRef) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
            await this.callBounded(() => this.deps.resources!.record(ticket!, structuredClone(ref), structuredClone(lease), true), plan.limits.maxStepMs, 'resource_reconcile');
            return await finish({ status: 'failed', errorCode: result.errorCode, completedSteps, cleanupFailed });
          } catch {
            if (ticket) await this.callBounded(() => this.deps.resources!.markUnknown(ticket!, structuredClone(lease)), plan.limits.maxStepMs, 'resource_unknown').catch(() => {});
            return { status: 'unknown', completedSteps, cleanupFailed };
          }
        }
        if (recovery && this.deps.resources && registered.replayed && registered.existingStatus === 'pending') {
          // Original admission may have committed without issuing a ticket.
          // PENDING is not non-dispatch evidence: do not start, recover a cleanup
          // ticket, settle/refund charges, or ask an effect adapter to try again.
          // Preserve the exact action/occupancy for authorized manual observation.
          if (originalTimeDebt) {
            // Pure Run timing debt is not a matching Step admission. Keep the
            // PENDING task untouched rather than attempting WAITING_EXTERNAL
            // and retaining the observer lease on that rejected transition.
            await closeOverhead(true);
            return { status: 'unavailable', completedSteps, cleanupFailed, nextAction: 'manual_handoff' };
          }
          return await finish({ status: 'unknown', completedSteps, cleanupFailed });
        }
        const reconcile = recovery && (stepPlan.operation === "external_unknown" || (registered.replayed && ['unknown', 'running'].includes(registered.existingStatus ?? '')));
        if (cancelling && !(recovery && registered.replayed && ['unknown', 'running'].includes(registered.existingStatus ?? ''))) return { status: 'cancel_requested', completedSteps, cleanupFailed };
        if (registered.replayed && registered.existingStatus === "unknown" && !reconcile) return await finish({ status: "unknown", completedSteps, cleanupFailed });
        const continuing = continuation !== undefined && !recovery && registered.replayed && registered.existingStatus === 'running'
          && registered.stepId === continuation.stepId && registered.stepRevision === continuation.stepRevision
          && stepPlan.operation === 'idempotent' && ['rental.order.commit', 'tenant.notifications.commit', 'membership.profile.commit'].includes(stepPlan.toolCode);
        if (continuation && !continuing) return { status: 'unavailable', completedSteps, cleanupFailed };
        const unstarted = registered.replayed && registered.existingStatus === 'pending' && !registered.resultRef && !recovery && !!this.deps.resources;
        if (overheadTicket?.stepAllowanceUnavailable && !recovery && !continuation && (!registered.replayed || unstarted)) {
          // Only the original authorized pending identity was persisted. Meter
          // that registration before the known limit; never reserve/start its
          // effect or falsely complete a task whose successor was not attempted.
          await closeOverhead();
          throw new AiTaskRunnerPreReservationLimitError();
        }
        if (registered.replayed && !unstarted && !continuing && !(reconcile && ['unknown', 'running'].includes(registered.existingStatus ?? ''))) return { status: "unavailable", completedSteps, cleanupFailed };
        if (recovery && (!registered.replayed || !reconcile)) return { status: 'unavailable', completedSteps, cleanupFailed };
        if (reconcile && !this.deps.effects.reconcile) return { status: "unavailable", completedSteps, cleanupFailed };
        let resourceTicket: AiTaskRunnerResourceTicket | undefined;
        if (this.deps.resources) {
          // Recovery reads original charges and never reserves a fresh allowance.
          if ((reconcile || continuing) && !this.deps.resources.recover) return { status: 'unavailable', completedSteps, cleanupFailed };
          try {
            resourceTicket = structuredClone(await this.callWriteBounded(() => reconcile || continuing
              ? this.deps.resources!.recover!(structuredClone(ref), structuredClone(lease))
              : this.deps.resources!.reserve(structuredClone(ref), structuredClone(lease)), workMs(), 'resource_reserve'));
          } catch (error) {
            if (reconcile) return { status: 'unavailable', completedSteps, cleanupFailed };
            throw error;
          }
          activeResourceTicket = resourceTicket;
        }
        if (!reconcile && !continuing) advance(await this.callWriteBounded(() => this.deps.steps.start(ref, structuredClone(lease)), workMs(), 'step_start'), ref);
        const measuredPreparation = !reconcile && !continuing && resourceTicket?.modelPending === true
          && typeof this.deps.resources?.beforeExecute === 'function' && typeof this.deps.effects.executePrepared === 'function';
        if (!reconcile && !continuing && !measuredPreparation && resourceTicket && this.deps.resources?.beforeExecute) {
          resourceTicket = structuredClone(await this.callBounded(child => this.deps.resources!.beforeExecute!(resourceTicket!, structuredClone(ref), structuredClone(lease), child), workMs(), 'model_resource_reserve', signal).catch(error => {
            if (error instanceof AiTaskRunnerError && error.code === 'AI_RUN_LIMIT') throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
            throw error;
          }));
          activeResourceTicket = resourceTicket;
        }
        if (resourceTicket?.modelPending && !measuredPreparation) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
        if (!this.deps.resources) legacyCalls++;
        // Persistent capture hands off only its exact reserved tool span. Keep
        // the original orchestration reservation through result persistence and
        // COMMIT; closing around the whole effect port would leave that suffix
        // unmeasured. Other hosts retain the old separate-interval boundary.
        if (!this.deps.resources?.overhead?.includesEffectInterval) await closeOverhead();
        let result: AiTaskRunnerEffectResult;
        try {
          // Registration/start and resource accounting can consume the remaining
          // host budget. Do not mint a fresh millisecond to start a late effect.
          // Existing interrupted-receipt handling below preserves uncertainty.
          const remaining = workMs();
          const raw = await this.callBounded(signal => continuing
            ? this.deps.effects.continueConfirmation!(structuredClone(stepPlan), signal, structuredClone(lease), structuredClone(continuation!))
            : reconcile ? this.deps.effects.reconcile!(structuredClone(stepPlan), signal, structuredClone(lease))
              : measuredPreparation ? this.deps.effects.executePrepared!(structuredClone(stepPlan), signal, structuredClone(lease), async () => {
                resourceTicket = structuredClone(await this.deps.resources!.beforeExecute!(resourceTicket!, structuredClone(ref), structuredClone(lease), signal));
                activeResourceTicket = resourceTicket;
                if (resourceTicket.modelPending) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
              }) : this.deps.effects.execute(structuredClone(stepPlan), signal, structuredClone(lease)),
          Math.min(plan.limits.maxStepMs, remaining, continuing ? continuation!.remainingActiveMs : plan.limits.maxStepMs),
          reconcile ? 'reconcile' : 'execute', signal);
          result = boundedResult(structuredClone(raw), plan.limits.maxOutputBytes - outputBytes);
          outputBytes += result.outputBytes;
        } catch (error) {
          // Idempotency does not prove an interrupted call had no effect.
          result = reconcile || stepPlan.operation !== "readonly"
            ? { kind: "unknown", resultRef: null, outputBytes: 0 }
            : { kind: "failed", errorCode: error instanceof AiTaskRunnerError ? error.code : "AI_RESOURCE_UNAVAILABLE", resultRef: null, outputBytes: 0 };
          if (this.deps.resources) {
            // A local exception is not a durable failure receipt. Read only
            // already-persisted evidence; never repeat the effect to obtain it.
            result = { kind: 'unknown', resultRef: null, outputBytes: 0 };
            if (this.deps.effects.readInterrupted) {
              try {
                result = boundedResult(structuredClone(await this.callBounded(signal => this.deps.effects.readInterrupted!(
                  structuredClone(stepPlan), signal, structuredClone(lease)), plan.limits.maxStepMs, 'receipt_read')), plan.limits.maxOutputBytes - outputBytes);
                outputBytes += result.outputBytes;
              } catch { /* unknown occupancy survives missing/revoked evidence */ }
            }
          }
        }
        try { await beginOverhead(`post:${ref.registered.stepId}`, false, plan.limits.maxStepMs); }
        catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'post-result accounting cannot be admitted'); }
        const cleanupUnavailable = !await this.cleanupStep(stepPlan, plan.limits.maxStepMs);
        if (cleanupUnavailable) {
          cleanupFailed++;
          // Preserve a durable observed outcome: cleanup is a distinct failure,
          // not permission to contradict its receipt or accounting evidence.
          if (!this.deps.resources) result = reconcile || stepPlan.operation !== "readonly"
            ? { kind: "unknown", resultRef: result.resultRef ?? null, outputBytes: result.outputBytes }
            : { kind: "failed", errorCode: "AI_STORAGE_UNAVAILABLE", resultRef: result.resultRef ?? null, outputBytes: result.outputBytes };
        }
        if (reconcile && registered.replayed && registered.existingStatus === 'unknown' && result.kind === 'unknown') {
          if (resourceTicket && this.deps.resources) await this.callBounded(() => this.deps.resources!.markUnknown(resourceTicket!, structuredClone(lease)), plan.limits.maxStepMs, 'resource_unknown');
          return await finish({ status: 'unknown', completedSteps, cleanupFailed });
        }
        if (this.deps.resources && stepPlan.operation === 'readonly' && result.kind === 'unknown') {
          // The existing step FSM does not allow NONE -> POSSIBLE. An
          // interrupted read is not evidence of an external business effect.
          // Keep its durable RUNNING step/start receipt and occupancy; only the
          // task enters WAITING_EXTERNAL. Recovery may read evidence, not repeat
          // the tool or manufacture a committed/failed step to release resources.
          if (resourceTicket) await this.callBounded(() => this.deps.resources!.markUnknown(resourceTicket!,
            structuredClone(lease)), plan.limits.maxStepMs, 'resource_unknown');
          activeResourceTicket = undefined;
          return await finish({ status: 'unknown', completedSteps, cleanupFailed });
        }
        if (this.deps.resources && !result.resultRef && result.kind !== 'paused') {
          if (resourceTicket) await this.callBounded(() => this.deps.resources!.markUnknown(resourceTicket!, structuredClone(lease)), plan.limits.maxStepMs, 'resource_unknown');
          return await finish({ status: 'unknown', completedSteps, cleanupFailed });
        }
        if (this.deps.inputs && result.kind === 'paused' && result.pause === 'input') throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
        // Cancellation advances the task revision, not the original step or fenced lease used for result CAS.
        if (await checkCancel()) ref.registered = { ...ref.registered, taskRevision };
        if (this.deps.resources && result.kind === 'paused' && result.pause === 'confirmation') {
          if (recovery || stepPlan.operation !== 'idempotent' || !result.resultRef) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
          const commit = structuredClone(await this.persistResult(ref, structuredClone(lease), result));
          if (commit?.confirmation?.checkpointRef !== result.resultRef || commit.confirmation.stepId !== ref.registered.stepId
            || commit.confirmation.stepRevision !== ref.registered.stepRevision || commit.taskRevision !== taskRevision + 1) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'confirmation checkpoint acknowledgement requires original receipt');
          // The checkpoint already committed the task pause; the step and its original charges remain open.
          advance(commit);
          activeResourceTicket = undefined;
          await closeOverhead(true);
          return { status: 'paused', completedSteps, cleanupFailed };
        }
        advance(await this.persistResult(ref, structuredClone(lease), result), ref);
        if (resourceTicket && this.deps.resources) {
          try {
            if (result.kind === 'unknown') await this.callBounded(() => this.deps.resources!.markUnknown(resourceTicket!, structuredClone(lease)), plan.limits.maxStepMs, 'resource_unknown');
            else await this.callBounded(() => this.deps.resources!.record(resourceTicket!, structuredClone(ref), structuredClone(lease), reconcile), plan.limits.maxStepMs, 'resource_record');
          } catch {
            await this.callBounded(() => this.deps.resources!.markUnknown(resourceTicket!, structuredClone(lease)), plan.limits.maxStepMs, 'resource_unknown').catch(() => {});
            // A durable step success is not a successfully accounted task.
            return { status: 'unknown', completedSteps, cleanupFailed };
          }
          activeResourceTicket = undefined;
        }
        if (result.kind === "unknown") return await finish({ status: "unknown", completedSteps, cleanupFailed });
        if (result.kind === "paused") return await finish({ status: "paused", pause: result.pause, completedSteps, cleanupFailed });
        if (result.kind === "failed") return await finish({ status: "failed", errorCode: result.errorCode, completedSteps, cleanupFailed });
        // The confirmed step and its resource receipt are now durable. This
        // continuation is not a plan-wide approval: successors register normally
        // and obtain their own confirmation, without reusing its charges.
        if (continuing) continuation = undefined;
        completedSteps++;
        // Cleanup uncertainty is local operational uncertainty. With all
        // steps successful, the existing FSM cannot claim unresolved effects.
        if (cleanupUnavailable) return { status: 'unknown', completedSteps, cleanupFailed };
        const pause = await pauseForInput(ref);
        await closeOverhead(Boolean(pause));
        if (pause === 'input_limit_reached') return { status: 'unavailable', completedSteps, cleanupFailed,
          stopReason: 'input_limit_reached', nextAction: 'manual_handoff' };
        if (pause) return { status: 'paused', completedSteps, cleanupFailed };
      }
      return await finish({ status: "succeeded", completedSteps, cleanupFailed });
    } catch (error) {
      // Cleanup must not turn an ambiguous persisted write into a plain
      // storage failure. The original request still requires reconciliation.
      if (error instanceof Error && 'code' in error && error.code === 'AI_RESULT_UNKNOWN') primaryUnknown = error;
      if (error instanceof AiTaskRunnerPreReservationLimitError && overheadTicket) {
        // The original read-only preflight proved no step/effect reservation was
        // attempted. Its completed orchestration time remains measurable; it is
        // not a reason to manufacture unknown occupancy or erase the prefix.
        if (this.deps.resources?.overhead?.rotate) {
          // The old reservation still protects a failed next admission. Finish
          // under it rather than abandoning known time then trying a fresh grant.
          try { return await finish({ status: 'failed', completedSteps, cleanupFailed, errorCode: 'AI_RUN_LIMIT' }); }
          catch { primaryUnknown = new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'limit observation accounting is uncertain'); }
        } else {
          try { await closeOverhead(); }
          catch { primaryUnknown = new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'limit observation accounting is uncertain'); }
        }
      }
      const meter = this.deps.resources?.overhead;
      const keepSettledInputTime = settledInputFailure && completedSteps > 0 && !primaryUnknown
        && !activeResourceTicket && !outcomeAttempted && meter?.includesEffectInterval === true
        && typeof meter.rotate === 'function' && typeof meter.completeAfterRelease === 'function';
      // Only this settled supervision failure may retain the original interval
      // through its exact release receipt. It grants no aggregate outcome or new
      // action; missing authority/receipt/time still fails closed in finally.
      if (overheadTicket && meter && !keepSettledInputTime) {
        // Even an interrupted local orchestration interval cannot be retried or
        // refunded from a timeout. Preserve its original occupancy and holder.
        await this.callBounded(() => this.deps.resources!.overhead!.abandon(structuredClone(overheadTicket!),
          structuredClone(lease)), 5000, 'overhead_unknown').catch(() => {});
        overheadTicket = undefined;
      }
      if (activeResourceTicket && this.deps.resources) {
        await this.callBounded(() => this.deps.resources!.markUnknown(activeResourceTicket!, structuredClone(lease)), 5000, 'resource_unknown').catch(() => {});
      }
      // A timed-out persistent operation may already have committed. Never
      // overwrite it with a guessed task failure; recover its original receipt.
      if (primaryUnknown) throw primaryUnknown;
      if (orchestrationAdmissionStopped && error instanceof AiTaskRunnerPreReservationLimitError) {
        // No quota remains even to persist a pending successor. Preserve the
        // original task/receipts for handoff rather than inventing terminal step
        // evidence, charging unmeasured work or guessing an aggregate failure.
        return { status: 'unavailable', completedSteps, cleanupFailed, nextAction: 'manual_handoff' };
      }
      if (error instanceof AiTaskRunnerError && !outcomeAttempted && error.code === "AI_RUN_LIMIT") {
        if (!this.deps.taskOutcome) throw error;
        return await finish({ status: "failed", completedSteps, cleanupFailed, errorCode: error.code });
      }
      if (error instanceof AiTaskRunnerError) return { status: "unavailable", completedSteps, cleanupFailed,
        ...(originalTimeDebt ? { nextAction: 'manual_handoff' as const } : {}) };
      propagatedError = error;
      throw error;
    } finally {
      const overhead = this.deps.resources?.overhead;
      const canRelease = !primaryUnknown && (!outcomeAttempted || outcomeAcknowledged);
      let releaseReceipt: { released: true; revision: number } | undefined;
      try {
        if (overheadTicket && overhead && (!canRelease || !overhead.completeAfterRelease)) {
          await this.callBounded(() => overhead.abandon(structuredClone(overheadTicket!),
            structuredClone(lease)), 5000, 'overhead_unknown').catch(() => {});
          overheadTicket = undefined;
        }
        // A late persistent commit can still own the original CAS revision.
        // Do not release/reclaim it from an uncertain acknowledgement.
        if (canRelease) {
          try {
            const command = { taskId: lease.taskId, runId: lease.runId, holderId: lease.holderId,
              expectedTaskRevision: taskRevision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken };
            const acknowledgement = structuredClone(await this.callBounded(() => this.deps.leases.releaseRun(structuredClone(command)), 5000, 'release_run'));
            // Release may already be durable. Only its exact original CAS receipt
            // closes this host; malformed delivery cannot undo results or justify
            // another claim, release attempt or resource refund.
            if (!acknowledgement || acknowledgement.released !== true
              || !finiteInteger(acknowledgement.revision, 1, 4294967295)
              || acknowledgement.revision !== command.expectedRunRevision + 1) {
              throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'lease release acknowledgement requires original receipt');
            }
            releaseReceipt = { released: true, revision: acknowledgement.revision };
          } catch (error) {
            if (propagatedError && error instanceof Error && 'code' in error
              && (error.code === 'AI_REVISION_CONFLICT' || error.code === 'AI_ACCESS_DENIED')) throw propagatedError;
            throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'lease release acknowledgement is uncertain');
          }
        }
        if (overheadTicket && overhead?.completeAfterRelease && releaseReceipt) {
          try {
            // Keep the already-reserved interval through the exact release reply.
            // This is original-time accounting, not a new lease or execution grant.
            await this.callWriteBounded(() => overhead.completeAfterRelease!(structuredClone(overheadTicket!),
              structuredClone(lease), structuredClone(releaseReceipt!)), overheadReplyMs, 'overhead_record');
            overheadTicket = undefined;
          } catch { throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'released Run time acknowledgement is uncertain'); }
        }
      } finally {
        if (overheadTicket && overhead) {
          const accountingLease = releaseReceipt ? { ...lease, revision: releaseReceipt.revision } : lease;
          await this.callBounded(() => overhead.abandon(structuredClone(overheadTicket!),
            structuredClone(accountingLease)), 5000, 'overhead_unknown').catch(() => {});
          overheadTicket = undefined;
        }
      }
    }
  }

  private async commitTaskOutcome(outcome: AiTaskRunnerTaskOutcome, lease: AiTaskRunnerLease, taskRevision: number, allowResume = false, maximumMs = 5000) {
    const port = this.deps.taskOutcome;
    if (!port) return { outcome, lease, taskRevision };
    let committed: Awaited<ReturnType<AiTaskRunnerOutcomePort["commit"]>>;
    try { committed = structuredClone(await this.callWriteBounded(() => port.commit({ taskId: lease.taskId,
      taskRevision, lease: { ...lease }, outcome: { ...outcome } }), maximumMs, 'task_outcome')); }
    catch { throw new AiTaskRunnerError("AI_RESULT_UNKNOWN", "task outcome commit acknowledgement is uncertain"); }
    const matchesNext = (next: { taskRevision: number; lease: AiTaskRunnerLease } | undefined,
      previous: { taskRevision: number; lease: AiTaskRunnerLease }) => next
      && finiteInteger(next.taskRevision, 1, 4294967295) && next.taskRevision === previous.taskRevision + 1
      && next.lease && next.lease.taskId === lease.taskId && next.lease.runId === lease.runId
      && next.lease.holderId === lease.holderId && next.lease.fencingToken === lease.fencingToken
      && next.lease.expiresAt === lease.expiresAt && finiteInteger(next.lease.revision, 1, 4294967295)
      && next.lease.revision === previous.lease.revision + 1;
    const original = { taskRevision, lease };
    // Recovery may close two real aggregate transitions, never accept an
    // arbitrary revision jump. Validate the whole chain before adopting either
    // tuple, so malformed delivery cannot authorize cleanup or another action.
    if (!committed || committed.resumed && (!allowResume || !['succeeded', 'failed'].includes(outcome.status)
      || !matchesNext(committed.resumed, original))
      || !matchesNext(committed, committed.resumed ?? original)) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'task outcome acknowledgement requires original receipt');
    if (committed.outcomeStatus !== undefined && !['succeeded', 'partially_succeeded', 'cancelled'].includes(committed.outcomeStatus)) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', 'task outcome observation is invalid');
    const result: AiTaskRunnerOutcome = committed.outcomeStatus
      ? { status: committed.outcomeStatus, completedSteps: outcome.completedSteps, cleanupFailed: outcome.cleanupFailed } : outcome;
    return { outcome: result, lease: committed.lease, taskRevision: committed.taskRevision,
      ...(committed.resumed ? { resumed: committed.resumed } : {}) };
  }

  private async persistResult(ref: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, result: AiTaskRunnerEffectResult): Promise<AiTaskRunnerStepCommit> {
    return this.callWriteBounded(() => {
      if (result.kind === "succeeded") return this.deps.steps.succeed(ref, lease, result.resultRef ?? null);
      if (result.kind === "failed") return this.deps.steps.fail(ref, lease, result.errorCode, result.resultRef ?? null);
      if (result.kind === "paused") return this.deps.steps.pause(ref, lease, result.pause, result.resultRef ?? null);
      return this.deps.steps.unknown(ref, lease, result.resultRef ?? null);
    }, 15000, 'step_result');
  }

  private async callReadBounded<T>(operation: () => Promise<T>, limitMs: number, phase: string, signal?: AbortSignal): Promise<T> {
    try { return await this.callBounded(operation, limitMs, phase, signal); }
    catch (error) {
      if (error instanceof AiTaskRunnerError && (error.code === 'AI_RUN_LIMIT' || error.code === 'AI_RESULT_UNKNOWN')) {
        throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE', `${phase} observation is unavailable`);
      }
      throw error;
    }
  }

  private async callWriteBounded<T>(operation: () => Promise<T>, limitMs: number, phase: string, signal?: AbortSignal): Promise<T> {
    try { return await this.callBounded(operation, limitMs, phase, signal); }
    catch (error) {
      if (['resource_reserve', 'overhead_reserve'].includes(phase) && error instanceof AiTaskRunnerPreReservationLimitError) throw error;
      if (error instanceof AiTaskRunnerError && error.code === 'AI_RUN_LIMIT') {
        throw new AiTaskRunnerError('AI_RESULT_UNKNOWN', `${phase} acknowledgement is uncertain`);
      }
      throw error;
    }
  }

  private callBounded<T>(operation: (signal: AbortSignal) => Promise<T>, limitMs: number, phase: string, signal?: AbortSignal): Promise<T> {
    return callAiTaskRunnerDependency(operation, limitMs, phase, signal, this.clock);
  }

  private async cleanupStep(step: AiTaskRunnerStepPlan, limitMs: number): Promise<boolean> {
    if (!this.deps.effects.cleanup) return true;
    try { await this.callBounded(() => this.deps.effects.cleanup!(structuredClone(step)), limitMs, "cleanup"); return true; }
    catch { return false; }
  }
}
