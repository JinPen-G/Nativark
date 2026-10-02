import type { AiExecutionScope } from "./ai-native";
import type { AiGatewayConfigReferenceDraft, AiGatewayUsageDraft } from "./ai-gateway-draft";
export const AI_USAGE_DRAFT_VERSION = "ain-c07-draft-1" as const;
export type AiUsageQuantityDraft =
  | { unit: "tokens" | "calls"; value: number }
  /** Exactly six decimal places, currency explicit; no exchange rate or pricing default. */
  | { unit: "money"; amount: string; currency: string; scale: 6 };
export type AiBudgetLimitDraft =
  | { state: "not_configured" }
  | { state: "zero"; quantity: { unit: "tokens" | "calls"; value: 0 } | { unit: "money"; amount: "0.000000"; currency: string; scale: 6 } }
  | { state: "limited"; quantity: AiUsageQuantityDraft };
export interface AiSettingGateDraft { enabled: boolean; revision: number }
export interface AiTenantModelSettingsInputDraft {
  draftVersion: typeof AI_USAGE_DRAFT_VERSION; configId: string; expectedRevision: number;
  protocol: string; baseUrl: string; model: string; enabled: boolean;
  /** Management-only write secret. Never reuse as model input/output/log schema. */
  secretChange: { operation: "retain" } | { operation: "replace"; apiKey: string } | { operation: "clear" };
}
export interface AiTenantModelSettingsSummaryDraft {
  draftVersion: typeof AI_USAGE_DRAFT_VERSION; tenantId: string; configId: string; configRevision: number;
  protocol: string; baseUrl: string; model: string; enabled: boolean;
  credentialState: "configured" | "missing" | "rotation_required";
  connectionState: "not_tested" | "mock_only" | "verified_live" | "failed";
}
export interface AiUsageSettingsDraft {
  draftVersion: typeof AI_USAGE_DRAFT_VERSION; scope: Extract<AiExecutionScope, { kind: "tenant" }>;
  config: AiGatewayConfigReferenceDraft;
  gates: { platform: AiSettingGateDraft; tenant: AiSettingGateDraft; scene: AiSettingGateDraft };
  sceneCode: string; allowedModels: string[]; allowedScenes: string[];
  budget: AiBudgetLimitDraft; maxConcurrent: number; maxCallsPerRun: number;
}
export interface AiUsageAssociationDraft {
  requestId: string; runId: string; stepId: string; actionId: string; idempotencyKey: string;
  scope: Extract<AiExecutionScope, { kind: "tenant" | "workspace" }>;
  config: AiGatewayConfigReferenceDraft; priceVersion: string;
}
interface AiUsageRecordBaseDraft { draftVersion: typeof AI_USAGE_DRAFT_VERSION; reservationId: string; revision: number; association: AiUsageAssociationDraft }
/** Ledger references are never budget admission or permanent authorization credentials. */
export type AiUsageRecordDraft = AiUsageRecordBaseDraft & (
  | { status: "reserved"; reserved: AiUsageQuantityDraft }
  | { status: "settled"; actual: AiUsageQuantityDraft; usage: Extract<AiGatewayUsageDraft, { kind: "reported" }> }
  | { status: "estimated"; estimate: AiUsageQuantityDraft; usage: Extract<AiGatewayUsageDraft, { kind: "estimated" }>; nextAction: "reconcile" }
  | { status: "pending_reconciliation"; retained: AiUsageQuantityDraft; usage: Extract<AiGatewayUsageDraft, { kind: "unknown" }>; nextAction: "reconcile" }
  | { status: "released"; released: AiUsageQuantityDraft; reason: "not_dispatched" | "verified_unused" }
);
export type AiUsageMutationResultDraft = { draftVersion: typeof AI_USAGE_DRAFT_VERSION; idempotencyKey: string } & (
  | { status: "applied" | "replayed"; record: AiUsageRecordDraft }
  | { status: "conflict"; reason: "revision_changed" | "payload_changed"; nextAction: "reload_or_manual" }
);
