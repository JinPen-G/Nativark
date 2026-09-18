import { fetchBootstrap, listPublicServices } from "../api/merchant";
import type { ChannelBootstrapContract } from "../contracts/planned";
import { Emitter } from "./events";
import { currentSession, lastServiceCode } from "./session";
import { STORAGE_KEYS, readStorage, writeStorage } from "./storage";

/**
 * 商户公开信息与已发布服务列表（需求 §6.1）。
 *
 * 首选拟新增的渠道启动接口；未提供时退回现有公开接口，得到商户名和服务列表，
 * Logo/协议/客服信息标注为“商户未提供”，不用平台默认品牌冒充商户。
 * 缓存到本机只为弱网首屏，仍以最新一次拉取为准。
 */
export interface MerchantService {
  code: string;
  name: string;
  categoryCode: string;
  isDefault?: boolean;
  status: "open" | "paused";
}

export interface MerchantInfo {
  name: string;
  logoUrl?: string;
  servicePhone?: string;
  serviceHours?: string;
  agreements?: ChannelBootstrapContract["agreements"];
  loginMethods: Array<"wechat_phone" | "sms" | "password">;
  capabilities: NonNullable<ChannelBootstrapContract["capabilities"]>;
  services: MerchantService[];
  defaultServiceCode?: string;
  /** 数据来自拟新增启动接口（true）还是现有公开接口回退（false）。 */
  fromBootstrap: boolean;
  fetchedAt: number;
}

export const merchantEvents = new Emitter<MerchantInfo>();

let cached: MerchantInfo | undefined;
let inflight: Promise<MerchantInfo> | undefined;

export function cachedMerchant(): MerchantInfo | undefined {
  if (!cached) cached = readStorage<MerchantInfo>(STORAGE_KEYS.bootstrap);
  return cached;
}

function fromBootstrap(contract: ChannelBootstrapContract): MerchantInfo {
  const services: MerchantService[] = contract.services.map((row) => ({
    code: row.code,
    name: row.name,
    categoryCode: row.categoryCode,
    isDefault: row.isDefault,
    status: row.status ?? "open"
  }));
  return {
    name: contract.merchant.name,
    logoUrl: contract.merchant.logoUrl,
    servicePhone: contract.merchant.servicePhone,
    serviceHours: contract.merchant.serviceHours,
    agreements: contract.agreements,
    loginMethods: contract.loginMethods?.length ? contract.loginMethods : ["password"],
    capabilities: contract.capabilities ?? {},
    services,
    defaultServiceCode: contract.defaultServiceCode ?? services.find((row) => row.isDefault)?.code ?? services[0]?.code,
    fromBootstrap: true,
    fetchedAt: Date.now()
  };
}

export async function loadMerchant(force = false): Promise<MerchantInfo> {
  if (!force && cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    let info: MerchantInfo;
    const bootstrap = await fetchBootstrap();
    if (bootstrap) {
      info = fromBootstrap(bootstrap);
    } else {
      const fallback = await listPublicServices();
      const services: MerchantService[] = fallback.workspaces.map((row) => ({ code: row.code, name: row.name, categoryCode: String(row.categoryCode), isDefault: row.isDefault, status: "open" }));
      info = {
        name: fallback.tenantName,
        loginMethods: ["password"],
        capabilities: {},
        services,
        defaultServiceCode: services.find((row) => row.isDefault)?.code ?? services[0]?.code,
        fromBootstrap: false,
        fetchedAt: Date.now()
      };
    }
    cached = info;
    writeStorage(STORAGE_KEYS.bootstrap, info);
    merchantEvents.emit(info);
    return info;
  })();
  try {
    return await inflight;
  } finally {
    inflight = undefined;
  }
}

/**
 * 首页应显示的服务：已登录用会话里的当前服务；否则上次选择的有效服务；否则商户默认服务。
 * 未发布的服务不会出现在列表里；零个可用服务返回 undefined（页面显示暂停营业说明）。
 */
export function resolveServiceCode(info: MerchantInfo | undefined): string | undefined {
  const services = info?.services ?? [];
  if (!services.length) return undefined;
  const session = currentSession();
  const candidates = [session?.serviceCode, lastServiceCode(), info?.defaultServiceCode];
  for (const code of candidates) {
    if (code && services.some((row) => row.code === code)) return code;
  }
  return services[0].code;
}

export function findService(info: MerchantInfo | undefined, code: string | undefined): MerchantService | undefined {
  if (!info || !code) return undefined;
  return info.services.find((row) => row.code === code);
}

/**
 * 登录/注册时可带的初始服务：只发送商户当前已发布的服务编码。
 * `lastService` 会跨退出登录保留，若该服务已下架，原样发送会让服务端拒绝登录。
 */
export function preferredServiceCode(): string | undefined {
  const info = cachedMerchant();
  const candidate = lastServiceCode();
  if (!candidate) return undefined;
  if (!info) return candidate;
  return findService(info, candidate)?.code;
}

/** 仅供测试。 */
export function resetMerchantForTest(): void {
  cached = undefined;
  inflight = undefined;
}
