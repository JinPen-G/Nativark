/** Rental服务端接线使用公共Auth/ALS的唯一身份；报价范围裁定由同一Rental规则执行。 */
import { currentQuoteSource as coreCurrentQuoteSource, assertQuoteReadAccess as coreAssertQuoteReadAccess } from "./quote-access";
import type { RentalQuoteSnapshotV1, RentalQuoteSourceSnapshot } from "./contracts";
import { getRequestIdentity, getRequestLocationIds } from "@rental-os/platform-server/request-identity";

const quoteContext = { getRequestIdentity, getRequestLocationIds };

export function currentQuoteSource(tenantId: string): RentalQuoteSourceSnapshot | undefined {
  return coreCurrentQuoteSource(tenantId, quoteContext);
}

export function assertQuoteReadAccess(quote: RentalQuoteSnapshotV1): void {
  coreAssertQuoteReadAccess(quote, quoteContext);
}
