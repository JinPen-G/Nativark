import type { AiExecutionScope, AiToolCode } from "./ai-native";
export const AI_EVENTS_DRAFT_VERSION = "ain-c08-draft-1" as const;
interface AiBusinessEventBaseDraft {
  draftVersion: typeof AI_EVENTS_DRAFT_VERSION; eventId: string; eventVersion: "1";
  scope: Extract<AiExecutionScope, { kind: "tenant" | "workspace" }>;
  occurredAt: string; traceId: string; causationId: string; deduplicationKey: string; causalDepth: number;
}
/** Minimal Outbox input only, distinct from C04 task UI/stream events. */
export type AiBusinessEventDraft = AiBusinessEventBaseDraft & (
  | { type: "fulfillment.resource_shortage"; resource: { kind: "order"; id: string; version: number }; payload: { dueAt: string; locationId: string } }
  | { type: "inspection.return_exception"; resource: { kind: "inspection"; id: string; version: number }; payload: { orderId: string; exceptionId: string } }
  | { type: "notification.failed"; resource: { kind: "notification"; id: string; version: number }; payload: { failureCode: "delivery_failed" | "result_unknown" } }
  | { type: "refund.failed"; resource: { kind: "refund"; id: string; version: number }; payload: { orderId: string; failureCode: "provider_failed" | "result_unknown" } }
  | { type: "opening.missing_configuration"; resource: { kind: "configuration"; id: string; version: number }; payload: { sectionCode: string } }
);
export type AiBusinessDeliveryDraft = { draftVersion: typeof AI_EVENTS_DRAFT_VERSION; eventId: string; attempt: number } & (
  | { state: "pending" }
  | { state: "retry_scheduled"; retryAt: string; nextAction: "recheck_current_resource" }
  | { state: "duplicate" | "out_of_order" | "expired"; nextAction: "recheck_current_resource" }
  | { state: "dead_letter"; reason: "attempts_exhausted" | "invalid_event"; nextAction: "manual" }
);
export interface AiAutomationToolReferenceDraft {
  toolCode: AiToolCode; toolVersion: "draft-1"; catalogRevision: string;
  /** Risk must be resolved from the server catalogue; no caller-supplied risk override. */
}
export interface AiAutomationPolicyDraft {
  draftVersion: typeof AI_EVENTS_DRAFT_VERSION; policyId: string; revision: number;
  scope: Extract<AiExecutionScope, { kind: "tenant" | "workspace" }>;
  subject: { subjectId: string; authorizationRevision: number };
  mode: "draft" | "disabled" | "shadow" | "manual_confirmation";
  allowedTools: AiAutomationToolReferenceDraft[];
  allowedWorkspaces: string[]; allowedLocations: string[]; allowedRecipientIds: string[];
  limits: { maxRunsPerDay: number; maxActionsPerRun: number; maxQuantity: number; cooldownSeconds: number; maxCausalDepth: number };
  validFrom: string; expiresAt: string;
  r3Policy: "human_and_original_approval";
}
