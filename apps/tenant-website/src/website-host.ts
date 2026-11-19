/** 客户网站浏览器宿主。沿原构建配置和同一客户协调器供给 Core 前端。 */
import * as customerSession from "@rental-os/web-client";
import { createRentalWebsitePublicClient } from "@rental-os/rental-core/clients/website";
import { configureRentalWebsiteHost, type RentalWebsiteHost } from "@rental-os/rental-core/clients/website-ui/host";
import photoSources from "../public/media/photo-sources.json";

const apiBase = import.meta.env?.VITE_API_BASE ?? "";
export const websiteHost: RentalWebsiteHost = {
  apiBase,
  baseDomain: import.meta.env?.VITE_BASE_DOMAIN,
  defaultTenant: import.meta.env?.VITE_DEFAULT_TENANT,
  publicClient: createRentalWebsitePublicClient(apiBase),
  session: customerSession,
  request: (input, init) => fetch(input, init),
  get localStorage() { return globalThis.localStorage; },
  get sessionStorage() { return globalThis.sessionStorage; },
  get locks() { return typeof navigator === "undefined" ? undefined : navigator.locks; },
  assetUrl: path => path,
  photoSources,
};

configureRentalWebsiteHost(websiteHost);
