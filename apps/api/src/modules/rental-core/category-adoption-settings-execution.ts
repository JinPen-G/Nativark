import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { BusinessSettingsAllocationInputDto, BusinessSettingsCalendarInputDto } from "./rental-config-request.dto";
import { businessHoursError, isValidTimeZone } from "./rental-business-day";

/** Validate the execution parameters read from stored settings, without defaults
 * or edits. Missing settings remain a separate readiness concern, not invented
 * configuration. This does not claim the whole adoption gate is complete. */
export function categoryAdoptionSettingsExecutionErrors(value: unknown): string[] {
  if (value === null) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["经营设置结构不可执行"];
  try {
    const settings = value as Record<string, unknown>;
    const visiting = new WeakSet<object>();
    const safe = (node: unknown, depth = 0): boolean => {
      if (node === null || typeof node !== "object") return true;
      if (depth > 50 || visiting.has(node)) return false;
      visiting.add(node);
      const valid = Object.entries(node).every(([key, child]) => !["__proto__", "constructor", "prototype"].includes(key) && safe(child, depth + 1));
      visiting.delete(node); return valid;
    };
    if (!safe(settings.calendar) || !safe(settings.allocation)) return ["经营日历或分配设置含不安全结构"];
    const options = { whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, validationError: { target: false, value: false } };
    if (!settings.calendar || typeof settings.calendar !== "object" || Array.isArray(settings.calendar)) return ["经营日历设置结构不可执行"];
    const calendar = plainToInstance(BusinessSettingsCalendarInputDto, settings.calendar, { enableImplicitConversion: false });
    if (validateSync(calendar, options).length) return ["经营日历设置不符合输入契约"];
    if (settings.allocation !== undefined) {
      if (!settings.allocation || typeof settings.allocation !== "object" || Array.isArray(settings.allocation)) return ["资源分配设置结构不可执行"];
      const allocation = plainToInstance(BusinessSettingsAllocationInputDto, settings.allocation, { enableImplicitConversion: false });
      if (validateSync(allocation, options).length) return ["资源分配设置不符合输入契约"];
    }
    const errors: string[] = [];
    if (calendar.timeZone !== undefined && !isValidTimeZone(calendar.timeZone)) errors.push("经营日历时区不可执行");
    if (calendar.weeklyHours !== undefined && calendar.weeklyHours !== null) {
      if (calendar.weeklyHours.length !== 0 && calendar.weeklyHours.length !== 7) errors.push("每周营业时段必须为空或完整7项");
      for (const [weekday, hours] of calendar.weeklyHours.entries()) {
        const error = businessHoursError(hours, `星期${weekday}`);
        if (error) errors.push(error);
      }
    }
    return errors;
  } catch {
    return ["经营日历或分配设置无法安全执行"];
  }
}
