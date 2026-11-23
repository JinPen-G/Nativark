/** Rental Core 的发行身份；品类、数据与平台合同版本分别由各自正式出口维护。 */
export const RENTAL_CORE_ID = "rental";
export const RENTAL_CORE_VERSION = "0.1.10";
export const RENTAL_WORKSPACE_CONTAINER_TYPE = "rental-workspace";
/** 会员/渠道属于租户；订单等业务仍要求原经营空间成员及独立绑定。 */
export const RENTAL_CORE_SCOPE = { kind: "container", containerType: RENTAL_WORKSPACE_CONTAINER_TYPE, tenantScope: true } as const;
