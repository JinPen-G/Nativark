import { ConflictException } from "@nestjs/common";
import type { RentalInspectionTemplate, RentalOrder, RentalOrderChange, RentalOrderExchangeExecutionBasis } from "@rental-os/shared";

export function exchangeBasis(change: RentalOrderChange): RentalOrderExchangeExecutionBasis | undefined {
  const exchange = change.diff.exchange as { executionBasis?: RentalOrderExchangeExecutionBasis } | undefined;
  return change.type === "post_pickup_exchange" && change.status === "applied" ? exchange?.executionBasis : undefined;
}

/** Project immutable evidence onto currently returnable resources, never overwrite the order snapshot. */
export function exchangeInspectionTemplates(order: RentalOrder, originals: RentalInspectionTemplate[], changes: RentalOrderChange[]): RentalInspectionTemplate[] {
  const active = order.allocations.filter((row) => row.status === "picked_up" || (row.status === "locked" && row.metadata?.exchangeId));
  const exchanged = active.filter((row) => row.metadata?.exchangeId);
  if (!exchanged.length) return structuredClone(originals);
  const oldIds = active.filter((row) => !row.metadata?.exchangeId).map((row) => row.id);
  const result = originals.filter((row) => row.stage !== "return" || oldIds.length).map((row) => ({
    ...structuredClone(row), ...(row.stage === "return" ? { allocationIds: oldIds } : {})
  }));
  for (const allocation of exchanged) {
    const change = changes.find((row) => row.id === allocation.metadata?.exchangeId);
    const basis = change && exchangeBasis(change);
    if (!basis) throw new ConflictException("换货商品缺少独立检查依据，需人工核对，不能套用原商品或当前模板");
    for (const template of basis.inspectionTemplateSnapshots.filter((row) => row.stage === "return" && row.enabled)) {
      result.push({ ...structuredClone(template), id: `exchange:${allocation.id}:${template.id}`,
        name: `${template.name} · ${allocation.metadata?.itemGroupName ?? allocation.itemGroupId}`,
        sourceTemplateId: template.id, allocationIds: [allocation.id], exchangeId: change!.id });
    }
  }
  return result;
}

export function assertInspectionAllocationScope(template: RentalInspectionTemplate, allocationIds: string[]) {
  if (template.stage !== "return" || template.allocationIds === undefined) return;
  if (!allocationIds.length || allocationIds.some((id) => !template.allocationIds!.includes(id))) {
    throw new ConflictException("本批商品的检查依据不同，请按商品分批检查，不能共用或绕过换货检查模板");
  }
}
