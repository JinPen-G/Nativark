/** 原客户运输供给当前会话与范围，业务请求由 Rental 小程序工厂维护。 */
import { createRentalMiniProgramMerchantApi } from "@rental-os/rental-core/clients/miniprogram";
import { request } from "../core/http";
import { PUBLIC_CONFIG } from "../config/public";
import { contractMissing } from "../contracts/planned";
export type { PublicServicesResponse } from "@rental-os/rental-core/clients/miniprogram";

export const {
  listPublicServices,
  fetchBootstrap,
  fetchPublicDocument,
  fetchConfig,
} = createRentalMiniProgramMerchantApi({ request, publicConfig: PUBLIC_CONFIG, contractMissing });
