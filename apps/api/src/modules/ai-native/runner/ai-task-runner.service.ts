import {
  type AiTaskRunnerClock, type AiTaskRunnerDependencies, type AiTaskRunnerEffectResult,
  type AiTaskRunnerInput, type AiTaskRunnerLease, type AiTaskRunnerLimits,
  type AiTaskRunnerOutcome, type AiTaskRunnerPlan, type AiTaskRunnerStepPlan,
  type AiTaskRunnerStepCommit, type AiTaskRunnerStepRef, type AiTaskRunnerTaskOutcome,
  type AiTaskRunnerOutcomePort
} from "./ai-task-runner.ports";

export class AiTaskRunnerError extends Error {
  constructor(readonly code: "AI_INVALID_INPUT" | "AI_RESOURCE_UNAVAILABLE" | "AI_RUN_LIMIT" | "AI_RESULT_UNKNOWN" | "AI_STORAGE_UNAVAILABLE", message: string = code) {
    super(message);
    this.name = "AiTaskRunnerError";
  }
}

const defaultClock: AiTaskRunnerClock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

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

function validatePlan(plan: AiTaskRunnerPlan, input: AiTaskRunnerInput): AiTaskRunnerPlan {
  if (plan.taskId !== input.taskId || plan.runId !== input.runId || !Array.isArray(plan.steps)) {
    throw new AiTaskRunnerError("AI_RESOURCE_UNAVAILABLE", "authorized task plan is unavailable");
  }
  const limits = validateLimits(plan.limits);
  if (plan.steps.length > limits.maxSteps || plan.steps.length > limits.maxCalls) {
    throw new AiTaskRunnerError("AI_RUN_LIMIT", "task plan exceeds the persisted run limit");
  }
  for (const step of plan.steps) {
    if (!step || typeof step.registrationRef !== "string" || step.registrationRef.length < 1 || step.registrationRef.length > 191
      || typeof step.toolCode !== "string" || step.toolCode.length < 1 || step.toolCode.length > 191
      || typeof step.toolVersion !== "string" || step.toolVersion.length < 1 || step.toolVersion.length > 191
      || !["readonly", "idempotent", "external_unknown"].includes(step.operation)) {
      throw new AiTaskRunnerError("AI_RESOURCE_UNAVAILABLE", "task contains an unavailable step plan");
    }
  }
  return { ...plan, limits };
}

function boundedResult(result: AiTaskRunnerEffectResult, maxOutputBytes: number): AiTaskRunnerEffectResult {
  if (!finiteInteger(result.outputBytes, 0, maxOutputBytes)) throw new AiTaskRunnerError("AI_RUN_LIMIT", "step output exceeds the trusted bound");
  if (result.resultRef !== undefined && result.resultRef !== null
    && (typeof result.resultRef !== "string" || result.resultRef.length < 1 || result.resultRef.length > 191)) {
    throw new AiTaskRunnerError("AI_RESOURCE_UNAVAILABLE", "step result reference is unavailable");
  }
  return result;
}

/**
 * C04 orchestration only. Persistent state transitions stay in the existing task/step
 * repositories supplied through the ports; this class does not define a second state machine.
 */
export class AiTaskRunner {
  private readonly clock: AiTaskRunnerClock;

  constructor(private readonly deps: AiTaskRunnerDependencies) {
    if (!deps?.leases || !deps.steps || !deps.plan || !deps.effects
      || typeof deps.leases.claimRun !== "function" || typeof deps.leases.claimRecoveryRun !== "function"
      || typeof deps.leases.releaseRun !== "function" || typeof deps.leases.readMetadata !== "function"
      || typeof deps.steps.register !== "function" || typeof deps.steps.start !== "function"
      || typeof deps.steps.succeed !== "function" || typeof deps.steps.fail !== "function"
      || typeof deps.steps.pause !== "function" || typeof deps.steps.unknown !== "function"
      || typeof deps.plan.resolve !== "function" || typeof deps.effects.execute !== "function") {
      throw new AiTaskRunnerError("AI_RESOURCE_UNAVAILABLE", "runner dependencies are not fully assembled");
    }
    this.clock = deps.clock ?? defaultClock;
  }

  async run(input: AiTaskRunnerInput): Promise<AiTaskRunnerOutcome> {
    const recovery = input.recovery === true;
    const { recovery: _recovery, ...claimInput } = input;
    const initial = await this.deps.leases.readMetadata(input.taskId);
    let lease = recovery ? await this.deps.leases.claimRecoveryRun(claimInput) : await this.deps.leases.claimRun(claimInput);
    let plan: AiTaskRunnerPlan;
    try {
      plan = validatePlan(await this.deps.plan.resolve(initial, lease, recovery), input);
    } catch (error) {
      try {
        await this.deps.leases.releaseRun({ taskId: lease.taskId, runId: lease.runId, holderId: lease.holderId,
          expectedTaskRevision: initial.revision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken });
      } catch { /* the lease remains recoverable; do not redispatch */ }
      throw error;
    }
    let taskRevision = initial.revision;
    const startedAt = this.clock.now();
    let completedSteps = 0, cleanupFailed = 0, calls = 0;
    try {
      if (plan.steps.length === 0) {
        const beforeFirstStep = await this.deps.leases.readMetadata(input.taskId);
        if (beforeFirstStep.cancelRequestedAt !== null || beforeFirstStep.status === "cancel_requested") {
          if (this.deps.taskOutcome) return (await this.commitTaskOutcome({ status: "cancelled", completedSteps, cleanupFailed }, lease, taskRevision)).outcome;
          return { status: "cancel_requested", completedSteps, cleanupFailed };
        }
      }
      for (const stepPlan of plan.steps) {
        if (this.clock.now() - startedAt >= plan.limits.maxTotalMs) throw new AiTaskRunnerError("AI_RUN_LIMIT", "task deadline exceeded");
        const current = await this.deps.leases.readMetadata(input.taskId);
        if (current.cancelRequestedAt !== null || current.status === "cancel_requested") {
          if (this.deps.taskOutcome) {
            return (await this.commitTaskOutcome({ status: "cancelled", completedSteps, cleanupFailed }, lease, taskRevision)).outcome;
          }
          return { status: "cancel_requested", completedSteps, cleanupFailed };
        }
        if (calls >= plan.limits.maxCalls) throw new AiTaskRunnerError("AI_RUN_LIMIT", "run call limit exceeded");

        const registered = await this.deps.steps.register(stepPlan, lease);
        taskRevision = registered.taskRevision;
        if (registered.runRevision != null) lease = { ...lease, revision: registered.runRevision };
        const ref: AiTaskRunnerStepRef = { plan: stepPlan, registered };
        if (registered.replayed) {
          if (registered.existingStatus === "unknown") return { status: "unknown", completedSteps, cleanupFailed };
          if (registered.existingStatus === "succeeded") { completedSteps += 1; continue; }
          // A replay without a persisted terminal projection is never permission to invoke again.
          return { status: "unavailable", completedSteps, cleanupFailed };
        }

        if (recovery && stepPlan.operation === "external_unknown") {
          if (!this.deps.effects.reconcile) return { status: "unavailable", completedSteps, cleanupFailed };
          if (calls >= plan.limits.maxCalls) throw new AiTaskRunnerError("AI_RUN_LIMIT", "run call limit exceeded");
          calls += 1;
          const result = await this.callBounded(signal => this.deps.effects.reconcile!(stepPlan, signal), plan.limits.maxStepMs, "reconcile");
          const safe = boundedResult(result, plan.limits.maxOutputBytes);
          if (!await this.cleanupStep(stepPlan, plan.limits.maxStepMs)) {
            cleanupFailed += 1;
            const commit = await this.deps.steps.unknown({ plan: stepPlan, registered }, lease, safe.resultRef ?? null); lease = commit.lease; taskRevision = commit.taskRevision; return { status: "unknown", completedSteps, cleanupFailed };
          }
          const commit = await this.persistResult(ref, lease, safe);
          lease = commit.lease; taskRevision = commit.taskRevision;
          if (safe.kind === "unknown") return (await this.commitTaskOutcome({ status: "unknown", completedSteps, cleanupFailed }, lease, taskRevision)).outcome;
          if (safe.kind === "paused") return (await this.commitTaskOutcome({ status: "paused", pause: safe.pause, completedSteps, cleanupFailed }, lease, taskRevision)).outcome;
          if (safe.kind === "failed") return (await this.commitTaskOutcome({ status: "failed", completedSteps, cleanupFailed, errorCode: safe.errorCode }, lease, taskRevision)).outcome;
          completedSteps += safe.kind === "succeeded" ? 1 : 0;
          continue;
        }

        const started = await this.deps.steps.start(ref, lease);
        lease = started.lease;
        taskRevision = started.taskRevision;
        calls += 1;
        let result: AiTaskRunnerEffectResult;
        try {
          const remaining = Math.max(1, plan.limits.maxTotalMs - (this.clock.now() - startedAt));
          result = boundedResult(await this.callBounded(signal => this.deps.effects.execute(stepPlan, signal), Math.min(plan.limits.maxStepMs, remaining), "execute"), plan.limits.maxOutputBytes);
        } catch (error) {
          const cleaned = await this.cleanupStep(stepPlan, plan.limits.maxStepMs);
          if (!cleaned) cleanupFailed += 1;
          if (!cleaned && stepPlan.operation !== "readonly") {
            const commit = await this.deps.steps.unknown(ref, lease, null);
            lease = commit.lease; taskRevision = commit.taskRevision;
            return { status: "unknown", completedSteps, cleanupFailed };
          }
          if (stepPlan.operation === "external_unknown") {
            const commit = await this.deps.steps.unknown(ref, lease, null);
            lease = commit.lease; taskRevision = commit.taskRevision;
            return { status: "unknown", completedSteps, cleanupFailed };
          }
          const code = error instanceof AiTaskRunnerError ? error.code : "AI_RESOURCE_UNAVAILABLE";
          const commit = await this.deps.steps.fail(ref, lease, code, null);
          lease = commit.lease; taskRevision = commit.taskRevision;
          return { status: "failed", completedSteps, cleanupFailed, errorCode: code };
        }
        const cleaned = await this.cleanupStep(stepPlan, plan.limits.maxStepMs);
        if (!cleaned) {
          cleanupFailed += 1;
          if (stepPlan.operation !== "readonly") {
            const commit = await this.deps.steps.unknown(ref, lease, result.resultRef ?? null);
            lease = commit.lease; taskRevision = commit.taskRevision;
            return { status: "unknown", completedSteps, cleanupFailed };
          }
          result = { kind: "failed", errorCode: "AI_STORAGE_UNAVAILABLE", resultRef: result.resultRef ?? null, outputBytes: result.outputBytes };
        }
        const commit = await this.persistResult(ref, lease, result);
        lease = commit.lease; taskRevision = commit.taskRevision;
        if (result.kind === "unknown") return (await this.commitTaskOutcome({ status: "unknown", completedSteps, cleanupFailed }, lease, taskRevision)).outcome;
        if (result.kind === "paused") return (await this.commitTaskOutcome({ status: "paused", pause: result.pause, completedSteps, cleanupFailed }, lease, taskRevision)).outcome;
        if (result.kind === "failed") return (await this.commitTaskOutcome({ status: "failed", completedSteps, cleanupFailed, errorCode: result.errorCode }, lease, taskRevision)).outcome;
        completedSteps += result.kind === "succeeded" ? 1 : 0;
      }
      return (await this.commitTaskOutcome({ status: "succeeded", completedSteps, cleanupFailed }, lease, taskRevision)).outcome;
    } catch (error) {
      if (error instanceof AiTaskRunnerError && (error.code === "AI_RESULT_UNKNOWN" || error.code === "AI_RUN_LIMIT")) {
        return (await this.commitTaskOutcome({ status: "failed", completedSteps, cleanupFailed, errorCode: error.code }, lease, taskRevision)).outcome;
      }
      if (error instanceof AiTaskRunnerError) return { status: "unavailable", completedSteps, cleanupFailed };
      throw error;
    } finally {
      // Release is CAS/fenced by the existing repository. A failed release is not hidden.
      try {
        await this.deps.leases.releaseRun({ taskId: lease.taskId, runId: lease.runId, holderId: lease.holderId,
          expectedTaskRevision: taskRevision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken });
      } catch { throw new AiTaskRunnerError("AI_STORAGE_UNAVAILABLE", "lease release acknowledgement is uncertain"); }
    }
  }

  private async commitTaskOutcome(outcome: AiTaskRunnerTaskOutcome, lease: AiTaskRunnerLease, taskRevision: number) {
    const port = this.deps.taskOutcome;
    if (!port) return { outcome, lease, taskRevision };
    let committed: Awaited<ReturnType<AiTaskRunnerOutcomePort["commit"]>>;
    try { committed = await port.commit({ taskId: lease.taskId, taskRevision, lease: { ...lease }, outcome: { ...outcome } }); }
    catch { throw new AiTaskRunnerError("AI_STORAGE_UNAVAILABLE", "task outcome commit is unavailable"); }
    if (!committed || !Number.isSafeInteger(committed.taskRevision) || committed.taskRevision <= taskRevision
      || !committed.lease || committed.lease.taskId !== lease.taskId || committed.lease.runId !== lease.runId
      || committed.lease.holderId !== lease.holderId || !Number.isSafeInteger(committed.lease.revision)
      || committed.lease.revision <= lease.revision || typeof committed.lease.fencingToken !== "string") {
      throw new AiTaskRunnerError("AI_STORAGE_UNAVAILABLE", "task outcome commit returned an invalid fence");
    }
    return { outcome, lease: committed.lease, taskRevision: committed.taskRevision };
  }

  private async persistResult(ref: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, result: AiTaskRunnerEffectResult): Promise<AiTaskRunnerStepCommit> {
    if (result.kind === "succeeded") return this.deps.steps.succeed(ref, lease, result.resultRef ?? null);
    if (result.kind === "failed") return this.deps.steps.fail(ref, lease, result.errorCode, result.resultRef ?? null);
    if (result.kind === "paused") return this.deps.steps.pause(ref, lease, result.pause, result.resultRef ?? null);
    return this.deps.steps.unknown(ref, lease, result.resultRef ?? null);
  }

  private callBounded<T>(operation: (signal: AbortSignal) => Promise<T>, limitMs: number, phase: string): Promise<T> {
    const controller = new AbortController();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = this.clock.setTimeout(() => {
        controller.abort();
        settled = true;
        reject(new AiTaskRunnerError(phase === "reconcile" ? "AI_RESULT_UNKNOWN" : "AI_RUN_LIMIT", `${phase} deadline exceeded`));
      }, limitMs);
      let pending: Promise<T>;
      try { pending = operation(controller.signal); }
      catch (error) { settled = true; this.clock.clearTimeout(timer); reject(error); return; }
      pending.then(value => { if (!settled) { settled = true; this.clock.clearTimeout(timer); resolve(value); } }, error => {
        if (!settled) { settled = true; this.clock.clearTimeout(timer); reject(error); }
      });
    });
  }

  private async cleanupStep(step: AiTaskRunnerStepPlan, limitMs: number): Promise<boolean> {
    if (!this.deps.effects.cleanup) return true;
    try {
      await this.callBounded(() => this.deps.effects.cleanup!(step), limitMs, "cleanup");
      return true;
    } catch { return false; }
  }
}
