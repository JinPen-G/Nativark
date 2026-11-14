/**
 * 请求内容的确定性 SHA-256；供平台审计、文件绑定和业务幂等使用。
 * 保留原排序/JSON 语义以兼容已保存指纹；不判断权限、不读写原操作或业务数据。
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
