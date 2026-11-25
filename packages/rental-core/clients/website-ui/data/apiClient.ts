/** 官网宿主供给原 VITE_API_BASE，公开请求与合同由 Rental 客户端单源维护。 */
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

export { API_BASE, clientApi } from "../host";
