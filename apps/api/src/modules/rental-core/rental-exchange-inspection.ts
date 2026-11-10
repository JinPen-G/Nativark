import { ConflictException } from "@nestjs/common";
import type { RentalAllocation, RentalInspectionTemplate, RentalOrder, RentalOrderChange, RentalOrderExchangeExecutionBasis } from "@rental-os/shared";
import { requestFingerprint } from "./rental-idempotency.repository";

/** Binds displayed pickup requirements to the unchanged order and actual target.
 * Not a permission token or an assertion that inspection has been performed. */
export function exchangePickupInspectionRequirements(input: {
  orderId: string; expectedUpdatedAt: string; orderLineId: string; allocationId: string;
  replacementItemGroupId: string; replacementAssetId?: string; locationId: string;
  basis: RentalOrderExchangeExecutionBasis;
}) {
  const templates = input.basis.inspectionTemplateSnapshots.filter(template => template.enabled && template.stage === "pickup");
  const required = input.basis.ruleSnapshot.fulfillment?.pickupInspectionRequired === true;
  return { required, templates: structuredClone(templates), confirmationHash: requestFingerprint({
    orderId: input.orderId, expectedUpdatedAt: input.expectedUpdatedAt, orderLineId: input.orderLineId,
    allocationId: input.allocationId, replacementItemGroupId: input.replacementItemGroupId,
    replacementAssetId: input.replacementAssetId, locationId: input.locationId,
    categoryCode: input.basis.categoryCode, categoryVersionId: input.basis.categoryVersionId,
    required, evidenceRequired: input.basis.ruleSnapshot.fulfillment?.evidenceRequired, templates
  }) };
}

export function exchangeBasis(change: RentalOrderChange): RentalOrderExchangeExecutionBasis | undefined {
  const exchange = change.diff.exchange as { executionBasis?: RentalOrderExchangeExecutionBasis } | undefined;
  return change.type === "post_pickup_exchange" && change.status === "applied" ? exchange?.executionBasis : undefined;
}

/** One applicability algorithm for both full business templates and narrow R0
 * references. The latter never fabricates fields, prices or a full aggregate. */
export function projectExchangeInspectionTemplates<T extends Pick<RentalInspectionTemplate, "id" | "stage" | "enabled"> & { name?: string }>(
  allocations: Array<Pick<RentalAllocation, "id" | "status" | "itemGroupId"> & { metadata?: { exchangeId?: string; itemGroupName?: string } }>,
  originals: T[], changes: Array<{ id: string; type: string; status: string; templateRefs?: T[] }>
): Array<T & Pick<RentalInspectionTemplate, "allocationIds" | "sourceTemplateId" | "exchangeId">> {
  const active = allocations.filter((row) => row.status === "picked_up" || (row.status === "locked" && row.metadata?.exchangeId));
  const exchanged = active.filter((row) => row.metadata?.exchangeId);
  if (!exchanged.length) return structuredClone(originals);
  const oldIds = active.filter((row) => !row.metadata?.exchangeId).map((row) => row.id);
  const result: Array<T & Pick<RentalInspectionTemplate, "allocationIds" | "sourceTemplateId" | "exchangeId">> = originals
    .filter((row) => row.stage !== "return" || oldIds.length).map((row) => ({
      ...structuredClone(row), ...(row.stage === "return" ? { allocationIds: oldIds } : {})
    }));
  for (const allocation of exchanged) {
    const change = changes.find((row) => row.id === allocation.metadata?.exchangeId);
    if (!change || change.type !== "post_pickup_exchange" || change.status !== "applied" || !change.templateRefs)
      throw new ConflictException("换货商品缺少独立检查依据，需人工核对，不能套用原商品或当前模板");
    for (const template of change.templateRefs.filter((row) => row.stage === "return" && row.enabled)) {
      result.push({ ...structuredClone(template), id: `exchange:${allocation.id}:${template.id}`,
        ...(typeof template.name === "string" ? { name: `${template.name} · ${allocation.metadata?.itemGroupName ?? allocation.itemGroupId}` } : {}),
        sourceTemplateId: template.id, allocationIds: [allocation.id], exchangeId: change.id });
    }
  }
  return result;
}

/** Project immutable evidence onto currently returnable resources, never overwrite the order snapshot. */
export function exchangeInspectionTemplates(order: RentalOrder, originals: RentalInspectionTemplate[], changes: RentalOrderChange[]): RentalInspectionTemplate[] {
  return projectExchangeInspectionTemplates(order.allocations, originals, changes.map(change => ({
    id: change.id, type: change.type, status: change.status,
    get templateRefs() { return exchangeBasis(change)?.inspectionTemplateSnapshots; }
  })));
}

export function assertInspectionAllocationScope(template: RentalInspectionTemplate, allocationIds: string[]) {
  if (template.stage !== "return" || template.allocationIds === undefined) return;
  if (!allocationIds.length || allocationIds.some((id) => !template.allocationIds!.includes(id))) {
    throw new ConflictException("本批商品的检查依据不同，请按商品分批检查，不能共用或绕过换货检查模板");
  }
}
