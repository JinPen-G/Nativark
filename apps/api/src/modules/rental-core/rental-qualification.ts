import type { CustomerQualificationRef, RentalRuleConfig } from "@store-rental/shared";

export type RentalQualificationAction = "submit" | "pickup" | "extension";

export interface RentalQualificationCheckWindow {
  /** 资格有效期至少要覆盖到的时间点。 */
  validThroughAt: string;
  /** 最低有效期从哪个时间点起算。通常是订单起租时间。 */
  minimumValidityFromAt: string;
}

export interface RentalQualificationEvaluation {
  ok: boolean;
  qualificationType?: string;
  reasonCode?: "missing_requirement" | "missing_approved" | "invalid_expiry" | "insufficient_validity";
  message?: string;
}

/**
 * SHARED-QUAL-01：所有动作共用的证件适用性判定。
 *
 * 这里只判断租户主档里的资格事实与当前规则快照，不判断某个品类的字段。
 * 企业员工关系与客户/空间状态由 MembershipService 在调用前重新解析。
 */
export function evaluateRentalQualification(
  qualifications: CustomerQualificationRef[],
  rule: RentalRuleConfig["qualification"],
  window: RentalQualificationCheckWindow
): RentalQualificationEvaluation {
  if (!rule.required) return { ok: true };

  const documentTypes = rule.documentTypes.filter((value) => value.trim().length > 0);
  if (!documentTypes.length) {
    return { ok: false, reasonCode: "missing_requirement", message: "当前经营空间未配置可接受的资格类型" };
  }

  const validThrough = Date.parse(window.validThroughAt);
  const minimumFrom = Date.parse(window.minimumValidityFromAt);
  if (!Number.isFinite(validThrough) || !Number.isFinite(minimumFrom)) {
    return { ok: false, reasonCode: "invalid_expiry", message: "资格校验时间无效" };
  }

  const candidates = qualifications
    .filter((item) => documentTypes.includes(item.qualificationType) && item.status === "approved")
    .map((item) => ({ item, expiresAt: item.expiresAt ? Date.parse(item.expiresAt) : Number.POSITIVE_INFINITY }))
    .sort((left, right) => {
      const score = (value: number) => Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
      return score(right.expiresAt) - score(left.expiresAt);
    });
  const qualification = candidates[0];
  if (!qualification) {
    return {
      ok: false,
      reasonCode: "missing_approved",
      message: `未找到已审核通过的资格：${documentTypes.join("、")}`
    };
  }

  if (Number.isNaN(qualification.expiresAt)) {
    return {
      ok: false,
      qualificationType: qualification.item.qualificationType,
      reasonCode: "invalid_expiry",
      message: `${qualification.item.qualificationType}有效期格式无效`
    };
  }

  if (qualification.expiresAt !== Number.POSITIVE_INFINITY && qualification.expiresAt < validThrough) {
    return {
      ok: false,
      qualificationType: qualification.item.qualificationType,
      reasonCode: "invalid_expiry",
      message: `${qualification.item.qualificationType}有效期不足，必须覆盖${window.validThroughAt}`
    };
  }

  if (qualification.expiresAt !== Number.POSITIVE_INFINITY) {
    const validDays = (qualification.expiresAt - minimumFrom) / 86_400_000;
    if (validDays < rule.minimumValidityDays) {
      return {
        ok: false,
        qualificationType: qualification.item.qualificationType,
        reasonCode: "insufficient_validity",
        message: `${qualification.item.qualificationType}剩余有效期不足${rule.minimumValidityDays}天`
      };
    }
  }

  return { ok: true, qualificationType: qualification.item.qualificationType };
}
