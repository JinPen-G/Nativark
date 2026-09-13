import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * 第三方地址是租户可配置输入，不能直接交给服务端 fetch。
 * 生产环境默认只允许 HTTPS、公网地址；私有对象存储若确实需要，必须由部署方
 * 显式打开 INTEGRATION_ALLOW_PRIVATE_ENDPOINTS，不能由租户请求体自行绕过。
 */
export class UnsafeOutboundUrlError extends Error {}

interface OutboundUrlOptions {
  allowQuery?: boolean;
  allowPrivateInDevelopment?: boolean;
  productionHosts?: readonly string[];
}

const PRIVATE_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "host.docker.internal"
]);

function privateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
}

function mappedIpv4Address(hostname: string) {
  const sections = hostname.split("::");
  if (sections.length !== 2) return undefined;
  const left = sections[0] ? sections[0].split(":") : [];
  const right = sections[1] ? sections[1].split(":") : [];
  const words = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (words.length !== 8 || words.slice(0, 5).some((word) => Number.parseInt(word, 16) !== 0) || Number.parseInt(words[5], 16) !== 0xffff) return undefined;
  const high = Number.parseInt(words[6], 16);
  const low = Number.parseInt(words[7], 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return undefined;
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function privateIpv6(hostname: string) {
  const normalized = hostname.replace(/^\[/u, "").replace(/\]$/u, "").toLowerCase();
  const mappedIpv4 = mappedIpv4Address(normalized);
  if (mappedIpv4) return privateIpv4(mappedIpv4);
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

export function isPrivateOrLocalHost(hostname: string) {
  const normalized = hostname.trim().replace(/\.$/u, "").toLowerCase();
  if (PRIVATE_HOSTNAMES.has(normalized)) return true;
  const addressType = isIP(normalized.replace(/^\[|\]$/gu, ""));
  if (addressType === 4) return privateIpv4(normalized);
  if (addressType === 6) return privateIpv6(normalized);
  return false;
}

function production() {
  return String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

export function parseOutboundUrl(value: unknown, label: string, options: OutboundUrlOptions = {}) {
  const raw = String(value ?? "").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeOutboundUrlError(`${label}必须是有效的 HTTP(S) 地址`);
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
    throw new UnsafeOutboundUrlError(`${label}只允许使用 HTTP(S) 协议`);
  }
  if (url.username || url.password) {
    throw new UnsafeOutboundUrlError(`${label}不能包含内嵌账号或密码`);
  }
  if (!options.allowQuery && url.search) {
    throw new UnsafeOutboundUrlError(`${label}不能包含查询参数`);
  }
  if (url.hash) {
    throw new UnsafeOutboundUrlError(`${label}不能包含片段标识`);
  }
  const isProduction = production();
  if (isProduction && url.protocol !== "https:") {
    throw new UnsafeOutboundUrlError(`${label}在生产环境必须使用 HTTPS`);
  }
  const privateAllowed = (!isProduction && options.allowPrivateInDevelopment !== false) || String(process.env.INTEGRATION_ALLOW_PRIVATE_ENDPOINTS ?? "").toLowerCase() === "true";
  if (!privateAllowed && isPrivateOrLocalHost(url.hostname)) {
    throw new UnsafeOutboundUrlError(`${label}不能指向本机、内网或云元数据地址`);
  }
  if (isProduction && options.productionHosts && !options.productionHosts.includes(url.hostname.toLowerCase())) {
    throw new UnsafeOutboundUrlError(`${label}不是允许的生产平台地址`);
  }
  return url;
}

/** 生产部署额外解析域名，挡住“公网域名解析到内网 IP”的直接配置。 */
export async function assertOutboundUrl(value: unknown, label: string, options: OutboundUrlOptions = {}) {
  const url = parseOutboundUrl(value, label, options);
  const isProduction = production();
  const privateAllowed = (!isProduction && options.allowPrivateInDevelopment !== false) || String(process.env.INTEGRATION_ALLOW_PRIVATE_ENDPOINTS ?? "").toLowerCase() === "true";
  if (!privateAllowed && !isPrivateOrLocalHost(url.hostname) && !isIP(url.hostname)) {
    try {
      const addresses = await lookup(url.hostname, { all: true, verbatim: true });
      if (addresses.some((address) => isPrivateOrLocalHost(address.address))) {
        throw new UnsafeOutboundUrlError(`${label}不能解析到本机或内网地址`);
      }
    } catch (error) {
      if (error instanceof UnsafeOutboundUrlError) throw error;
      throw new UnsafeOutboundUrlError(`${label}域名无法安全解析`);
    }
  }
  return url;
}

export async function validateProviderOutboundUrls(capability: string, provider: string, settings: Record<string, unknown>) {
  const targets: Array<{ key: string; label: string; value: unknown; allowQuery?: boolean; productionHosts?: readonly string[] }> = [];
  if (capability === "payment") {
    if (provider === "alipay") {
      targets.push({ key: "gatewayUrl", label: "支付宝网关地址", value: settings.gatewayUrl, productionHosts: ["openapi.alipay.com"] });
      targets.push({ key: "notifyUrl", label: "支付宝异步通知地址", value: settings.notifyUrl, allowQuery: true });
    } else if (provider === "wechat_pay") {
      if (String(settings.gatewayUrl ?? "").trim()) targets.push({ key: "gatewayUrl", label: "微信支付网关地址", value: settings.gatewayUrl, productionHosts: ["api.mch.weixin.qq.com"] });
      targets.push({ key: "notifyUrl", label: "微信支付通知地址", value: settings.notifyUrl, allowQuery: true });
    }
  } else if (capability === "file" && (provider === "aliyun_oss" || provider === "s3_compatible")) {
    targets.push({ key: "endpoint", label: "对象存储 Endpoint", value: settings.endpoint });
  }
  for (const target of targets) {
    if (!String(target.value ?? "").trim()) continue;
    await assertOutboundUrl(target.value, target.label, { allowQuery: target.allowQuery, productionHosts: target.productionHosts });
  }
}
