/**
 * 服务端请求内容的确定性 SHA-256，供平台审计、文件绑定和业务幂等引用。
 * 排序与 JSON 语义沿用原实现，已保存指纹可由公共宿主和各 Core 原样核对。
 */
import { createHash } from "node:crypto";

export function requestFingerprint(payload: unknown): string {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = normalize((value as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(normalize(payload) ?? null)).digest("hex");
}
