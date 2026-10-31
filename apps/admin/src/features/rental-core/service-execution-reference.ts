import type { RentalServiceExecutionAction } from "@rental-os/shared";
import { clearSettingsReference, readSettingsReference, retainSettingsReference, type SettingsReferenceStorage } from "../ai-native/settings-operation-reference";

/** A tab-local, non-secret original-operation locator. It cannot authorize an
 * action, prove rollback or reconstruct a lost request from current quantities. */
export interface ServiceExecutionReference {
  version: 1;
  scope: string;
  orderId: string;
  occurrenceId: string;
  key: string;
  action: RentalServiceExecutionAction;
}

export function serviceExecutionStorageKey(scope: string, orderId: string) {
  return scope && orderId ? `rental.service-execution.v1:${encodeURIComponent(scope)}:${encodeURIComponent(orderId)}` : "";
}

function parseReference(value: unknown, scope: string, orderId: string): ServiceExecutionReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "action,key,occurrenceId,orderId,scope,version"
    || row.version !== 1 || row.scope !== scope || row.orderId !== orderId
    || typeof row.occurrenceId !== "string" || !row.occurrenceId || row.occurrenceId.length > 191
    || typeof row.key !== "string" || !row.key.trim() || row.key.trim() !== row.key || row.key.length > 191
    || !["start", "complete", "cancel", "fail", "no_show"].includes(String(row.action))) return null;
  return row as unknown as ServiceExecutionReference;
}

export function readServiceExecutionReference(storage: SettingsReferenceStorage | undefined, scope: string, orderId: string) {
  return readSettingsReference(storage, serviceExecutionStorageKey(scope, orderId), value => parseReference(value, scope, orderId));
}

export function retainServiceExecutionReference(storage: SettingsReferenceStorage | undefined, reference: ServiceExecutionReference) {
  if (!parseReference(reference, reference.scope, reference.orderId)) throw new Error("SERVICE_EXECUTION_REFERENCE_UNAVAILABLE");
  retainSettingsReference(storage, serviceExecutionStorageKey(reference.scope, reference.orderId), reference);
}

export function clearServiceExecutionReference(storage: SettingsReferenceStorage | undefined, reference: ServiceExecutionReference) {
  clearSettingsReference(storage, serviceExecutionStorageKey(reference.scope, reference.orderId), reference);
}
