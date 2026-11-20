/** 原客户Auth验证后供给的服务端上下文；字段保留原客户/空间合同，不能由请求体或缓存自行建立授权。 */
export interface ClientRequestContext {
  tenantId: string;
  tenantCode: string;
  customerId: string;
  customerType: "personal" | "corporate";
  displayName: string;
  phone: string;
  workspaceId: string;
  workspaceCode: string;
  workspaceName: string;
  categoryCode: string;
  membershipStatus: string;
  sessionId: string;
  /** 会话绑定的微信身份（微信手机号登录或绑定后写入）；小程序支付据此取可信 openid。 */
  wechatIdentityId?: string;
}

/** 仅原 ClientAuth 能从签名会话建立的事务租约；不授予 Core、订单或企业动作。
 * current 保持本请求原 Guard 的客户投影，revalidate 只在调用方原事务内复验。 */
export interface RentalClientSessionLease {
  readonly current: Readonly<ClientRequestContext>;
  revalidate(): Promise<Readonly<ClientRequestContext>>;
}
