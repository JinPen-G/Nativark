/** 员工客户与会员薄入口，原员工运输保留租户级授权范围与脱敏响应。 */
import { createRentalStaffCustomersApi } from "@rental-os/rental-core/clients/staff";
import { request } from "../core/http";

export { matchCustomer } from "@rental-os/rental-core/clients/staff";

export const {
  listCustomers,
  getCustomer,
  createCustomer,
  updatePersonalCustomer,
  updateCorporateCustomer,
} = createRentalStaffCustomersApi({ request });
