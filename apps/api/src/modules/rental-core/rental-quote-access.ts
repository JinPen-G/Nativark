/** 原HTTP组合供给Auth/ALS身份；报价范围裁定由同一Rental规则执行。 */
import { currentQuoteSource as coreCurrentQuoteSource, assertQuoteReadAccess as coreAssertQuoteReadAccess } from "@rental-os/rental-core/quote-access";
import type { RentalQuoteSnapshotV1, RentalQuoteSourceSnapshot } from "@rental-os/rental-core";
import { getRequestIdentity, getRequestLocationIds } from "../../common/request-identity";

const quoteContext = { getRequestIdentity, getRequestLocationIds };

export function currentQuoteSource(tenantId: string): RentalQuoteSourceSnapshot | undefined {
  return coreCurrentQuoteSource(tenantId, quoteContext);
}

export function assertQuoteReadAccess(quote: RentalQuoteSnapshotV1): void {
  coreAssertQuoteReadAccess(quote, quoteContext);
}
