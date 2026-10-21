import { AI_USAGE_DRAFT_VERSION } from "./ai-usage-draft";
import { leafClosed as obj, leafEnum as choice, leafRef as ref, leafId as id, leafInt as int, leafList as list, leafText as text, type AiLeafSchemaDraft } from "./ai-gateway-draft-schemas";
const v = choice(AI_USAGE_DRAFT_VERSION), bool = { type: "boolean" }, money = { type: "string", minLength: 8, maxLength: 25, pattern: "^(0|[1-9][0-9]{0,17})\\.[0-9]{6}$" };
const currency = { type: "string", pattern: "^[A-Z]{3}$", minLength: 3, maxLength: 3 }, scale = { type: "integer", const: 6 };
const quantity = (mode: "any" | "zero" | "positive"): AiLeafSchemaDraft => ({ oneOf: [
  obj({ unit: choice("tokens"), value: mode === "zero" ? { type: "integer", const: 0 } : int(mode === "positive" ? 1 : 0, Number.MAX_SAFE_INTEGER) }),
  obj({ unit: choice("calls"), value: mode === "zero" ? { type: "integer", const: 0 } : int(mode === "positive" ? 1 : 0, 4294967295) }),
  obj({ unit: choice("money"), amount: mode === "zero" ? { type: "string", const: "0.000000" } : mode === "positive" ? { ...money, not: { const: "0.000000" } } : money, currency, scale })] });
const gate = obj({ enabled: bool, revision: int(1) });
const model = text(256), baseUrl = { type: "string", format: "uri", minLength: 9, maxLength: 2048, pattern: "^https://[^/@?#\\s]+(?:/[^?#\\s]*)?$" };
const record = { draftVersion: v, reservationId: id(), revision: int(1), association: ref("AiUsageAssociationDraft") };
const usageReported = obj({ kind: choice("reported"), inputTokens: int(), outputTokens: int() });
const usageEstimated = obj({ kind: choice("estimated"), inputTokens: int(), outputTokens: int(), methodVersion: id() });
const usageUnknown = obj({ kind: choice("unknown"), reason: choice("not_returned", "result_unknown"), nextAction: choice("reconcile") });
const operationKey = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const legacySource = obj({ parameterSetId: id(), versionNo: int(1), fingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' } });
const settingsInput = { draftVersion: v, configId: id(), expectedRevision: int(0, 4294967294), enabled: bool };
const settingsSummary = { draftVersion: v, tenantId: id(), configId: id(), configRevision: int(0, 4294967295), enabled: bool, connectionState: choice("not_tested", "mock_only", "verified_live", "failed", "not_verified") };
const platformCapabilities = { type: 'array', maxItems: 8, uniqueItems: true,
  items: choice('text', 'streaming', 'tools', 'structured_output', 'vision', 'audio', 'embedding', 'reasoning') };
const platformSaved = { profileId: { type: 'string', minLength: 1, maxLength: 36, pattern: '^[A-Za-z0-9][\\w.:-]{0,35}$' },
  revision: int(1, 4294967295), enabled: bool, credentialConfigured: bool };
export const AI_USAGE_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiPlatformModelDirectoryDraft: obj({ items: list(obj({ profileId: { ...id(), maxLength: 36 }, profileKey: text(64),
    role: choice('DEFAULT', 'REASONING', 'VISION', 'EMBEDDING'), protocol: text(64), provider: text(128), model,
    revision: int(1, 4294967295), enabled: bool }), 50), nextCursor: { oneOf: [{ ...id(), maxLength: 36 }, { type: 'null' }] },
    observation: choice('configuration_catalog_not_capability_evidence') }),
  AiPlatformModelSettingsInputDraft: obj({ expectedRevision: int(0, 4294967294), operationKey, protocol: choice('openai_chat_completions', 'openai_responses', 'anthropic_messages'),
    model, baseUrl, enabled: bool, maxOutputTokens: int(1, 32768), allowedCapabilities: platformCapabilities,
    secretChange: { oneOf: [obj({ operation: choice('retain') }), obj({ operation: choice('replace'),
      apiKey: { type: 'string', minLength: 1, maxLength: 8192, pattern: '^[\\x21-\\x7e]+$', writeOnly: true } }), obj({ operation: choice('clear') })] }
  }, ['expectedRevision', 'protocol', 'model', 'baseUrl', 'enabled', 'maxOutputTokens', 'secretChange']),
  AiPlatformModelSettingsSaveDraft: obj(platformSaved),
  AiPlatformModelSettingsSummaryDraft: obj({ ...platformSaved, mode: choice('platform_managed'), protocol: id(), model,
    allowedCapabilities: platformCapabilities, baseUrl, maxOutputTokens: int(1, 32768),
    verification: choice('not_assessed_by_configuration_read'), observation: choice('current_configuration_not_write_receipt')
  }, [...Object.keys(platformSaved), 'mode', 'protocol', 'model', 'allowedCapabilities', 'verification', 'observation']),
  AiUsageQuantityDraft: quantity("any"),
  AiBudgetLimitDraft: { oneOf: [obj({ state: choice("not_configured") }), obj({ state: choice("zero"), quantity: quantity("zero") }), obj({ state: choice("limited"), quantity: quantity("positive") })] },
  AiSettingGateDraft: gate,
  AiTenantModelSettingsInputDraft: { oneOf: [obj({ ...settingsInput, operationKey, mode: choice("platform_managed") }, [...Object.keys(settingsInput), 'mode']), obj({ ...settingsInput, operationKey, legacySource, mode: choice("tenant_managed"), protocol: id(), baseUrl, model, secretChange: { oneOf: [obj({ operation: choice("retain") }), obj({ operation: choice("replace"), apiKey: { type: "string", minLength: 1, maxLength: 8192, pattern: "\\S", not: { pattern: "[\\r\\n]" }, writeOnly: true } }), obj({ operation: choice("clear") })] } }, [...Object.keys(settingsInput), 'mode', 'protocol', 'baseUrl', 'model', 'secretChange'])] },
  AiLegacyModelConfigurationDraft: { oneOf: [
    obj({ currentConfiguration: choice('present', 'absent'), automaticImport: { type: 'boolean', const: false },
      sourcePreserved: { type: 'boolean', const: true }, execution: choice('not_granted'), state: choice('not_recorded'), source: { type: 'null' } }),
    obj({ currentConfiguration: choice('present', 'absent'), automaticImport: { type: 'boolean', const: false },
      sourcePreserved: { type: 'boolean', const: true }, execution: choice('not_granted'), state: choice('review_required'), source: legacySource,
      supportedProtocol: { oneOf: [choice('openai_chat_completions'), { type: 'null' }] }, credential: choice('replacement_required'),
      conversion: choice('explicit_disabled_replacement_only') })
  ] },
  AiModelConfigurationOperationReadDraft: obj({ operationKey }),
  AiModelConfigurationOperationDraft: { oneOf: [
    obj({ operationKey, automaticRetry: { type: 'boolean', const: false }, execution: choice('not_granted'),
      observation: choice('original_configuration_save'), state: choice('unknown'), result: { type: 'null' } }),
    obj({ operationKey, automaticRetry: { type: 'boolean', const: false }, execution: choice('not_granted'),
      observation: choice('original_configuration_save'), state: choice('recorded'), expectedRevision: int(0, 4294967294),
      resultRevision: int(1, 4294967295), recordedAt: { type: 'string', format: 'date-time' },
      result: { oneOf: [ref('AiTenantModelSettingsSummaryDraft'), ref('AiPlatformModelSettingsSaveDraft')] } })
  ] },
  AiTenantModelSettingsSummaryDraft: { oneOf: [obj({ ...settingsSummary, mode: choice("platform_managed"), serviceName: choice("Rental OS AI"), routing: choice("automatic"), availability: choice("ready", "unavailable", "not_verified") }), obj({ ...settingsSummary, configRevision: int(1, 4294967295), mode: choice("tenant_managed"), protocol: id(), baseUrl, model, credentialState: choice("configured", "missing", "rotation_required") })] },
  AiUsageSettingsDraft: obj({ draftVersion: v, scope: { oneOf: [ref("AiPlatformScope"), ref("AiTenantScope")] }, config: ref("AiGatewayConfigReferenceDraft"), gates: obj({ platform: gate, tenant: gate, scene: gate }), sceneCode: id(), allowedModels: list(model, 100), allowedScenes: list(id(), 100), budget: ref("AiBudgetLimitDraft"), maxConcurrent: int(1, 100), maxCallsPerRun: int(1, 100) }),
  AiUsageAssociationDraft: obj({ requestId: id(), runId: id(), stepId: id(), actionId: id(), idempotencyKey: id(), scope: ref("AiExecutionScope"), config: ref("AiGatewayConfigReferenceDraft"), priceVersion: id() }),
  AiUsageRecordDraft: { oneOf: [obj({ ...record, status: choice("reserved"), reserved: quantity("positive") }), obj({ ...record, status: choice("settled"), actual: quantity("any"), usage: usageReported }), obj({ ...record, status: choice("estimated"), estimate: quantity("any"), usage: usageEstimated, nextAction: choice("reconcile") }), obj({ ...record, status: choice("pending_reconciliation"), retained: quantity("positive"), usage: usageUnknown, nextAction: choice("reconcile") }), obj({ ...record, status: choice("released"), released: quantity("any"), reason: choice("not_dispatched", "verified_unused") })] },
  AiUsageMutationResultDraft: { oneOf: [obj({ draftVersion: v, idempotencyKey: id(), status: choice("applied", "replayed"), record: ref("AiUsageRecordDraft") }), obj({ draftVersion: v, idempotencyKey: id(), status: choice("conflict"), reason: choice("revision_changed", "payload_changed"), nextAction: choice("reload_or_manual") })] }
};
