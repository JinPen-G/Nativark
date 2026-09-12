import { createHash } from "node:crypto";
import type { RentalOrderServiceOccurrence, RentalQuoteServiceSnapshot } from "@store-rental/shared";

/**
 * 服务容量预留的幂等键（MKT-02C）。
 *
 * 抽成纯函数是因为它有两个使用者：容量服务用它建/查预留行，订单聚合用它把一次服务
 * 发生项和自己那条预留精确配对。两处各写一遍就会分叉，配对随即失效。
 *
 * 键里带时段与地点：同一服务在不同时段、不同地点是不同的占用，不能共用一条预留。
 */
export function serviceReservationKey(requestKey: string, snapshot: Pick<RentalQuoteServiceSnapshot, "serviceId" | "serviceLocationId" | "scheduledStartAt" | "scheduledEndAt">) {
  const digest = createHash("sha256")
    .update([requestKey, snapshot.serviceId, snapshot.serviceLocationId, snapshot.scheduledStartAt, snapshot.scheduledEndAt].join("|"))
    .digest("hex");
  return `service-capacity:${digest}`;
}

/** 续租占容量时用的 requestKey。与 `occurrenceIdOf` 同源，保证键随续租而不是随服务。 */
export function extensionRequestKey(extensionId: string) {
  return `extension:${extensionId}`;
}

/**
 * 发生项的稳定标识。
 *
 * 带序号是因为同一次续租里同一个服务仍可能出现两条（例如两个不同时段），
 * 只用 serviceId 会让它们互相覆盖——这正是 MKT-02C 要修的那类覆盖。
 */
export function occurrenceIdOf(origin: "order" | "extension", ownerId: string, serviceId: string, index: number) {
  return `${origin}:${ownerId}:${serviceId}:${index}`;
}

/**
 * 把一批服务快照标成同一来源的发生项。
 *
 * 幂等：id 由 (来源, 归属 id, serviceId, 序号) 决定，同一请求重复执行得到同一批 id，
 * 因此 `appendOccurrences` 能靠 id 去重而不是再造一条。
 */
export function stampOccurrences(
  snapshots: RentalQuoteServiceSnapshot[],
  source: { origin: "order" | "extension"; ownerId: string; requestKey: string; extensionId?: string; extensionSequence?: number }
): RentalOrderServiceOccurrence[] {
  return snapshots.map((snapshot, index) => ({
    ...snapshot,
    occurrenceId: occurrenceIdOf(source.origin, source.ownerId, snapshot.serviceId, index),
    origin: source.origin,
    extensionId: source.extensionId,
    extensionSequence: source.extensionSequence,
    // MKT-02D：实际履约必须由运营动作明确推进，不能由计划时间或归还时间自动完成。
    executionStatus: "not_started",
    executedQuantity: 0,
    executionSegments: [],
    // 不需要容量的服务没有预留行，也就没有容量依据可挂。
    reservationKey: snapshot.requiresCapacity ? serviceReservationKey(source.requestKey, snapshot) : undefined
  }));
}

/**
 * 追加服务发生项。**只追加、不按 serviceId 覆盖**。
 *
 * 同 `occurrenceId` 视为同一次发生的重复提交（网络重试或幂等回放），保留既有那条，
 * 不重复计一次履约承诺、也不重复占容量。
 */
export function appendOccurrences(
  existing: RentalOrderServiceOccurrence[] | undefined,
  incoming: RentalOrderServiceOccurrence[]
): RentalOrderServiceOccurrence[] {
  const result = [...(existing ?? [])];
  const seen = new Set(result.map((row) => row.occurrenceId).filter((value): value is string => Boolean(value)));
  for (const row of incoming) {
    if (row.occurrenceId && seen.has(row.occurrenceId)) continue;
    if (row.occurrenceId) seen.add(row.occurrenceId);
    result.push(row);
  }
  return result;
}
