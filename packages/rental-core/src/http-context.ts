/** Rental HTTP共用原配置快照与显式操作键。是否需要默认键/重放及业务授权仍由各原动作裁定。 */
import { BadRequestException } from "@nestjs/common";
import type { RentalBusinessContext } from "./configuration-basis";
import type { RentalHttpApplications } from "./http-applications";

/** 原MySQL列宽为191；超长键在请求边界拒绝，不等提交时产生数据库错误。 */
const IDEMPOTENCY_KEY_MAX_LENGTH = 191;

export function rentalHttpIdempotencyKey(req: { headers?: Record<string, unknown> }): string | undefined {
  const raw = req.headers?.["idempotency-key"] ?? req.headers?.["Idempotency-Key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new BadRequestException(`Idempotency-Key 过长，最多 ${IDEMPOTENCY_KEY_MAX_LENGTH} 个字符`);
  }
  return trimmed;
}

/** 同一已选Core必定提供快照读取，复用原刷新队列，不从多份列表重新拼当前业务配置。 */
export async function rentalHttpBusinessContext(
  tenantId: string,
  core: Pick<RentalHttpApplications["core"], "readBusinessContext">,
  business: Pick<RentalHttpApplications["business"], "refreshWorkspaceContext">
): Promise<RentalBusinessContext> {
  return business.refreshWorkspaceContext(tenantId, await core.readBusinessContext(tenantId));
}
