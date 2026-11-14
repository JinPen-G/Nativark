/** Reads the original Core inspection/handover/partial-return receipt without
 * replaying the write, uploading a signature or acquiring an operation lock.
 * Current staff order/location access and the immutable receipt are rechecked;
 * absent or damaged evidence remains unknown, even after the original TTL. */
import { z } from 'zod';
import { STAFF_FULFILLMENT_RECEIPT_VERSION, staffFulfillmentReceiptRequest, staffFulfillmentReceiptObservation,
  type StaffFulfillmentReceiptRequest, type StaffFulfillmentReceiptObservation, RentalCoreOrderStatus } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { RentalIdempotencyRepository } from '../../rental-core/rental-idempotency.repository';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiOrderRouteContextAuthority, type AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { InspectionAssistError } from './inspection-assist.validation';

const identifier = z.string().min(1).max(191);
const inspection = z.object({ id: identifier, tenantId: identifier, orderId: identifier,
  stage: z.enum(['pickup', 'return']), templateId: identifier, templateVersion: identifier });
const recordedOrder = z.object({ id: identifier, tenantId: identifier, status: z.nativeEnum(RentalCoreOrderStatus) });
type Dependencies = { guard: Pick<ApiAuthGuard, 'canActivate'>; credentials: AiOrderRouteCredentialSource;
  core: Pick<RentalCoreService, 'getOrder'> & Partial<Pick<RentalCoreService, 'listInspections'>>;
  receipts: Pick<RentalIdempotencyRepository, 'find'> };
const binding = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));

export class OriginalStaffFulfillmentReceiptReader {
  constructor(private readonly dependencies: Dependencies) {}

  async read(value: unknown): Promise<StaffFulfillmentReceiptObservation> {
    const parsed = staffFulfillmentReceiptRequest.safeParse(structuredClone(value));
    if (!parsed.success) throw new InspectionAssistError('INVALID_INPUT');
    const query = parsed.data, d = this.dependencies;
    if (typeof d.receipts?.find !== 'function' || typeof d.core?.getOrder !== 'function')
      throw new InspectionAssistError('STORAGE_UNAVAILABLE');
    const authority = new AiOrderRouteContextAuthority(d.guard, d.credentials, query.orderId);
    const action = query.kind === 'inspection' ? 'order.inspection' : query.kind === 'handover' ? 'order.handover' : 'order.partial-return';
    const observe = () => authority.withOrderRead(async context => {
      if (context.audience !== 'staff' || context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || !('access' in context))
        throw new InspectionAssistError('ACCESS_DENIED');
      const order = await d.core.getOrder(context.scope.tenantId, query.orderId);
      const location = query.stage === 'pickup' ? order.fulfillmentLocationId : order.returnLocationId ?? order.fulfillmentLocationId;
      const locations = context.access.locationScope;
      if (order.id !== query.orderId || order.tenantId !== context.scope.tenantId || !location
        || !locations || locations.mode === 'selected' && !locations.locationIds.includes(location))
        throw new InspectionAssistError('ACCESS_DENIED');
      const access = { scope: context.scope, actor: context.actor, audience: context.audience, access: context.access, location };
      const original = await d.receipts.find(context.scope.tenantId, action, query.operationKey);
      if (!original) return { access, evidence: null, receipt: null };
      if (original.orderId !== query.orderId || original.status !== 'succeeded'
        || !/^[a-f0-9]{64}$/u.test(original.requestHash)) throw new InspectionAssistError('BINDING_CHANGED');
      const receipt = await this.receipt(query, context.scope.tenantId, original.response);
      return { access, evidence: binding(original), receipt };
    });
    const first = await observe(), last = await observe();
    if (binding(first.access) !== binding(last.access)) throw new InspectionAssistError('ACCESS_DENIED');
    if (first.evidence !== last.evidence || binding(first.receipt) !== binding(last.receipt))
      throw new InspectionAssistError('RECONCILIATION_REQUIRED');
    const semantics = { version: STAFF_FULFILLMENT_RECEIPT_VERSION, original: query,
      execution: 'read_only_no_submission' as const, automaticRetry: false as const };
    return staffFulfillmentReceiptObservation.parse(last.receipt
      ? { ...semantics, state: 'committed', receipt: last.receipt }
      : { ...semantics, state: 'unknown', receipt: null });
  }

  private async receipt(query: StaffFulfillmentReceiptRequest, tenantId: string, response: unknown) {
    if (query.kind === 'inspection') {
      const parsed = z.object({ inspection, order: recordedOrder }).safeParse(response);
      if (!parsed.success || parsed.data.order.id !== query.orderId || parsed.data.order.tenantId !== tenantId
        || parsed.data.inspection.orderId !== query.orderId || parsed.data.inspection.tenantId !== tenantId
        || parsed.data.inspection.stage !== query.stage || parsed.data.inspection.templateId !== query.templateId)
        throw new InspectionAssistError('BINDING_CHANGED');
      if (typeof this.dependencies.core.listInspections !== 'function') throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      const rows = await this.dependencies.core.listInspections(tenantId, query.orderId);
      const original = rows.filter(row => row.id === parsed.data.inspection.id);
      if (original.length !== 1 || !inspection.safeParse(original[0]).success
        || binding(inspection.parse(original[0])) !== binding(parsed.data.inspection))
        throw new InspectionAssistError('BINDING_CHANGED');
      return { orderId: query.orderId, inspectionId: parsed.data.inspection.id };
    }
    const parsed = recordedOrder.safeParse(response);
    const expected = query.kind === 'handover' && query.stage === 'return' ? RentalCoreOrderStatus.Settling : RentalCoreOrderStatus.Renting;
    if (!parsed.success || parsed.data.id !== query.orderId || parsed.data.tenantId !== tenantId || parsed.data.status !== expected)
      throw new InspectionAssistError('BINDING_CHANGED');
    // The committed snapshot belongs to this fixed action/key; today's status
    // may have advanced. Never use today's status to recreate the old action.
    return { orderId: query.orderId };
  }
}
