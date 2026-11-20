/** 原目录入口。绑定同一 Core 缓存与搜索状态，媒体、金额、地点和会话由宿主供给。 */
import { createRentalMiniProgramCatalogStore } from "@rental-os/rental-core/clients/miniprogram";
import { fetchCatalog, fetchPublicCatalog } from "../api/catalog";
import { distanceMeters } from "./geo";
import { resolveImage } from "./images";
import { startingPriceParts } from "./money";
import { contextVersion, currentServiceCode, isSignedIn } from "./session";
import { rememberZone } from "./zones";

const catalog = createRentalMiniProgramCatalogStore({
  catalog: { fetchCatalog, fetchPublicCatalog },
  contextVersion, currentServiceCode, isSignedIn,
  now: () => Date.now(),
  rememberZone, resolveImage, distanceMeters, startingPriceParts,
});

export const {
  cachedCatalog,
  loadCatalog,
  invalidateCatalog,
  setPendingSearch,
  takePendingSearch,
  brandOf,
  listAttribute,
  specsOf,
  specEntries,
  catalogPricingUnitLabel,
  toItemCard,
  facetsOf,
  searchItems,
  pricingOptionsFor,
  primaryLocation,
  nearestLocation,
  hydrateImages,
} = catalog;
export type { ItemCard } from "@rental-os/rental-core/clients/miniprogram";
