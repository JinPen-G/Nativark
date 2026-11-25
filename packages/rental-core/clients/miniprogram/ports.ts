/** 客户小程序宿主端口。原 request 供给客户会话、范围复验、刷新与错误，
 * 公开配置仅标识渠道，页面与原操作协调器供给读取寿命和持久化幂等键。 */
export interface RentalMiniProgramRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  data?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  auth?: "required" | "optional" | "none";
  scope?: "workspace" | "tenant" | "public";
  idempotencyKey?: string;
  timeoutMs?: number;
  replayAfterRefresh?: boolean;
  publicSessionCredential?: string;
}

export type RentalMiniProgramRequest = <T>(path: string, options?: RentalMiniProgramRequestOptions) => Promise<T>;

export interface RentalMiniProgramClientPorts {
  request: RentalMiniProgramRequest;
}

export interface RentalMiniProgramPublicConfig {
  tenantCode: string;
  appId: string;
}

export interface RentalMiniProgramCatalogPorts extends RentalMiniProgramClientPorts {
  publicConfig: Pick<RentalMiniProgramPublicConfig, "tenantCode">;
  contractMissing: (error: unknown) => boolean;
  featureUnavailable: (message: string) => Error;
}

export interface RentalMiniProgramMerchantPorts extends RentalMiniProgramClientPorts {
  publicConfig: RentalMiniProgramPublicConfig;
  contractMissing: (error: unknown) => boolean;
}
