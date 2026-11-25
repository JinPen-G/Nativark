/** 原企业命令和读取审计的哈希/JSON解释，保持既有收据命名空间与序列化，不创建或重放业务。 */
import { createHash } from "node:crypto";
export const enterpriseHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const enterpriseJson = <T>(value: T | string): T => typeof value === "string" ? JSON.parse(value) : value;
