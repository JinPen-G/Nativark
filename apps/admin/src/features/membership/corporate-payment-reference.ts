import { clearSettingsReference, readSettingsReference, retainSettingsReference, type SettingsReferenceStorage } from "../ai-native/settings-operation-reference";

/** Recovery locator only: no bank evidence, reason, amount or business authority. */
export interface CorporatePaymentReference { version: 1; scope: string; customerId: string; paymentId: string; key: string }
const storageKey = (scope: string, customerId: string) => scope && customerId
  ? `rental.corporate-payment-reversal.v1:${encodeURIComponent(scope)}:${encodeURIComponent(customerId)}` : "";
function parse(value: unknown, scope: string, customerId: string): CorporatePaymentReference | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "customerId,key,paymentId,scope,version" || row.version !== 1
    || row.scope !== scope || row.customerId !== customerId || typeof row.paymentId !== "string" || !row.paymentId.trim()
    || row.paymentId.length > 191 || typeof row.key !== "string" || !row.key.trim() || row.key.length > 191) return null;
  return row as unknown as CorporatePaymentReference;
}
export function readCorporatePaymentReference(storage: SettingsReferenceStorage | undefined, scope: string, customerId: string) {
  return readSettingsReference(storage, storageKey(scope, customerId), value => parse(value, scope, customerId));
}
export function retainCorporatePaymentReference(storage: SettingsReferenceStorage | undefined, reference: CorporatePaymentReference) {
  if (!parse(reference, reference.scope, reference.customerId)) throw new Error("CORPORATE_PAYMENT_REFERENCE_UNAVAILABLE");
  retainSettingsReference(storage, storageKey(reference.scope, reference.customerId), reference);
}
/** A confirmed full reversal of this exact payment settles the locator even if
 * another operation won; a null read never proves rollback or permits resend. */
export function matchesCorporatePaymentReversal(reference: CorporatePaymentReference,
  receipt: { customerId: string; paymentId: string } | null): boolean {
  return Boolean(receipt && receipt.customerId === reference.customerId && receipt.paymentId === reference.paymentId);
}
export function clearCorporatePaymentReference(storage: SettingsReferenceStorage | undefined, reference: CorporatePaymentReference) {
  clearSettingsReference(storage, storageKey(reference.scope, reference.customerId), reference);
}
