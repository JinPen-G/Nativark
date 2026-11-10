import { ConflictException } from "@nestjs/common";
import type { RentalQuoteSnapshotV1 } from "@rental-os/shared";

/** Read the original per-request rental charge. Target totals are discount
 * bases, so they cannot stand in for one order line sharing that target. */
export function quoteRentalLineSource(quote: RentalQuoteSnapshotV1, index: number) {
  const request = quote.request.lines[index];
  if (!request) throw new ConflictException("原报价缺少对应商品行");
  const charges = quote.chargeLines.filter(row => row.type === "rental");
  // The producer appends one rental charge per request, in request order. Do
  // not infer an allocation from an aggregated or incomplete legacy charge.
  if (charges.length !== quote.request.lines.length || charges.some(row => !Number.isFinite(row.amount) || row.amount < 0)) {
    throw new ConflictException("原报价逐行租金明细不完整，不能按定价组总额分摊");
  }
  return { request, charge: charges[index] };
}
