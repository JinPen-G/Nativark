/** 原客户运输供给当前会话与范围，业务请求由 Rental 小程序工厂维护。 */
import { createRentalMiniProgramCatalogApi } from "@rental-os/rental-core/clients/miniprogram";
import { request } from "../core/http";
import { PUBLIC_CONFIG } from "../config/public";
import { contractMissing, featureUnavailable } from "../contracts/planned";

export const {
  fetchCatalog,
  fetchPublicCatalog,
  checkAvailability,
  createQuote,
  fetchQuote,
  fetchCoupons,
} = createRentalMiniProgramCatalogApi({ request, publicConfig: PUBLIC_CONFIG, contractMissing, featureUnavailable });
