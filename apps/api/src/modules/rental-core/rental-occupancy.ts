import type { RentalRuleConfig } from "@rental-os/shared";

/** 库存占用包含交付前准备与归还后周转；缓冲不计租金。历史快照缺省为 0。 */
export function bufferedRentalPeriod(startAt: string, endAt: string, rule?: RentalRuleConfig) {
  const before = Math.max(0, rule?.fulfillment?.pickupBufferMinutes ?? 0);
  const after = Math.max(0, rule?.fulfillment?.returnBufferMinutes ?? 0);
  return {
    startAt: new Date(new Date(startAt).getTime() - before * 60_000).toISOString(),
    endAt: new Date(new Date(endAt).getTime() + after * 60_000).toISOString()
  };
}

/** 半开区间内的最大同时占用量；前后串行的订单不能被简单求和成并发占用。 */
export function peakReservedQuantity(rows: Array<{ startAt: string; endAt: string; quantity: number }>, startAt: string, endAt: string) {
  const from = new Date(startAt).getTime();
  const to = new Date(endAt).getTime();
  const events: Array<{ at: number; delta: number }> = [];
  for (const row of rows) {
    const start = Math.max(from, new Date(row.startAt).getTime());
    const end = Math.min(to, new Date(row.endAt).getTime());
    if (start < end && row.quantity > 0) {
      events.push({ at: start, delta: row.quantity }, { at: end, delta: -row.quantity });
    }
  }
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let peak = 0;
  let current = 0;
  for (const event of events) { current += event.delta; peak = Math.max(peak, current); }
  return peak;
}
