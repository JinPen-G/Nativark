/** Rental 客户网站宿主输入。沿原单网站寿命复用同一客户会话、运输与原引用存储。
 * 宿主负责公开构建参数及本地资产，业务权限、报价、订单和恢复仍由原服务端裁定。 */
import type * as CustomerSession from "@rental-os/web-client";
import type { createRentalWebsitePublicClient } from "../website";

export interface RentalWebsitePhotoSource {
  file: string;
  author: string;
  license: string;
  licenseUrl?: string;
  source: string;
}

export interface RentalWebsiteHost {
  readonly apiBase: string;
  readonly baseDomain?: string;
  readonly defaultTenant?: string;
  readonly publicClient: ReturnType<typeof createRentalWebsitePublicClient>;
  readonly session: Pick<typeof CustomerSession,
    "customerFetch" | "customerLogin" | "customerSessionGeneration" | "loadCustomerSession"
    | "logoutCustomerSession" | "switchCustomerWorkspace" | "subscribeCustomerSession">;
  readonly request: typeof globalThis.fetch;
  readonly localStorage: Storage;
  readonly sessionStorage: Storage;
  readonly locks?: LockManager;
  /** 仅接收原网站 /media/、/brand/ 本地资产引用，不参与业务导航或授权。 */
  readonly assetUrl: (path: string) => string;
  readonly photoSources: readonly RentalWebsitePhotoSource[];
}

let activeHost: RentalWebsiteHost | undefined;
export let API_BASE: string;
export let CLIENT_V1: string;
export let clientApi: RentalWebsiteHost["publicClient"];

/** 同一页面重渲染可复用同一宿主。更换宿主须结束原网站寿命，保留其原引用。 */
export function configureRentalWebsiteHost(host: RentalWebsiteHost): void {
  if (activeHost && activeHost !== host) throw new Error("rental_website_host_changed");
  const apiBase = host.apiBase.replace(/\/$/, "");
  const publicClient = host.publicClient;
  API_BASE = apiBase;
  CLIENT_V1 = apiBase + "/api/client/v1";
  clientApi = publicClient;
  activeHost = host;
}

export function getRentalWebsiteHost(): RentalWebsiteHost {
  if (!activeHost) throw new Error("rental_website_host_unavailable");
  return activeHost;
}

export function websiteStorage(): Storage {
  return getRentalWebsiteHost().localStorage;
}

export function websiteTransientStorage(): Storage {
  return getRentalWebsiteHost().sessionStorage;
}

export const websiteBrowser = {
  get locks(): LockManager | undefined {
    return getRentalWebsiteHost().locks;
  },
};

export const websiteFetch: typeof globalThis.fetch = (input, init) =>
  getRentalWebsiteHost().request(input, init);

export function resolveWebsiteAsset(path: string): string {
  return path.startsWith("/media/") || path.startsWith("/brand/")
    ? getRentalWebsiteHost().assetUrl(path)
    : path;
}

export const customerFetch: typeof CustomerSession.customerFetch = (...args) =>
  getRentalWebsiteHost().session.customerFetch(...args);
export const customerSessionGeneration: typeof CustomerSession.customerSessionGeneration = (...args) =>
  getRentalWebsiteHost().session.customerSessionGeneration(...args);
export const loadCustomerSession: typeof CustomerSession.loadCustomerSession = (...args) =>
  getRentalWebsiteHost().session.loadCustomerSession(...args);
export const logoutCustomerSession: typeof CustomerSession.logoutCustomerSession = (...args) =>
  getRentalWebsiteHost().session.logoutCustomerSession(...args);
export const switchCustomerWorkspace: typeof CustomerSession.switchCustomerWorkspace = (...args) =>
  getRentalWebsiteHost().session.switchCustomerWorkspace(...args);
export const subscribeCustomerSession: typeof CustomerSession.subscribeCustomerSession = (...args) =>
  getRentalWebsiteHost().session.subscribeCustomerSession(...args);
