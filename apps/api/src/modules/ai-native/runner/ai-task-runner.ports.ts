import type { AiTaskStatusDraft, AiStepStatusDraft, AiTaskRunnerOutcomeDraft } from "@rental-os/shared";
import type { Prisma } from '@prisma/client';

export type AiTaskRunnerObservedResult =
  | { kind: 'succeeded' | 'failed' | 'unknown'; payload: Prisma.InputJsonValue; errorCode?: string }
  | { kind: 'paused'; pause: 'confirmation'; payload: Prisma.InputJsonValue };

/** C04 runtime input. Revisions and fencing values come from the persisted caller, not a model. */
export interface AiTaskRunnerClaimInput {
  taskId: string;
  runId: string;
  holderId: string;
  expectedTaskRevision: number;
  expectedRunRevision: number;
  expectedFencingToken: string;
  leaseMs: number;
}

export interface AiTaskRunnerLease {
  taskId: string;
  runId: string;
  holderId: string;
  revision: number;
  fencingToken: string;
  expiresAt: string;
}

export interface AiTaskRunnerRecoveryLease extends AiTaskRunnerLease {
  purpose: 'recovery_only';
}

export interface AiTaskRunnerTaskMetadata {
  taskId: string;
  status: AiTaskStatusDraft;
  revision: number;
  cancelRequestedAt: string | null;
}

export type AiTaskRunnerOperation = "readonly" | "idempotent" | "external_unknown";
export type AiTaskRunnerPause = "input" | "confirmation" | "external";

export interface AiTaskRunnerLimits {
  maxSteps: number;
  maxTotalMs: number;
  maxStepMs: number;
  maxOutputBytes: number;
  maxConcurrent: number;
  /** Persistent model invocation ceiling; business steps use maxSteps. The
   * durable resource gate must reserve each call before Gateway dispatch. */
  maxCalls: number;
}

export interface AiTaskRunnerStepPlan {
  registrationRef: string;
  operation: AiTaskRunnerOperation;
  /** The server-side action plan decides this; the runner never resolves arbitrary tool names. */
  toolCode: string;
  toolVersion: string;
}

export interface AiTaskRunnerPlan {
  taskId: string;
  runId: string;
  taskRevision: number;
  steps: readonly AiTaskRunnerStepPlan[];
  limits: AiTaskRunnerLimits;
}

export interface AiTaskRunnerRegisteredStep {
  stepId: string;
  runId: string;
  sequence: number;
  stepRevision: number;
  taskRevision: number;
  /** A replay is metadata only. It never grants permission to invoke the effect again. */
  runRevision?: number | null;
  replayed: boolean;
  existingStatus: AiStepStatusDraft | null;
  resultRef?: string | null;
}

export interface AiTaskRunnerConfirmationContinuation {
  checkpointRef: string;
  stepId: string;
  stepRevision: number;
  decisionRef: string;
  decision: 'approved' | 'rejected';
  remainingActiveMs: number;
  remainingOutputBytes: number;
}

export interface AiTaskRunnerConfirmationRequest {
  taskId: string;
  stepId: string;
  expectedTaskRevision: number;
  expectedStepRevision: number;
  checkpointRef: string;
  lease: AiTaskRunnerLease;
}

export interface AiTaskRunnerConfirmationPort {
  resume(input: AiTaskRunnerConfirmationRequest): Promise<AiTaskRunnerStepCommit & { continuation: AiTaskRunnerConfirmationContinuation }>;
}

export interface AiTaskRunnerStepCommit {
  lease: AiTaskRunnerLease;
  taskRevision: number;
  confirmation?: { stepId: string; stepRevision: number; checkpointRef: string };
}

export interface AiTaskRunnerStepRef {
  plan: AiTaskRunnerStepPlan;
  registered: AiTaskRunnerRegisteredStep;
}

export type AiTaskRunnerEffectResult =
  | { kind: "succeeded"; resultRef: string | null; outputBytes: number }
  | { kind: "failed"; errorCode: string; resultRef?: string | null; outputBytes: number }
  | { kind: "paused"; pause: AiTaskRunnerPause; resultRef?: string | null; outputBytes: number }
  | { kind: "unknown"; resultRef?: string | null; outputBytes: number };

export interface AiTaskRunnerLeasePort {
  readMetadata(taskId: string): Promise<AiTaskRunnerTaskMetadata>;
  claimRun(input: AiTaskRunnerClaimInput): Promise<AiTaskRunnerLease>;
  claimRecoveryRun(input: AiTaskRunnerClaimInput): Promise<AiTaskRunnerLease & { purpose: "recovery_only" }>;
  assertRecoveryRun?(lease: AiTaskRunnerRecoveryLease): Promise<void>;
  releaseRun(input: Omit<AiTaskRunnerClaimInput, "leaseMs" | "expectedTaskRevision" | "expectedRunRevision" | "expectedFencingToken"> & {
    expectedTaskRevision: number;
    expectedRunRevision: number;
    expectedFencingToken: string;
  }): Promise<{ released: true; revision: number }>;
}

/**
 * This adapter is implemented by the existing registration/transition repositories.
 * It receives already-authorized evidence and never manufactures a state transition.
 */
export interface AiTaskRunnerStepPort {
  register(plan: AiTaskRunnerStepPlan, lease: AiTaskRunnerLease, existingOnly?: boolean): Promise<AiTaskRunnerRegisteredStep>;
  start(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<AiTaskRunnerStepCommit>;
  succeed(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, resultRef: string | null): Promise<AiTaskRunnerStepCommit>;
  fail(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, errorCode: string, resultRef: string | null): Promise<AiTaskRunnerStepCommit>;
  pause(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, pause: AiTaskRunnerPause, resultRef: string | null): Promise<AiTaskRunnerStepCommit>;
  unknown(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, resultRef: string | null): Promise<AiTaskRunnerStepCommit>;
}

export interface AiTaskRunnerPlanPort {
  resolve(task: AiTaskRunnerTaskMetadata, lease: AiTaskRunnerLease, recovery: boolean): Promise<AiTaskRunnerPlan>;
}

/** Gateway/Tool adapters live outside this module. No provider SDK or URL is accepted here. */
export interface AiTaskRunnerEffectPort {
  execute(step: AiTaskRunnerStepPlan, signal: AbortSignal, lease?: AiTaskRunnerLease): Promise<AiTaskRunnerEffectResult>;
  /** Runs preparation inside the original durable measured marker, before the
   * registered effect. Interruption preserves that marker and never retries. */
  executePrepared?(step: AiTaskRunnerStepPlan, signal: AbortSignal, lease: AiTaskRunnerLease,
    prepare: () => Promise<void>): Promise<AiTaskRunnerEffectResult>;
  continueConfirmation?(step: AiTaskRunnerStepPlan, signal: AbortSignal, lease: AiTaskRunnerLease,
    continuation: AiTaskRunnerConfirmationContinuation): Promise<AiTaskRunnerEffectResult>;
  reconcile?(step: AiTaskRunnerStepPlan, signal: AbortSignal, lease?: AiTaskRunnerLease): Promise<AiTaskRunnerEffectResult>;
  /** Persistence-only receipt read after interruption. Must never invoke the
   * effect or query a provider; absence keeps the interrupted step unresolved. */
  readInterrupted?(step: AiTaskRunnerStepPlan, signal: AbortSignal, lease: AiTaskRunnerLease): Promise<AiTaskRunnerEffectResult>;
  cleanup?(step: AiTaskRunnerStepPlan): Promise<void>;
}

export type AiTaskRunnerTaskOutcome =
  | { status: "succeeded" | "unknown" | "cancelled"; completedSteps: number; cleanupFailed: number }
  | { status: "paused"; pause: AiTaskRunnerPause; completedSteps: number; cleanupFailed: number }
  | { status: "failed"; completedSteps: number; cleanupFailed: number; errorCode: string };

/** Task aggregate transition is supplied by the composition root. The runner
 * only reports a durable step outcome; it never implements task transitions. */
export interface AiTaskRunnerOutcomePort {
  start?(input: { taskId: string; taskRevision: number; lease: AiTaskRunnerLease }): Promise<AiTaskRunnerStepCommit>;
  commit(input: {
    taskId: string;
    taskRevision: number;
    lease: AiTaskRunnerLease;
    outcome: AiTaskRunnerTaskOutcome;
  }): Promise<{ taskRevision: number; lease: AiTaskRunnerLease; outcomeStatus?: 'succeeded' | 'partially_succeeded' | 'cancelled';
    /** Original waiting-external -> running acknowledgement, when recovery's
     * aggregate completion required two CAS transitions. Never a skipped revision. */
    resumed?: AiTaskRunnerStepCommit }>;
}

export interface AiTaskRunnerClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AiTaskRunnerInputPort {
  /** input_limit_reached attests no new question/transition was written. */
  afterSucceeded(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<AiTaskRunnerStepCommit | { kind: 'input_limit_reached' } | null>;
}

export interface AiTaskRunnerDependencies {
  leases: AiTaskRunnerLeasePort;
  steps: AiTaskRunnerStepPort;
  plan: AiTaskRunnerPlanPort;
  effects: AiTaskRunnerEffectPort;
  taskOutcome?: AiTaskRunnerOutcomePort;
  inputs?: AiTaskRunnerInputPort;
  confirmation?: AiTaskRunnerConfirmationPort;
  clock?: AiTaskRunnerClock;
  /** Required by the persistent composition; absent only for legacy isolated runner consumers. */
  resources?: AiTaskRunnerResourcePort;
}

export interface AiTaskRunnerResourceTicket { chargeIds: readonly string[]; modelPending?: true }
/** A server-owned orchestration interval; never a tool result or execution grant. */
export interface AiTaskRunnerOverheadTicket {
  key: string;
  remainingMs: number;
  /** Only original pending-step registration is admitted; no step reserve/start. */
  stepAllowanceUnavailable?: true;
  /** Original Run time remains unresolved. An admitted PENDING action or
   * receipt-only recovery cannot report a fully accounted terminal task. */
  originalTimeDebt?: true;
}
export interface AiTaskRunnerOverheadPort {
  /** Only the persistent composition supplies exact tool/reservation clock spans.
   * Other hosts must keep separate intervals rather than guess an exclusion. */
  includesEffectInterval?: true;
  /** Original budget initialization belongs to the first measured admission. */
  opensBudget?: true;
  /** Only before another new step: original measurement + next reservation share
   * one transaction. A missing/lost handoff cannot restart either interval. */
  rotate?(ticket: AiTaskRunnerOverheadTicket, lease: AiTaskRunnerLease, segment: string,
    maximumMs: number | undefined, retainStepAllowance: boolean): Promise<AiTaskRunnerOverheadTicket>;
  remaining?(ticket: AiTaskRunnerOverheadTicket, lease: AiTaskRunnerLease): number;
  /** Undefined selects the original authorized plan's step window, not an unbounded limit. */
  begin(lease: AiTaskRunnerLease, segment: string, maximumMs: number | undefined, retainStepAllowance: boolean,
    recovery: boolean, pendingStart?: boolean): Promise<AiTaskRunnerOverheadTicket>;
  complete(ticket: AiTaskRunnerOverheadTicket, lease: AiTaskRunnerLease): Promise<void>;
  /** Close only this process's original measured interval after the exact
   * release CAS receipt. Never reserve again or adopt an absent holder. */
  completeAfterRelease?(ticket: AiTaskRunnerOverheadTicket, lease: AiTaskRunnerLease,
    receipt: { released: true; revision: number }): Promise<void>;
  abandon(ticket: AiTaskRunnerOverheadTicket, lease: AiTaskRunnerLease): Promise<void>;
}
export interface AiTaskRunnerResourcePort {
  /** Persistent composition bridges result COMMIT while excluding only exact original tool time. */
  overhead?: AiTaskRunnerOverheadPort;
  /** Original Run preparation quotas only, not a plan/dispatch authority. */
  preparation?: import('./task-run-preparation.ports').AiTaskPreparationResources;
  open(lease: AiTaskRunnerLease, recovery: boolean): Promise<void>;
  reserve(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<AiTaskRunnerResourceTicket>;
  /** Bind/reserve generation and optional count after durable step start.
   * An explicit counting consumer may then send only its own budgeted request;
   * this stage never sends generation or grants business execution. */
  beforeExecute?(ticket: AiTaskRunnerResourceTicket, step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, signal?: AbortSignal): Promise<AiTaskRunnerResourceTicket>;
  record(ticket: AiTaskRunnerResourceTicket, step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, reconcile: boolean): Promise<void>;
  markUnknown(ticket: AiTaskRunnerResourceTicket, lease: AiTaskRunnerLease): Promise<void>;
  recover?(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<AiTaskRunnerResourceTicket>;
}

export interface AiTaskRunnerInput extends AiTaskRunnerClaimInput {
  recovery?: boolean;
}

export type AiTaskRunnerOutcome = AiTaskRunnerOutcomeDraft;
