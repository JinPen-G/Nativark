import type { AiTaskStatusDraft, AiStepStatusDraft } from "@rental-os/shared";

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

export interface AiTaskRunnerStepCommit {
  lease: AiTaskRunnerLease;
  taskRevision: number;
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
  register(plan: AiTaskRunnerStepPlan, lease: AiTaskRunnerLease): Promise<AiTaskRunnerRegisteredStep>;
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
  reconcile?(step: AiTaskRunnerStepPlan, signal: AbortSignal, lease?: AiTaskRunnerLease): Promise<AiTaskRunnerEffectResult>;
  cleanup?(step: AiTaskRunnerStepPlan): Promise<void>;
}

export type AiTaskRunnerTaskOutcome =
  | { status: "succeeded" | "unknown" | "cancelled"; completedSteps: number; cleanupFailed: number }
  | { status: "paused"; pause: AiTaskRunnerPause; completedSteps: number; cleanupFailed: number }
  | { status: "failed"; completedSteps: number; cleanupFailed: number; errorCode: string };

/** Task aggregate transition is supplied by the composition root. The runner
 * only reports a durable step outcome; it never implements task transitions. */
export interface AiTaskRunnerOutcomePort {
  commit(input: {
    taskId: string;
    taskRevision: number;
    lease: AiTaskRunnerLease;
    outcome: AiTaskRunnerTaskOutcome;
  }): Promise<{ taskRevision: number; lease: AiTaskRunnerLease; outcomeStatus?: 'succeeded' | 'partially_succeeded' | 'cancelled' }>;
}

export interface AiTaskRunnerClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface AiTaskRunnerDependencies {
  leases: AiTaskRunnerLeasePort;
  steps: AiTaskRunnerStepPort;
  plan: AiTaskRunnerPlanPort;
  effects: AiTaskRunnerEffectPort;
  taskOutcome?: AiTaskRunnerOutcomePort;
  clock?: AiTaskRunnerClock;
  /** Required by the persistent composition; absent only for legacy isolated runner consumers. */
  resources?: AiTaskRunnerResourcePort;
}

export interface AiTaskRunnerResourceTicket { chargeIds: readonly string[] }
export interface AiTaskRunnerResourcePort {
  open(lease: AiTaskRunnerLease, recovery: boolean): Promise<void>;
  reserve(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<AiTaskRunnerResourceTicket>;
  record(ticket: AiTaskRunnerResourceTicket, step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease, reconcile: boolean): Promise<void>;
  markUnknown(ticket: AiTaskRunnerResourceTicket, lease: AiTaskRunnerLease): Promise<void>;
  recover?(step: AiTaskRunnerStepRef, lease: AiTaskRunnerLease): Promise<AiTaskRunnerResourceTicket>;
}

export interface AiTaskRunnerInput extends AiTaskRunnerClaimInput {
  recovery?: boolean;
}

export type AiTaskRunnerOutcome =
  | { status: "succeeded" | "partially_succeeded" | "paused" | "cancel_requested" | "cancelled" | "unknown" | "unavailable"; completedSteps: number; cleanupFailed: number }
  | { status: "failed"; completedSteps: number; cleanupFailed: number; errorCode: string };
