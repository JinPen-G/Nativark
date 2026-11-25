/** 履约地点、经营主体与品类读取沿原 Rental 请求，组织目录复用公共设置客户端。 */
import type {
  RentalCategoryDefinition,
  RentalFulfillmentLocation,
  RentalFulfillmentOperator,
  SaveRentalFulfillmentLocationRequest,
  SaveRentalFulfillmentOperatorRequest,
} from "@rental-os/rental-core";
import type { AdminRequestOptions, AdminRuntime } from "@rental-os/platform-admin/runtime";
import { createPlatformSettingsApi } from "@rental-os/platform-admin/platform-settings/client";
import { createRentalOrderApi } from "../orders/client";

type ReadOptions = Pick<AdminRequestOptions, "signal">;

export function createRentalLocationApi(request: AdminRuntime["request"]) {
  const { profile, locations } = createRentalOrderApi(request);
  const platform = createPlatformSettingsApi(request);
  return {
    profile,
    locations,
    categories: (options?: ReadOptions) =>
      request<RentalCategoryDefinition[]>(
        "/rental/v1/categories",
        options?.signal ? { signal: options.signal } : undefined,
      ),
    operators: (options?: ReadOptions) =>
      request<RentalFulfillmentOperator[]>(
        "/rental/v1/fulfillment-operators",
        options?.signal ? { signal: options.signal } : undefined,
      ),
    organizations: (options?: ReadOptions) => platform.organizations(options?.signal),
    saveOperator: (data: SaveRentalFulfillmentOperatorRequest) =>
      request<RentalFulfillmentOperator>(
        data.id ? "/rental/v1/fulfillment-operators/" + data.id : "/rental/v1/fulfillment-operators",
        { method: data.id ? "put" : "post", data },
      ),
    saveLocation: (data: SaveRentalFulfillmentLocationRequest) =>
      request<RentalFulfillmentLocation>(
        data.id ? "/rental/v1/locations/" + data.id : "/rental/v1/locations",
        { method: data.id ? "put" : "post", data },
      ),
  };
}

export type RentalLocationApi = ReturnType<typeof createRentalLocationApi>;
