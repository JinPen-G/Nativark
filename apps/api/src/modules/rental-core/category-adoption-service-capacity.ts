import type { RentalCategoryDefinition } from "@rental-os/shared";

/** Read scoped configuration in the adopting transaction. Reservation/history
 * counters are deliberately not rewritten or used as adoption prerequisites. */
export function categoryAdoptionServiceCapacity(target: RentalCategoryDefinition, input: {
  services: Array<{ id: string; status: string; requiresCapacity: boolean }>;
  locations: Array<{ id: string; type: string }>;
  capacities: Array<{ id: string; serviceId: string; locationId: string; status: string; windowEnd: Date }>;
}, now: Date) {
  const services = new Map(input.services.map((row) => [row.id, row]));
  const locations = new Map(input.locations.map((row) => [row.id, row]));
  const blockers: Array<{ domain: "service_capacity"; id: string; message: string }> = [];
  for (const capacity of input.capacities) {
    if (capacity.status !== "enabled" || capacity.windowEnd <= now) continue;
    const service = services.get(capacity.serviceId);
    // Disabled/non-capacity services cannot create new capacity occurrences;
    // their existing reservations remain governed by order snapshots.
    if (service && (service.status !== "enabled" || !service.requiresCapacity)) continue;
    const location = locations.get(capacity.locationId);
    if (!service || !location || !target.businessModel.locationTypes.includes(location.type as typeof target.businessModel.locationTypes[number])) {
      blockers.push({ domain: "service_capacity", id: capacity.id, message: "可执行服务容量引用的服务或地点不属于当前空间，或目标品类不支持该地点类型，请通过容量配置处理" });
    }
  }
  return { valid: blockers.length === 0, blockers, complete: false as const, scope: "scoped_executable_service_capacity_locations" };
}
