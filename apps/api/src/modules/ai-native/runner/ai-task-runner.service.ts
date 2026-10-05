import {
  type AiTaskRunnerClock, type AiTaskRunnerDependencies, type AiTaskRunnerEffectResult,
  type AiTaskRunnerInput, type AiTaskRunnerLease, type AiTaskRunnerLimits,
  type AiTaskRunnerOutcome, type AiTaskRunnerPlan, type AiTaskRunnerStepPlan,
  type AiTaskRunnerStepCommit, type AiTaskRunnerStepRef, type AiTaskRunnerTaskOutcome,
  type AiTaskRunnerOutcomePort, type AiTaskRunnerResourceTicket
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
  if (!plan || plan.taskId !== input.taskId || plan.runId !== input.runId || !Array.isArray(plan.steps)) {
    throw new AiTaskRunnerError("AI_RESOURCE_UNAVAILABLE", "authorized task plan is unavailable");
  }
  const limits = validateLimits(plan.limits);
  if (plan.steps.length > limits.maxSteps || plan.steps.length > limits.maxCalls) throw new AiTaskRunnerError("AI_RUN_LIMIT");
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
      || (deps.taskOutcome !== undefined && typeof deps.taskOutcome.commit !== "function")) throw new AiTaskRunnerError("AI_RESOURCE_UNAVAILABLE");
    this.clock = deps.clock ?? defaultClock;
  }

  async run(input: AiTaskRunnerInput): Promise<AiTaskRunnerOutcome> {
    input = structuredClone(input);
    const recovery = input.recovery === true;
    const { recovery: _recovery, ...claimInput } = input;
    const initial = structuredClone(await this.deps.leases.readMetadata(input.taskId));
    let lease = structuredClone(recovery ? await this.deps.leases.claimRecoveryRun(claimInput) : await this.deps.leases.claimRun(claimInput));
    let taskRevision = initial.revision;
    let completedSteps = 0, cleanupFailed = 0, calls = 0, outputBytes = 0;
    let activeResourceTicket: AiTaskRunnerResourceTicket | undefined;
    let outcomeAttempted = false;
    const advance = (commit: AiTaskRunnerStepCommit, ref?: AiTaskRunnerStepRef) => {
      if (!commit || !finiteInteger(commit.taskRevision, taskRevision, 4294967295)
        || !commit.lease || commit.lease.taskId !== lease.taskId || commit.lease.runId !== lease.runId
        || commit.lease.holderId !== lease.holderId || commit.lease.fencingToken !== lease.fencingToken
        || !finiteInteger(commit.lease.revision, lease.revision + 1, 4294967295)) throw new AiTaskRunnerError("AI_STORAGE_UNAVAILABLE");
      lease = structuredClone(commit.lease); taskRevision = commit.taskRevision;
      if (ref) ref.registered = { ...ref.registered, stepRevision: ref.registered.stepRevision + 1, taskRevision, runRevision: lease.revision };
    };
    const finish = async (outcome: AiTaskRunnerTaskOutcome): Promise<AiTaskRunnerOutcome> => {
      if (!this.deps.taskOutcome) return outcome;
      if (outcome.status === 'unknown') {
        const current = await this.deps.leases.readMetadata(input.taskId);
        if (current.status === 'waiting_external' || current.status === 'cancel_requested') {
          taskRevision = current.revision;
          return outcome;
        }
      }
      if (outcome.status !== "unknown" && outcome.status !== "paused") {
        const current = await this.deps.leases.readMetadata(input.taskId);
        if (current.cancelRequestedAt !== null || current.status === "cancel_requested") {
          taskRevision = current.revision;
          outcome = { status: "cancelled", completedSteps, cleanupFailed };
        }
      }
      outcomeAttempted = true;
      const committed = await this.commitTaskOutcome(outcome, lease, taskRevision);
      advance(committed);
      return committed.outcome;
    };
    try {
      if (this.deps.resources) await this.callBounded(() => this.deps.resources!.open(structuredClone(lease), recovery), 5000, 'resource_open');
      const plan = validatePlan(structuredClone(await this.deps.plan.resolve(structuredClone(initial), structuredClone(lease), recovery)), input);
      const startedAt = this.clock.now();
      const checkCancel = async () => {
        const current = await this.deps.leases.readMetadata(input.taskId);
        if (current.cancelRequestedAt === null && current.status !== "cancel_requested") return false;
        taskRevision = current.revision;
        return true;
      };
      if (plan.steps.length === 0 && await checkCancel()) {
        return this.deps.taskOutcome ? await finish({ status: "cancelled", completedSteps, cleanupFailed }) : { status: "cancel_requested", completedSteps, cleanupFailed };
      }
      for (const stepPlan of plan.steps) {
        if (this.clock.now() - startedAt >= plan.limits.maxTotalMs || calls >= plan.limits.maxCalls) throw new AiTaskRunnerError("AI_RUN_LIMIT");
        const cancelling = await checkCancel();
        if (cancelling && !recovery) return this.deps.taskOutcome ? await finish({ status: "cancelled", completedSteps, cleanupFailed }) : { status: "cancel_requested", completedSteps, cleanupFailed };
        const registered = structuredClone(await this.deps.steps.register(structuredClone(stepPlan), structuredClone(lease)));
        taskRevision = registered.taskRevision;
        if (registered.runRevision != null) lease = { ...lease, revision: registered.runRevision };
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
          completedSteps++; continue;
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
        const reconcile = recovery && (stepPlan.operation === "external_unknown" || (registered.replayed && ['unknown', 'running'].includes(registered.existingStatus ?? '')));
        if (cancelling && !(recovery && registered.replayed && ['unknown', 'running'].includes(registered.existingStatus ?? ''))) return { status: 'cancel_requested', completedSteps, cleanupFailed };
        if (registered.replayed && registered.existingStatus === "unknown" && !reconcile) return await finish({ status: "unknown", completedSteps, cleanupFailed });
        if (registered.replayed && !(reconcile && ['unknown', 'running'].includes(registered.existingStatus ?? ''))) return { status: "unavailable", completedSteps, cleanupFailed };
        if (reconcile && !this.deps.effects.reconcile) return { status: "unavailable", completedSteps, cleanupFailed };
        let resourceTicket: AiTaskRunnerResourceTicket | undefined;
        if (this.deps.resources) {
          // Recovery reads original charges and never reserves a fresh allowance.
          if (reconcile && !this.deps.resources.recover) return { status: 'unavailable', completedSteps, cleanupFailed };
          try {
            resourceTicket = structuredClone(await this.callBounded(() => reconcile
              ? this.deps.resources!.recover!(structuredClone(ref), structuredClone(lease))
              : this.deps.resources!.reserve(structuredClone(ref), structuredClone(lease)), plan.limits.maxStepMs, 'resource_reserve'));
          } catch (error) {
            if (reconcile) return { status: 'unavailable', completedSteps, cleanupFailed };
            throw error;
          }
          activeResourceTicket = resourceTicket;
        }
        if (!reconcile) advance(await this.deps.steps.start(ref, structuredClone(lease)), ref);
        if (!reconcile && resourceTicket && this.deps.resources?.beforeExecute) {
          resourceTicket = structuredClone(await this.callBounded(() => this.deps.resources!.beforeExecute!(resourceTicket!, structuredClone(ref), structuredClone(lease)), plan.limits.maxStepMs, 'model_resource_reserve'));
          activeResourceTicket = resourceTicket;
        }
        if (resourceTicket?.modelPending) throw new AiTaskRunnerError('AI_RESOURCE_UNAVAILABLE');
        calls++;
        let result: AiTaskRunnerEffectResult;
        try {
          const remaining = Math.max(1, plan.limits.maxTotalMs - (this.clock.now() - startedAt));
          const raw = await this.callBounded(signal => reconcile
            ? this.deps.effects.reconcile!(structuredClone(stepPlan), signal, structuredClone(lease))
            : this.deps.effects.execute(structuredClone(stepPlan), signal, structuredClone(lease)), Math.min(plan.limits.maxStepMs, remaining), reconcile ? "reconcile" : "execute");
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
        if (this.deps.resources && !result.resultRef && result.kind !== 'paused') {
          if (resourceTicket) await this.callBounded(() => this.deps.resources!.markUnknown(resourceTicket!, structuredClone(lease)), plan.limits.maxStepMs, 'resource_unknown');
          return await finish({ status: 'unknown', completedSteps, cleanupFailed });
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
        completedSteps++;
        // Cleanup uncertainty is local operational uncertainty. With all
        // steps successful, the existing FSM cannot claim unresolved effects.
        if (cleanupUnavailable) return { status: 'unknown', completedSteps, cleanupFailed };
      }
      return await finish({ status: "succeeded", completedSteps, cleanupFailed });
    } catch (error) {
      if (activeResourceTicket && this.deps.resources) {
        await this.callBounded(() => this.deps.resources!.markUnknown(activeResourceTicket!, structuredClone(lease)), 5000, 'resource_unknown').catch(() => {});
      }
      if (error instanceof AiTaskRunnerError && !outcomeAttempted && (error.code === "AI_RESULT_UNKNOWN" || error.code === "AI_RUN_LIMIT")) {
        if (!this.deps.taskOutcome) throw error;
        return await finish({ status: "failed", completedSteps, cleanupFailed, errorCode: error.code });
      }
      if (error instanceof AiTaskRunnerError) return { status: "unavailable", completedSteps, cleanupFailed };
      throw error;
    } finally {
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
    try { committed = structuredClone(await port.commit({ taskId: lease.taskId, taskRevision, lease: { ...lease }, outcome: { ...outcome } })); }
    catch { throw new AiTaskRunnerError("AI_STORAGE_UNAVAILABLE", "task outcome commit is unavailable"); }
    if (!committed || !Number.isSafeInteger(committed.taskRevision) || committed.taskRevision <= taskRevision
      || !committed.lease || committed.lease.taskId !== lease.taskId || committed.lease.runId !== lease.runId
      || committed.lease.holderId !== lease.holderId || !Number.isSafeInteger(committed.lease.revision)
      || committed.lease.revision <= lease.revision || committed.lease.fencingToken !== lease.fencingToken) throw new AiTaskRunnerError("AI_STORAGE_UNAVAILABLE");
    if (committed.outcomeStatus !== undefined && !['succeeded', 'partially_succeeded', 'cancelled'].includes(committed.outcomeStatus)) throw new AiTaskRunnerError('AI_STORAGE_UNAVAILABLE');
    const result: AiTaskRunnerOutcome = committed.outcomeStatus
      ? { status: committed.outcomeStatus, completedSteps: outcome.completedSteps, cleanupFailed: outcome.cleanupFailed } : outcome;
    return { outcome: result, lease: committed.lease, taskRevision: committed.taskRevision };
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
        settled = true;
        controller.abort();
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
    try { await this.callBounded(() => this.deps.effects.cleanup!(structuredClone(step)), limitMs, "cleanup"); return true; }
    catch { return false; }
  }
}
