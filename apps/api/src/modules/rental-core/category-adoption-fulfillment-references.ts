/** Inputs are freshly read from the same adopting tenant/space transaction.
 * Paused operators/locations remain legitimate configuration, not readiness. */
export function categoryAdoptionFulfillmentReferences(input: {
  locations: Array<{ id: string; status: string; operatorId: string | null; parentLocationId: string | null; capabilities: unknown }>;
  operators: Array<{ id: string }>;
}) {
  const operators = new Set(input.operators.map((row) => row.id));
  const locations = new Set(input.locations.map((row) => row.id));
  const blockers: Array<{ domain: "fulfillment_reference"; id: string; message: string }> = [];
  for (const location of input.locations) {
    if (location.status !== "enabled") continue;
    if (!location.operatorId || !operators.has(location.operatorId)) blockers.push({ domain: "fulfillment_reference", id: location.id, message: "启用地点所属运营方不存在或不属于当前空间，请通过履约地点配置处理" });
    if (location.parentLocationId && (location.parentLocationId === location.id || !locations.has(location.parentLocationId))) blockers.push({ domain: "fulfillment_reference", id: location.id, message: "启用地点的父地点不能是自身或空间外地点，请通过履约地点配置处理" });
    // Match SaveRentalFulfillmentLocationDto's executable capability vocabulary.
    if (!Array.isArray(location.capabilities) || !location.capabilities.length || location.capabilities.some((code) => !["pickup", "return", "storage", "delivery"].includes(code))) blockers.push({ domain: "fulfillment_reference", id: location.id, message: "启用地点须配置有效的取还、存储或配送能力，请通过履约地点配置处理" });
  }
  return { valid: blockers.length === 0, blockers, complete: false as const };
}
