import { ConflictException } from "@nestjs/common";
import type { RentalOrderServiceOccurrence } from "@rental-os/shared";

/** 只解释订单冻结的免赔快照，不读取当前服务配置或拼接多份保障额度。 */
export function selectDamageWaiver(
  services: RentalOrderServiceOccurrence[], amount: number, occurredAt: number, itemGroupId?: string
) {
  const candidates = services.filter((service) => {
    if (service.quantity !== undefined && service.quantity <= 0) return false;
    if (service.applicableItemGroupIds?.length && (!itemGroupId || !service.applicableItemGroupIds.includes(itemGroupId))) return false;
    const start = service.scheduledStartAt ? Date.parse(service.scheduledStartAt) : undefined;
    const end = service.scheduledEndAt ? Date.parse(service.scheduledEndAt) : undefined;
    if ((start !== undefined && !Number.isFinite(start)) || (end !== undefined && !Number.isFinite(end))
      || (start !== undefined && end !== undefined && start > end)) {
      throw new ConflictException("免赔快照保障时段无效，须核对冻结条款后再裁定");
    }
    return (start === undefined || occurredAt >= start) && (end === undefined || occurredAt <= end);
  }).map((service) => {
    const deductible = service.deductible ?? 0;
    const coverageLimit = service.coverageLimit ?? 0;
    if (!Number.isFinite(deductible) || deductible < 0 || !Number.isFinite(coverageLimit) || coverageLimit < 0) {
      throw new ConflictException("免赔快照的免赔额或保障额度无效，不能自动裁定");
    }
    const customerAmount = Math.min(amount, Math.min(amount, deductible) + Math.max(0, amount - coverageLimit));
    return { service, customerAmount };
  });
  // 保障上限大不代表客户承担少；免赔额也必须计入比较。相同结果稳定选同一发生项。
  return candidates.sort((a, b) => a.customerAmount - b.customerAmount
    || String(a.service.occurrenceId ?? a.service.serviceId ?? "").localeCompare(String(b.service.occurrenceId ?? b.service.serviceId ?? "")))[0];
}
