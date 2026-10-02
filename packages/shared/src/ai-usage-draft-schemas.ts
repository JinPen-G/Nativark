import { AI_USAGE_DRAFT_VERSION } from "./ai-usage-draft";
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id, leafInt as int, leafList as list, leafText as text, type AiLeafSchemaDraft } from "./ai-gateway-draft-schemas";
const v = choice(AI_USAGE_DRAFT_VERSION), bool = { type: "boolean" }, money = { type: "string", minLength: 8, maxLength: 19, pattern: "^(0|[1-9][0-9]{0,11})\\.[0-9]{6}$" };
const currency = { type: "string", pattern: "^[A-Z]{3}$", minLength: 3, maxLength: 3 }, scale = { type: "integer", const: 6 };
const quantity = (mode: "any" | "zero" | "positive"): AiLeafSchemaDraft => ({ oneOf: [obj({ unit: choice("tokens", "calls"), value: mode === "zero" ? { type: "integer", const: 0 } : int(mode === "positive" ? 1 : 0) }), obj({ unit: choice("money"), amount: mode === "zero" ? { type: "string", const: "0.000000" } : mode === "positive" ? { ...money, not: { const: "0.000000" } } : money, currency, scale })] });
const gate = obj({ enabled: bool, revision: int(1) });
const model = text(256), baseUrl = { type: "string", format: "uri", minLength: 9, maxLength: 2048, pattern: "^https://[^/@?#\\s]+(?:/[^?#\\s]*)?$" };
const record = { draftVersion: v, reservationId: id(), revision: int(1), association: ref("AiUsageAssociationDraft") };
const usageReported = obj({ kind: choice("reported"), inputTokens: int(), outputTokens: int() });
const usageEstimated = obj({ kind: choice("estimated"), inputTokens: int(), outputTokens: int(), methodVersion: id() });
const usageUnknown = obj({ kind: choice("unknown"), reason: choice("not_returned", "result_unknown"), nextAction: choice("reconcile") });
const settingsInput = { draftVersion: v, configId: id(), expectedRevision: int(), enabled: bool };
const settingsSummary = { draftVersion: v, tenantId: id(), configId: id(), configRevision: int(1), enabled: bool, connectionState: choice("not_tested", "mock_only", "verified_live", "failed") };
export const AI_USAGE_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiUsageQuantityDraft: quantity("any"),
  AiBudgetLimitDraft: { oneOf: [obj({ state: choice("not_configured") }), obj({ state: choice("zero"), quantity: quantity("zero") }), obj({ state: choice("limited"), quantity: quantity("positive") })] },
  AiSettingGateDraft: gate,
  AiTenantModelSettingsInputDraft: { oneOf: [obj({ ...settingsInput, mode: choice("platform_managed") }), obj({ ...settingsInput, mode: choice("tenant_managed"), protocol: id(), baseUrl, model, secretChange: { oneOf: [obj({ operation: choice("retain") }), obj({ operation: choice("replace"), apiKey: { type: "string", minLength: 1, maxLength: 8192, pattern: "\\S", not: { pattern: "[\\r\\n]" }, writeOnly: true } }), obj({ operation: choice("clear") })] } })] },
  AiTenantModelSettingsSummaryDraft: { oneOf: [obj({ ...settingsSummary, mode: choice("platform_managed"), serviceName: choice("Rental OS AI"), routing: choice("automatic"), availability: choice("ready", "unavailable", "not_verified") }), obj({ ...settingsSummary, mode: choice("tenant_managed"), protocol: id(), baseUrl, model, credentialState: choice("configured", "missing", "rotation_required") })] },
  AiUsageSettingsDraft: obj({ draftVersion: v, scope: ref("AiTenantScope"), config: ref("AiGatewayConfigReferenceDraft"), gates: obj({ platform: gate, tenant: gate, scene: gate }), sceneCode: id(), allowedModels: list(model, 100), allowedScenes: list(id(), 100), budget: ref("AiBudgetLimitDraft"), maxConcurrent: int(1, 100), maxCallsPerRun: int(1, 100) }),
  AiUsageAssociationDraft: obj({ requestId: id(), runId: id(), stepId: id(), actionId: id(), idempotencyKey: id(), scope: { oneOf: [ref("AiTenantScope"), ref("AiWorkspaceScope")] }, config: ref("AiGatewayConfigReferenceDraft"), priceVersion: id() }),
  AiUsageRecordDraft: { oneOf: [obj({ ...record, status: choice("reserved"), reserved: quantity("positive") }), obj({ ...record, status: choice("settled"), actual: quantity("any"), usage: usageReported }), obj({ ...record, status: choice("estimated"), estimate: quantity("any"), usage: usageEstimated, nextAction: choice("reconcile") }), obj({ ...record, status: choice("pending_reconciliation"), retained: quantity("positive"), usage: usageUnknown, nextAction: choice("reconcile") }), obj({ ...record, status: choice("released"), released: quantity("any"), reason: choice("not_dispatched", "verified_unused") })] },
  AiUsageMutationResultDraft: { oneOf: [obj({ draftVersion: v, idempotencyKey: id(), status: choice("applied", "replayed"), record: ref("AiUsageRecordDraft") }), obj({ draftVersion: v, idempotencyKey: id(), status: choice("conflict"), reason: choice("revision_changed", "payload_changed"), nextAction: choice("reload_or_manual") })] }
};
