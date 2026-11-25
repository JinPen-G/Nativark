import { ModelGatewayError } from "./model-gateway.ports";
import type { TenantModelRecord } from "./tenant-model-config.service";
/** A transaction reached its commit boundary but its acknowledgement/current
 * delivery authority is unknown. Never retry with another revision or assume
 * rollback. Reading current configuration is observation, not a write receipt. */
export class AiModelConfigurationResultUnknownError extends Error {
  readonly code = 'AI_RESULT_UNKNOWN';
  readonly retryable = false;
  readonly nextAction = 'reconcile';
  constructor() { super('AI_RESULT_UNKNOWN: model configuration acknowledgement unknown'); this.name = 'AiModelConfigurationResultUnknownError'; }
}
export class AiModelConfigurationRevisionConflictError extends Error {
  readonly code = 'AI_REVISION_CONFLICT';
  readonly retryable = false;
  constructor() { super('AI_REVISION_CONFLICT'); }
}
/** New tenants stay closed. Legacy BYOK retains its stored switch; an explicit
 * service switch never borrows the inactive track's enabled field. */
export function tenantModelServiceEnabled(record: TenantModelRecord | null): boolean {
  if (record === null) return false;
  tenantModelMode(record);
  if (record.serviceEnabled !== undefined && typeof record.serviceEnabled !== 'boolean') throw new ModelGatewayError('CONFIG_INVALID');
  return record.serviceEnabled ?? record.settings?.enabled === true;
}
/** Null means a new tenant; a malformed existing row NEVER means platform fallback. */
export function tenantModelMode(record: TenantModelRecord | null): "platform_managed" | "tenant_managed" {
  if (record === null) return "platform_managed";
  if (!record || !Number.isSafeInteger(record.revision) || record.revision < 1 || record.revision >= Number.MAX_SAFE_INTEGER || typeof record.tenantId !== "string" || !record.tenantId) throw new ModelGatewayError("CONFIG_INVALID");
  if (record.mode !== undefined && !["platform_managed", "tenant_managed"].includes(record.mode)) throw new ModelGatewayError("CONFIG_INVALID");
  const hasSettings = record.settings !== undefined;
  if (!hasSettings) {
    if (record.mode !== "platform_managed" || record.credentialsEncrypted) throw new ModelGatewayError("CONFIG_INVALID");
    return "platform_managed";
  }
  if (!record.settings || typeof record.credentialsEncrypted !== "string") throw new ModelGatewayError("CONFIG_INVALID");
  // Complete structural validation/encrypted binding remains in original config service.
  for (const field of ["protocol", "baseUrl", "model"] as const) if (typeof record.settings[field] !== "string" || !record.settings[field]) throw new ModelGatewayError("CONFIG_INVALID");
  if (record.mode === undefined && !record.credentialsEncrypted) throw new ModelGatewayError("CONFIG_INVALID");
  return record.mode ?? "tenant_managed";
}
