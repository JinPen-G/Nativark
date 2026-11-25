import { isIP } from "node:net";
import { ModelGatewayError } from "./model-gateway.ports";
/** Deployment policy only. No request-controlled private-network switch. */
export function modelEgressUrl(value: string): URL {
  try {
    if (typeof value !== "string" || value.length > 2048 || value.trim() !== value || /[\s\\]/u.test(value)) throw new Error();
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.hostname) throw new Error();
    const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    if (!isIP(hostname) && (!hostname.includes(".") || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith("."))) throw new Error();
    if (isIP(hostname)) publicModelAddress(hostname);
    return url;
  } catch { throw new ModelGatewayError("CONFIG_INVALID"); }
}
/** Conservative globally-routable subset; special/transition/documentation addresses fail closed. */
export function publicModelAddress(address: string, family?: number): { address: string; family: 4 | 6 } {
  const actual = typeof address === "string" ? isIP(address) : 0;
  if (!actual || (family !== undefined && family !== actual)) throw new ModelGatewayError("CONFIG_INVALID");
  if (actual === 4) {
    const [a, b, c] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113)) throw new ModelGatewayError("CONFIG_INVALID");
  } else {
    // Normalize textual variants before range checks. Excludes mapped IPv4, NAT64, local/link-local/multicast.
    let normalized: string;
    try { normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1).toLowerCase(); }
    catch { throw new ModelGatewayError("CONFIG_INVALID"); }
    const first = parseInt(normalized.split(":")[0], 16);
    if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff || normalized.startsWith("2001:") || normalized.startsWith("2002:") || normalized.startsWith("3fff:")) throw new ModelGatewayError("CONFIG_INVALID");
    return { address: normalized, family: 6 };
  }
  return { address, family: 4 };
}
