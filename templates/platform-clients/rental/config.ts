/** 显式宿主设置，不是业务权限。凭据由 Rental 原会话工厂签发/采用/撤销。 */
import { ClientError, type ClientAccessPort, type ClientSurface } from "@rental-os/platform-client-contracts";
import type { RentalClientCredentials } from "@rental-os/rental-core/clients/contribution";

export interface RentalClientHostConfiguration {
  readonly apiOrigin: string;
  readonly tenantCode: string;
  readonly brand: { readonly name: string; readonly primaryColor?: string };
  /** 微信客户必须填原应用 AppID，用于原渠道 clientId；不作为授权。 */
  readonly appId?: string;
}
export const RENTAL_CLIENT_SOURCE = "e078ec95b5fbdd2c8be126665ddd3de073a29c67";
export const RENTAL_CLIENT_VERSION = "0.2.1";

/** 固定贡献的 page 使用历史读门禁；普通页面还需原服务的当前 Core/端发布准入。
 * 缺失时不能以历史可读代替启用。原收据仍由 Rental 独立裁定，不受普通页开关替代。
 */
export function rentalAccess(original: ClientAccessPort, currentPageAccess?: ClientAccessPort): ClientAccessPort {
  return { async authorize(input, lifetime) {
    if (input.purpose === "page") {
      if (!currentPageAccess) return { status: "unavailable" };
      const current = await currentPageAccess.authorize(input, lifetime);
      lifetime.assertCurrent();
      if (current.status !== "allowed") return current;
    }
    return original.authorize(input, lifetime);
  } };
}

export function connection(configuration: RentalClientHostConfiguration, surface: ClientSurface) {
  const origin = configuration.apiOrigin.replace(/\/$/u, "");
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/iu.test(origin)
    || !configuration.tenantCode.trim() || !configuration.brand.name.trim()
    || surface === "wechat-customer" && !/^wx[0-9a-f]{16}$/iu.test(configuration.appId ?? "")) throw new ClientError("unavailable");
  const audience = surface === "customer-web" || surface === "wechat-customer" ? "client" : "staff";
  const prefix = `/api/${audience}/v1/`;
  return {
    key: `zelo:${surface}:${encodeURIComponent(origin)}:${encodeURIComponent(configuration.tenantCode)}:credentials`,
    url(path: string) {
      // 运输只接受所属受众的原固定路径，绝不跟随模型地址或把凭据交给另一来源。
      if (!path.startsWith(prefix) || /[\\\r\n#]/u.test(path) || path.includes("..") || path.includes("://")) throw new ClientError("unavailable");
      return origin + path;
    },
  };
}
export function credentialProjection(raw: string | null): RentalClientCredentials | undefined {
  if (!raw) return undefined;
  const value = JSON.parse(raw) as RentalClientCredentials;
  if (!value || typeof value.accessToken !== "string" || !value.accessToken
    || typeof value.refreshToken !== "string" || !value.refreshToken) throw new ClientError("unavailable");
  return { accessToken: value.accessToken, refreshToken: value.refreshToken };
}
export function credentialText(value: RentalClientCredentials): string {
  return JSON.stringify(credentialProjection(JSON.stringify({ accessToken: value.accessToken, refreshToken: value.refreshToken })));
}
