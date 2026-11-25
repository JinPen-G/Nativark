/** 公共 HTTP 响应信封，所有宿主和业务 Core 共用。 */
export interface ApiResult<T> {
  data: T;
  requestId: string;
}

/** 后台简称的输入边界；省略保留、空值清除，前后端使用同一归一规则。 */
export function normalizeOperatorShortName(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.length > 64 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value))
    throw new Error("营运商简称必须是单行文字");
  return value.trim().normalize("NFC") || null;
}
