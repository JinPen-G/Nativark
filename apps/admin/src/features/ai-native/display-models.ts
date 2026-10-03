export type DisplayAvailability = "available" | "unavailable" | "unknown";
export type DisplayTaskStatus =
  | "registered"
  | "running"
  | "waiting"
  | "partially_succeeded"
  | "succeeded"
  | "failed"
  | "cancel_requested"
  | "cancelled"
  | "unknown";
export type DisplayStepStatus =
  | "registered"
  | "running"
  | "waiting_input"
  | "waiting_confirmation"
  | "waiting_external"
  | "succeeded"
  | "partially_succeeded"
  | "failed"
  | "cancelled"
  | "unknown";
export type DisplayUsageStatus =
  | "reserved"
  | "reported"
  | "estimated"
  | "settled"
  | "unknown"
  | "reconciliation_required";

export interface DisplayTask {
  id: string;
  status: DisplayTaskStatus;
  scene: string;
  updatedAt: string | null;
  availability: DisplayAvailability;
  unavailableReason?: string;
}
export interface DisplayStep {
  id: string;
  taskId: string;
  status: DisplayStepStatus;
  action: string;
  occurredAt: string | null;
  availability: DisplayAvailability;
}
export interface DisplayEvent {
  cursor: string;
  taskId: string;
  revision: string;
  type: string;
  status: "known" | "unknown";
}
export interface DisplayGatewayError {
  code: string;
  message: string;
  retryable: false;
  availability: "unavailable";
}
export interface DisplayUsage {
  status: DisplayUsageStatus;
  amount: string | null;
  unit: string | null;
  availability: DisplayAvailability;
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;
const date = (value: unknown): string | null => {
  const result = text(value);
  return result && !Number.isNaN(Date.parse(result)) ? result : null;
};
const taskStatuses = new Set<DisplayTaskStatus>([
  "registered",
  "running",
  "waiting",
  "partially_succeeded",
  "succeeded",
  "failed",
  "cancel_requested",
  "cancelled",
  "unknown",
]);
const stepStatuses = new Set<DisplayStepStatus>([
  "registered",
  "running",
  "waiting_input",
  "waiting_confirmation",
  "waiting_external",
  "succeeded",
  "partially_succeeded",
  "failed",
  "cancelled",
  "unknown",
]);
const usageStatuses = new Set<DisplayUsageStatus>([
  "reserved",
  "reported",
  "estimated",
  "settled",
  "unknown",
  "reconciliation_required",
]);

export function toDisplayTask(input: unknown): DisplayTask {
  const row = object(input),
    id = text(row.id),
    scene = text(row.scene),
    rawStatus = text(row.status);
  if (
    !id ||
    !scene ||
    !rawStatus ||
    !taskStatuses.has(rawStatus as DisplayTaskStatus)
  )
    return {
      id: id ?? "unavailable",
      status: "unknown",
      scene: scene ?? "unknown",
      updatedAt: date(row.updatedAt),
      availability: "unavailable",
      unavailableReason: "任务数据缺少可识别版本或状态",
    };
  return {
    id,
    status: rawStatus as DisplayTaskStatus,
    scene,
    updatedAt: date(row.updatedAt),
    availability: "available",
  };
}

export function toDisplayStep(input: unknown): DisplayStep {
  const row = object(input),
    id = text(row.id),
    taskId = text(row.taskId),
    action = text(row.action),
    rawStatus = text(row.status);
  if (
    !id ||
    !taskId ||
    !action ||
    !rawStatus ||
    !stepStatuses.has(rawStatus as DisplayStepStatus)
  )
    return {
      id: id ?? "unavailable",
      taskId: taskId ?? "unavailable",
      action: action ?? "unknown",
      status: "unknown",
      occurredAt: date(row.occurredAt),
      availability: "unavailable",
    };
  return {
    id,
    taskId,
    action,
    status: rawStatus as DisplayStepStatus,
    occurredAt: date(row.occurredAt),
    availability: "available",
  };
}

export function toDisplayEvent(input: unknown): DisplayEvent {
  const row = object(input),
    cursor = text(row.cursor),
    taskId = text(row.taskId),
    revision = text(row.revision),
    type = text(row.type);
  return {
    cursor: cursor ?? "unavailable",
    taskId: taskId ?? "unavailable",
    revision: revision ?? "unavailable",
    type: type ?? "unknown",
    status: cursor && taskId && revision && type ? "known" : "unknown",
  };
}

export function toDisplayGatewayError(input: unknown): DisplayGatewayError {
  const row = object(input),
    code = text(row.code);
  return {
    code: code ?? "UNKNOWN_ERROR",
    message: "AI 操作暂不可用，请核对当前状态",
    retryable: false,
    availability: "unavailable",
  };
}

export function toDisplayUsage(input: unknown): DisplayUsage {
  const row = object(input),
    rawStatus = text(row.status),
    amount = text(row.amount),
    unit = text(row.unit);
  if (!rawStatus || !usageStatuses.has(rawStatus as DisplayUsageStatus))
    return {
      status: "unknown",
      amount: null,
      unit: null,
      availability: "unavailable",
    };
  return {
    status: rawStatus as DisplayUsageStatus,
    amount: rawStatus === "unknown" ? null : amount,
    unit: rawStatus === "unknown" ? null : unit,
    availability: rawStatus === "unknown" ? "unknown" : "available",
  };
}
