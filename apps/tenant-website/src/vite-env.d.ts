/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 生产环境 API 网关地址；留空则用同源 /api（开发经 Vite 代理）。 */
  readonly VITE_API_BASE?: string;
  /** 多租户基础域名（如 rentalos.com）；配置后只把它的直接子域当作租户编码。 */
  readonly VITE_BASE_DOMAIN?: string;
  /** 单租户独立部署时钉死的租户编码；无域名/参数时兜底。 */
  readonly VITE_DEFAULT_TENANT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
