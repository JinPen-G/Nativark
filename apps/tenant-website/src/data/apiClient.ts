/** 官网宿主供给原 VITE_API_BASE，公开请求与合同由 Rental 客户端单源维护。 */
import { createRentalWebsitePublicClient } from "@rental-os/rental-core/clients/website";
export {
  ApiError,
  type BootstrapWebsite,
  type PublicDocumentResponse,
  type BootstrapResponse,
  type CatalogItem,
  type CatalogPricingGroup,
  type PublicCatalogResponse,
  type PublicAvailabilityRequest,
  type PublicAvailabilityResponse,
} from "@rental-os/rental-core/clients/website";

const API_BASE_RAW = import.meta.env.VITE_API_BASE ?? "";
/** 原网关基址供现有认证及业务消费者复用。 */
export const API_BASE = API_BASE_RAW.replace(/\/$/, "");
export const clientApi = createRentalWebsitePublicClient(API_BASE_RAW);
