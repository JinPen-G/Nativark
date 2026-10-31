/** Validate Core's preview without recalculation, snapshot replacement or writes.
 * The original request service still owns order/scope authorization. Invalid
 * observations are unavailable, not evidence of a failed business execution. */
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AI_EXTENSION_PREVIEW_HTTP_SCHEMAS, AI_SCOPE_DRAFT_SCHEMAS, AI_SCENE_REQUEST_DRAFT_SCHEMAS,
  type RentalOrderExtensionPreview, type AiSceneOrderExtensionPreviewDraft,
  type AiSceneOrderExtensionPreviewResponseDraft } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv);
for (const [name, schema] of Object.entries({ ...AI_EXTENSION_PREVIEW_HTTP_SCHEMAS, ...AI_SCOPE_DRAFT_SCHEMAS,
  AiSceneRequestReceiptDraft: AI_SCENE_REQUEST_DRAFT_SCHEMAS.AiSceneRequestReceiptDraft })) ajv.addSchema(schema, `#/components/schemas/${name}`);
const coreSchema = ajv.getSchema<RentalOrderExtensionPreview>('#/components/schemas/AiCoreExtensionPreviewDraft')!;
const responseSchema = ajv.getSchema<AiSceneOrderExtensionPreviewResponseDraft>('#/components/schemas/AiSceneOrderExtensionPreviewResponseDraft')!;

// Match JSON omission of optional undefined properties, but never stringify
// non-finite numbers into null or custom objects into a different payload.
function wire(value: unknown, depth = 0): unknown {
  if (depth > 32) throw Error('snapshot depth');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => wire(item, depth + 1));
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw Error('snapshot value');
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('snapshot key');
    return [key, wire(child, depth + 1)];
  }));
}
const sameTime = (a: string, b: string) => Date.parse(a) === Date.parse(b);
function checkedCore(value: unknown, orderId: string, newEndAt: string): RentalOrderExtensionPreview {
  const snapshot = wire(value);
  if (!coreSchema(snapshot)) throw Error('preview shape');
  const copy = snapshot as RentalOrderExtensionPreview;
  if (copy.orderId !== orderId || !sameTime(copy.newEndAt, newEndAt)
    || copy.executionBasis?.incrementalPricing && (copy.executionBasis.pricingMode !== 'incremental' || copy.pricingSnapshot
      || !sameTime(copy.executionBasis.incrementalPricing.startAt, copy.originalEndAt)
      || !sameTime(copy.executionBasis.incrementalPricing.endAt, copy.newEndAt))
    || Buffer.byteLength(JSON.stringify(copy), 'utf8') > 131072) throw Error('preview binding');
  return copy;
}
export function validateAiCoreExtensionPreview(value: unknown, orderId: string, newEndAt: string): RentalOrderExtensionPreview {
  try { return checkedCore(value, orderId, newEndAt); }
  catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
}
export function validateAiExtensionPreviewResponse(value: unknown,
  command: AiSceneOrderExtensionPreviewDraft): AiSceneOrderExtensionPreviewResponseDraft {
  try {
    const snapshot = wire(value);
    if (!responseSchema(snapshot)) throw Error('response shape');
    const copy = snapshot as AiSceneOrderExtensionPreviewResponseDraft;
    if (copy.original.sceneCode !== 'order_explanation' || copy.original.state !== 'stored'
      || copy.original.inputRef !== command.inputRef || copy.original.draftVersion !== command.draftVersion
      || copy.result.source.orderVersion !== command.expectedOrderVersion
      || copy.result.source.inputFingerprint !== requestFingerprint(command.extension)) throw Error('original binding');
    if (copy.result.status === 'previewed') {
      const preview = checkedCore(copy.result.preview, copy.result.orderId, command.extension.newEndAt), scope = copy.result.scope;
      if (preview.serviceSnapshots?.some(row => row.workspaceId !== scope.workspaceId)
        || preview.pricingSnapshot?.context.calendars.some(row => row.tenantId !== scope.tenantId)
        || preview.executionBasis?.incrementalPricing?.context.calendars.some(row => row.tenantId !== scope.tenantId)
        || preview.pricingSnapshot?.discountEvaluations.some(row => row.workspaceId !== scope.workspaceId
          || row.planSnapshot && row.planSnapshot.tenantId !== scope.tenantId)) throw Error('snapshot scope');
    }
    return copy;
  } catch { throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE'); }
}
