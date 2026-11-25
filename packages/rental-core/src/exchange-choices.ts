/** 当前订单换货候选的唯一合同；由受权应用投影，候选可用不等于预留、批准或执行。 */
export interface EnterpriseExchangeChoicesQuery {
  allocationId?: string;
  replacementItemGroupId?: string;
}
/** Current candidates only; availability is not a reservation or expense approval. */
export interface EnterpriseExchangeChoices {
  orderId: string;
  orderNo: string;
  expectedOrderUpdatedAt: string;
  workspaceId: string;
  applicantCustomerId: string;
  lines: Array<{ orderLineId: string; allocationId: string; itemGroupId: string; itemGroupName: string; quantity: number; assetNo?: string }>;
  replacements: Array<{ itemGroupId: string; name: string; inventoryMode: "serialized" | "quantity"; pricingGroups: Array<{ id: string; name: string }> }>;
  assets: Array<{ assetId: string; assetNo: string }>;
  selectedAllocationId?: string;
  selectedReplacementItemGroupId?: string;
  reservation: "not_reserved";
}
