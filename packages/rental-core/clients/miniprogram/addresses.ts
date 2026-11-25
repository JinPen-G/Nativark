/** 本人地址簿请求，归属与字段校验沿原客户运输和服务端。 */
import type {
  ClientDeliveryAddressListResponse,
  ClientDeliveryAddressRequest,
  ClientDeliveryAddressView,
} from "../../src/client-contracts";
import type { RentalMiniProgramClientPorts } from "./ports";

export function createRentalMiniProgramAddressesApi(ports: RentalMiniProgramClientPorts) {
  const { request } = ports;

  /** 本人配送地址簿（MP-06）：租户内共享，不是联系人；服务端按本人归属校验。 */
  async function listAddresses(): Promise<ClientDeliveryAddressView[]> {
    return (await request<ClientDeliveryAddressListResponse>("/profile/addresses", { scope: "tenant" })).items;
  }

  async function saveAddress(input: ClientDeliveryAddressRequest): Promise<ClientDeliveryAddressView> {
    return request<ClientDeliveryAddressView>("/profile/addresses", { method: "PUT", data: input, scope: "tenant" });
  }

  async function deleteAddress(addressId: string): Promise<void> {
    await request(`/profile/addresses/${encodeURIComponent(addressId)}`, { method: "DELETE", scope: "tenant" });
  }

  return {
    listAddresses,
    saveAddress,
    deleteAddress,
  };
}
