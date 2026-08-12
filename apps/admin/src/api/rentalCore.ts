import type {
  CreateRentalInspectionRequest,
  CreateRentalOrderRequest,
  RentalAsset,
  RentalAvailabilityRequest,
  RentalAvailabilityResult,
  RentalCategoryDefinition,
  RentalFulfillmentLocation,
  RentalInspectionRecord,
  RentalInspectionTemplate,
  RentalItemGroup,
  RentalOrder,
  RentalStockBalance,
  SaveRentalAssetRequest,
  SaveRentalItemGroupRequest,
  SaveRentalStockBalanceRequest,
  SaveTenantRentalProfileRequest,
  TenantRentalProfile
} from "@store-rental/shared";
import { request } from "./http";

export const rentalCoreApi = {
  categories: () => request<RentalCategoryDefinition[]>("/rental/v1/categories"),
  profile: () => request<TenantRentalProfile>("/rental/v1/tenant-profile"),
  saveProfile: (data: SaveTenantRentalProfileRequest) => request<TenantRentalProfile>("/rental/v1/tenant-profile", { method: "put", data }),
  locations: () => request<RentalFulfillmentLocation[]>("/rental/v1/locations"),
  itemGroups: () => request<RentalItemGroup[]>("/rental/v1/item-groups"),
  saveItemGroup: (data: SaveRentalItemGroupRequest) => request<RentalItemGroup>(data.id ? `/rental/v1/item-groups/${data.id}` : "/rental/v1/item-groups", { method: data.id ? "put" : "post", data }),
  assets: () => request<RentalAsset[]>("/rental/v1/assets"),
  saveAsset: (data: SaveRentalAssetRequest) => request<RentalAsset>(data.id ? `/rental/v1/assets/${data.id}` : "/rental/v1/assets", { method: data.id ? "put" : "post", data }),
  stockBalances: () => request<RentalStockBalance[]>("/rental/v1/stock-balances"),
  saveStockBalance: (data: SaveRentalStockBalanceRequest) => request<RentalStockBalance>("/rental/v1/stock-balances", { method: "put", data }),
  availability: (data: RentalAvailabilityRequest) => request<RentalAvailabilityResult>("/rental/v1/availability", { method: "post", data }),
  orders: () => request<RentalOrder[]>("/rental/v1/orders"),
  order: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}`),
  createOrder: (data: CreateRentalOrderRequest) => request<RentalOrder>("/rental/v1/orders", { method: "post", data }),
  confirmOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/confirm`, { method: "post" }),
  allocateOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/allocate`, { method: "post" }),
  cancelOrder: (id: string) => request<RentalOrder>(`/rental/v1/orders/${id}/cancel`, { method: "post" }),
  inspectionTemplates: (stage?: "pickup" | "return") => request<RentalInspectionTemplate[]>("/rental/v1/inspection-templates", { params: { stage } }),
  inspections: (id: string) => request<RentalInspectionRecord[]>(`/rental/v1/orders/${id}/inspections`),
  createInspection: (id: string, data: CreateRentalInspectionRequest) => request<{ inspection: RentalInspectionRecord; order: RentalOrder }>(`/rental/v1/orders/${id}/inspections`, { method: "post", data })
};
