export type AiTaskExecutionResource = 'steps' | 'calls' | 'active_ms' | 'output_bytes';
export type AiTaskExecutionCounters = Readonly<Record<AiTaskExecutionResource, bigint>>;
export interface AiTaskExecutionPolicy {
  version: string;
  fingerprint: string;
  limits: AiTaskExecutionCounters;
}
export interface AiTaskExecutionLease {
  taskId: string;
  runId: string;
  holderId: string;
  revision: number;
  fencingToken: string;
}
export interface AiTaskExecutionBudgetSnapshot {
  scopeId: string;
  taskId: string;
  revision: number;
  policy: AiTaskExecutionPolicy;
  reserved: AiTaskExecutionCounters;
  consumed: AiTaskExecutionCounters;
}
export type AiTaskExecutionChargeTarget =
  | { kind: 'step'; stepId: string; actionId: string; stepFingerprint: string; gatewayInvocationId?: string }
  | { kind: 'run' };
export interface AiTaskExecutionChargeRequest {
  taskId: string;
  lease: AiTaskExecutionLease;
  chargeId: string;
  resource: AiTaskExecutionResource;
  amount: bigint;
  target: AiTaskExecutionChargeTarget;
}
export interface AiTaskExecutionChargeReceipt {
  chargeId: string;
  requestFingerprint: string;
  resource: AiTaskExecutionResource;
  amount: bigint;
  actualAmount: bigint | null;
  status: 'reserved' | 'recorded' | 'unknown';
  revision: number;
}
export interface AiTaskExecutionMutation {
  replayed: boolean;
  budget: AiTaskExecutionBudgetSnapshot;
  charge: AiTaskExecutionChargeReceipt;
}
export interface AiTaskExecutionSettlementRequest {
  taskId: string;
  lease: AiTaskExecutionLease;
  chargeId: string;
  evidenceRef: string;
}

export interface AiTaskExecutionBudgetPort {
  initialize(taskId: string, lease: AiTaskExecutionLease): Promise<AiTaskExecutionBudgetSnapshot>;
  load(taskId: string, lease: AiTaskExecutionLease): Promise<AiTaskExecutionBudgetSnapshot>;
  reserve(input: AiTaskExecutionChargeRequest): Promise<AiTaskExecutionMutation>;
  record(input: AiTaskExecutionSettlementRequest): Promise<AiTaskExecutionMutation>;
  reconcile(input: AiTaskExecutionSettlementRequest): Promise<AiTaskExecutionMutation>;
  markUnknown(input: { taskId: string; lease: AiTaskExecutionLease; chargeId: string; reason: string }): Promise<AiTaskExecutionMutation>;
}

export interface AiTaskExecutionPolicySource {
  resolve(taskId: string, lease: AiTaskExecutionLease): Promise<AiTaskExecutionPolicy>;
}
export interface AiTaskExecutionChargeEvidence {
  scopeId: string;
  taskId: string;
  runId: string;
  chargeId: string;
  requestFingerprint: string;
  resource: AiTaskExecutionResource;
  actualAmount: bigint;
  evidenceHash: string;
  dispatchToken: string | null;
  gatewayInvocationId: string | null;
}
export interface AiTaskExecutionEvidenceSource {
  read(input: AiTaskExecutionSettlementRequest, reconcile: boolean): Promise<AiTaskExecutionChargeEvidence>;
}

export class AiTaskExecutionBudgetError extends Error {
  constructor(readonly code: 'AI_INVALID_INPUT' | 'AI_ACCESS_DENIED' | 'AI_RESOURCE_UNAVAILABLE' | 'AI_RUN_LIMIT' | 'AI_RESULT_UNKNOWN' | 'AI_STORAGE_UNAVAILABLE' | 'AI_REVISION_CONFLICT') {
    super(code);
  }
}
