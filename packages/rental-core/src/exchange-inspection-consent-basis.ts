/** Rental检查/交付同意的原材料与收据校验；读取冻结证据，不批准费用、预留库存或执行换货。 */
import { ConflictException } from "@nestjs/common";
import type { RentalExchangeInspectionConsent, RentalExchangeInspectionCustomerMaterial, RentalExchangeInspectionPreparation } from "./index";
import { requestFingerprint } from "@rental-os/platform-contracts/request-fingerprint";

export interface ExchangeInspectionConsentRow {
  tenantId: string; workspaceId: string; id: string; orderId: string; customerId: string; preparationId: string;
  operationKey: string; requestHash: string; payloadHash: string; payload: string | RentalExchangeInspectionConsent;
}

export const validExchangeInspectionHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) && value.length === 64;

export function exchangeInspectionCustomerMaterial(value: RentalExchangeInspectionPreparation, customerId: string,
  preparationHash: string): RentalExchangeInspectionCustomerMaterial {
  const material = { orderId: value.orderId, workspaceId: value.workspaceId, customerId, preparationId: value.id,
    preparationHash, expectedOrderUpdatedAt: value.expectedOrderUpdatedAt, exchange: structuredClone(value.exchange),
    templates: value.templates.map(({ side, template }) => ({ side, templateId: template.id, templateVersion: template.version, name: template.name,
      fields: template.fields.map(field => ({ code: field.code, label: field.label, type: field.type, required: field.required,
        ...(field.unit ? { unit: field.unit } : {}), ...(field.options ? { options: [...field.options] } : {}) })) })),
    inspections: value.inspections.map(({ side, templateId, templateVersion, results }) => ({ side, templateId, templateVersion, results: structuredClone(results) })),
    exceptions: value.exceptions.map(({ code, description, allocationId }) => ({ code, description, allocationId })),
    photos: (value.acceptedMedia ?? []).map(({ side, templateId, fieldCode, fileAssetId, contentHash }) => ({ side, templateId, fieldCode, fileAssetId, contentHash })) };
  return { ...material, materialHash: requestFingerprint(material) };
}

export function readExchangeInspectionConsent(row: ExchangeInspectionConsentRow,
  scope: { tenantId: string; workspaceId: string; orderId: string; customerId: string }): RentalExchangeInspectionConsent {
  let value: RentalExchangeInspectionConsent;
  try { value = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload; }
  catch { throw new ConflictException("原检查同意收据不可读取"); }
  if (!value || row.tenantId !== scope.tenantId || row.workspaceId !== scope.workspaceId || row.orderId !== scope.orderId || row.customerId !== scope.customerId
    || value.id !== row.id || value.orderId !== row.orderId || value.workspaceId !== row.workspaceId || value.customerId !== row.customerId
    || value.preparationId !== row.preparationId || value.operationKey !== row.operationKey || value.requestHash !== row.requestHash
    || value.revision !== 1 || value.state !== "confirmed" || value.scope !== "specific_exchange_inspection_and_handover" || value.retryable !== false
    || !Number.isFinite(Date.parse(value.confirmedAt)) || !Number.isFinite(Date.parse(value.expectedOrderUpdatedAt))
    || !validExchangeInspectionHash(value.preparationHash) || !validExchangeInspectionHash(value.materialHash) || requestFingerprint(value) !== row.payloadHash) {
    throw new ConflictException("原检查同意与本人、准备和操作键不一致");
  }
  if (value.requestHash !== requestFingerprint({ orderId: value.orderId, customerId: value.customerId,
    input: { operationKey: value.operationKey, expectedRevision: 0, preparationId: value.preparationId, preparationHash: value.preparationHash,
      materialHash: value.materialHash, expectedOrderUpdatedAt: value.expectedOrderUpdatedAt, confirm: true } })) {
    throw new ConflictException("原检查同意请求指纹不一致");
  }
  return structuredClone(value);
}
