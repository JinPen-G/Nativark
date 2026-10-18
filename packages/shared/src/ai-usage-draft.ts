import type { AiExecutionScope } from "./ai-native";
import type { AiGatewayConfigReferenceDraft, AiGatewayUsageDraft } from "./ai-gateway-draft";
export const AI_USAGE_DRAFT_VERSION = "ain-c07-draft-2" as const;
export type AiUsageQuantityDraft =
  | { unit: "tokens" | "calls"; value: number }
  /** Exactly six decimal places, currency explicit; no exchange rate or pricing default. */
  | { unit: "money"; amount: string; currency: string; scale: 6 };
export type AiBudgetLimitDraft =
  | { state: "not_configured" }
  | { state: "zero"; quantity: { unit: "tokens" | "calls"; value: 0 } | { unit: "money"; amount: "0.000000"; currency: string; scale: 6 } }
  | { state: "limited"; quantity: AiUsageQuantityDraft };
export interface AiSettingGateDraft { enabled: boolean; revision: number }
interface AiTenantModelSettingsInputBaseDraft {
  /** Tenant configuration identity, NOT a Gateway provider Profile ID. The
   * current server tenant must match; clients cannot select another tenant. */
  draftVersion: typeof AI_USAGE_DRAFT_VERSION; configId: string; expectedRevision: number;
  enabled: boolean;
  /** Original save reference; supplying it records a receipt in the same CAS.
   * Observation is not permission to retry an uncertain write. */
  operationKey?: string;
}
export type AiTenantModelSettingsInputDraft = AiTenantModelSettingsInputBaseDraft & (
  | { mode: "platform_managed" }
  | { mode: "tenant_managed"; protocol: string; baseUrl: string; model: string;
  /** Management-only write secret. Never reuse as model input/output/log schema. */
  secretChange: { operation: "retain" } | { operation: "replace"; apiKey: string } | { operation: "clear" } }
);
interface AiTenantModelSettingsSummaryBaseDraft {
  /** Revision zero means no persisted configuration; the platform product
   * default remains disabled and does not grant budget or execution. */
  draftVersion: typeof AI_USAGE_DRAFT_VERSION; tenantId: string; configId: string; configRevision: number;
  enabled: boolean;
  connectionState: "not_tested" | "mock_only" | "verified_live" | "failed" | "not_verified";
}
export type AiTenantModelSettingsSummaryDraft = AiTenantModelSettingsSummaryBaseDraft & (
  | { mode: "platform_managed"; serviceName: "Rental OS AI"; routing: "automatic"; availability: "ready" | "unavailable" | "not_verified" }
  | { mode: "tenant_managed"; protocol: string; baseUrl: string; model: string; credentialState: "configured" | "missing" | "rotation_required" }
);
/** Management only. No model request, secret readback, tenant or actor override. */
export const AI_MODEL_SETTINGS_HTTP_DRAFT = Object.freeze({
  basePath: 'ai-native/model-settings', method: 'POST', read: 'read', save: 'save', operation: 'operation'
} as const);
/** Platform manager resource, never tenant-side configuration or dispatch.
 * URL profile identity is validated separately; a body cannot override it. */
export const AI_PLATFORM_MODEL_SETTINGS_HTTP_DRAFT = Object.freeze({ basePath: 'platform/ai/providers' } as const);
export type AiPlatformModelSettingsInputDraft = {
  expectedRevision: number; protocol: 'openai_chat_completions'; model: string; baseUrl: string;
  operationKey?: string;
  enabled: boolean; maxOutputTokens: number;
  allowedCapabilities?: ('text' | 'streaming' | 'tools' | 'structured_output' | 'vision' | 'audio' | 'embedding' | 'reasoning')[];
  secretChange: { operation: 'retain' } | { operation: 'replace'; apiKey: string } | { operation: 'clear' };
};
export type AiPlatformModelSettingsSaveDraft = {
  profileId: string; revision: number; enabled: boolean; credentialConfigured: boolean;
};
export type AiPlatformModelSettingsSummaryDraft = AiPlatformModelSettingsSaveDraft & {
  mode: 'platform_managed'; protocol: string; model: string;
  allowedCapabilities: NonNullable<AiPlatformModelSettingsInputDraft['allowedCapabilities']>;
  baseUrl?: string; maxOutputTokens?: number;
  verification: 'not_assessed_by_configuration_read'; observation: 'current_configuration_not_write_receipt';
};
export type AiModelConfigurationOperationDraft = {
  operationKey: string; automaticRetry: false; execution: 'not_granted'; observation: 'original_configuration_save';
} & ({ state: 'unknown'; result: null } | { state: 'recorded'; expectedRevision: number; resultRevision: number;
  recordedAt: string; result: AiTenantModelSettingsSummaryDraft | AiPlatformModelSettingsSaveDraft });
export interface AiUsageSettingsDraft {
  draftVersion: typeof AI_USAGE_DRAFT_VERSION; scope: Extract<AiExecutionScope, { kind: "tenant" | "platform" }>;
  config: AiGatewayConfigReferenceDraft;
  gates: { platform: AiSettingGateDraft; tenant: AiSettingGateDraft; scene: AiSettingGateDraft };
  sceneCode: string; allowedModels: string[]; allowedScenes: string[];
  budget: AiBudgetLimitDraft; maxConcurrent: number; maxCallsPerRun: number;
}
export interface AiUsageAssociationDraft {
  requestId: string; runId: string; stepId: string; actionId: string; idempotencyKey: string;
  scope: AiExecutionScope;
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
