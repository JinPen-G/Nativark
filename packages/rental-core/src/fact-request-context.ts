/** 宿主供给原服务端当前身份与范围。这里只声明Core使用的字段，不投影或改写原完整上下文。 */
export interface RentalFactIdentity {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  isSaasAdmin?: boolean;
  audience?: "operator" | "staff" | "client";
  dataScope?: "all" | "organization" | "store" | "own";
}

export interface RentalFactRequestContext {
  /** 返回原完整已验证上下文，冻结指纹和前后复验保留其所有字段。 */
  getRequestIdentity(): RentalFactIdentity | undefined;
  getRequestDataScope(): RentalFactIdentity["dataScope"];
  getRequestLocationIds(): string[] | undefined;
  getRequestUserId(): string | undefined;
  getRequestWorkspaceId(): string | undefined;
}
