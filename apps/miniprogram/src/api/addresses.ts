import type { ClientDeliveryAddressListResponse, ClientDeliveryAddressRequest, ClientDeliveryAddressView } from "@rental-os/shared";
import { request } from "../core/http";

/** 本人配送地址簿（MP-06）：租户内共享，不是联系人；服务端按本人归属校验。 */
export async function listAddresses(): Promise<ClientDeliveryAddressView[]> {
  return (await request<ClientDeliveryAddressListResponse>("/profile/addresses", { scope: "tenant" })).items;
}

export async function saveAddress(input: ClientDeliveryAddressRequest): Promise<ClientDeliveryAddressView> {
  return request<ClientDeliveryAddressView>("/profile/addresses", { method: "PUT", data: input, scope: "tenant" });
}

export async function deleteAddress(addressId: string): Promise<void> {
  await request(`/profile/addresses/${encodeURIComponent(addressId)}`, { method: "DELETE", scope: "tenant" });
}
