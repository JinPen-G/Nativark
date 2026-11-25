import { BadRequestException } from "@nestjs/common";

/** 空值不是零；设备计量表更换/归零需单独举证处理，不能伪造成负用量。 */
export function optionalUsageReading(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return undefined;
  if (typeof value !== "number" && typeof value !== "string") throw new BadRequestException(`${label}必须是非负数字`);
  const reading = Number(value);
  if (!Number.isFinite(reading) || reading < 0) throw new BadRequestException(`${label}必须是有限的非负数字`);
  return reading;
}

export function usageDelta(current: number, baseline?: number): number | undefined {
  if (!Number.isFinite(current) || current < 0 || (baseline !== undefined && (!Number.isFinite(baseline) || baseline < 0))) {
    throw new BadRequestException("使用量读数必须是有限的非负数字");
  }
  if (baseline === undefined) return undefined;
  if (current < baseline) throw new BadRequestException("归还读数不能小于领取基线；计量表更换或归零须另行核对证据，不能按负用量结算");
  return current - baseline;
}
