/** 原字典正规化与编号格式的单一实现，供持久服务和原演示内存适配消费。
 * 日期沿宿主本地时间，resetCycle 保留为配置字段，沿原行为连续推进流水。 */
import { BadRequestException } from "@nestjs/common";
import type { GeneratePlatformNumberResult, PlatformDictionaryGroup, PlatformDictionaryItem, PlatformNumberRule,
  SavePlatformDictionaryGroupRequest, SavePlatformNumberRuleRequest } from "@rental-os/platform-contracts";

export const PLATFORM_NUMBER_DATE_PATTERNS = ["yyyyMMdd", "yyyyMM", "yyMMdd", "none"] as const;
export const PLATFORM_NUMBER_RESET_CYCLES = ["daily", "monthly", "yearly", "never"] as const;

export function normalizeDictionaryItems(items: PlatformDictionaryItem[]) {
  const codes = new Set<string>();
  return items.map(item => ({ code: item.code.trim(), label: item.label.trim(), value: item.value.trim(),
    sortNo: Number(item.sortNo), enabled: Boolean(item.enabled), remark: item.remark?.trim() }))
    .sort((left, right) => left.sortNo - right.sortNo)
    .map(item => {
      if (!item.code || !item.label || !item.value) throw new BadRequestException("字典项编码、显示名称和值不能为空");
      if (!Number.isFinite(item.sortNo)) throw new BadRequestException("字典项排序必须是数字");
      if (codes.has(item.code)) throw new BadRequestException("字典项编码不能重复");
      codes.add(item.code);
      return item;
    });
}

export function createDictionaryGroup(input: SavePlatformDictionaryGroupRequest, now = new Date()): PlatformDictionaryGroup {
  if (!input.code.trim() || !input.name.trim() || !input.module.trim())
    throw new BadRequestException("字典编码、名称和归属模块不能为空");
  if (input.items.length === 0) throw new BadRequestException("数据字典至少保留一个字典项");
  return { code: input.code.trim(), name: input.name.trim(), module: input.module.trim(), description: input.description?.trim(),
    items: normalizeDictionaryItems(input.items), updatedAt: now.toISOString(), updatedBy: input.operator || "营运端" };
}

export function formatPlatformNumber(rule: Pick<PlatformNumberRule, "prefix" | "datePattern" | "sequenceLength">,
  sequence: number, now = new Date()) {
  const parts = [rule.prefix];
  if (rule.datePattern !== "none") {
    const yyyy = String(now.getFullYear()), mm = String(now.getMonth() + 1).padStart(2, "0"), dd = String(now.getDate()).padStart(2, "0");
    parts.push(rule.datePattern === "yyyyMMdd" ? `${yyyy}${mm}${dd}`
      : rule.datePattern === "yyyyMM" ? `${yyyy}${mm}` : `${yyyy.slice(-2)}${mm}${dd}`);
  }
  parts.push(String(sequence).padStart(rule.sequenceLength, "0"));
  return parts.join("-");
}

export function createNumberRule(input: SavePlatformNumberRuleRequest, existing?: PlatformNumberRule, now = new Date()): PlatformNumberRule {
  if (!input.code.trim() || !input.name.trim() || !input.module.trim())
    throw new BadRequestException("编号规则编码、名称和归属模块不能为空");
  if (!input.prefix.trim()) throw new BadRequestException("编号前缀不能为空");
  if (!Number.isInteger(input.sequenceLength) || input.sequenceLength < 3 || input.sequenceLength > 12)
    throw new BadRequestException("流水号长度必须是 3 到 12 位整数");
  if (!PLATFORM_NUMBER_DATE_PATTERNS.includes(input.datePattern) || !PLATFORM_NUMBER_RESET_CYCLES.includes(input.resetCycle))
    throw new BadRequestException("编号日期格式或重置周期不支持");
  const currentSequence = input.currentSequence ?? existing?.currentSequence ?? 0;
  // 大于安全整数后 +1 可能保持原值，须在写入前拒绝，避免生成重复流水。
  if (!Number.isSafeInteger(currentSequence) || currentSequence < 0 || currentSequence >= Number.MAX_SAFE_INTEGER - 1)
    throw new BadRequestException("当前流水必须是可继续递增的非负安全整数");
  const rule: PlatformNumberRule = { code: input.code.trim().toUpperCase(), name: input.name.trim(), module: input.module.trim(),
    prefix: input.prefix.trim().toUpperCase(), datePattern: input.datePattern, sequenceLength: input.sequenceLength,
    currentSequence, resetCycle: input.resetCycle, enabled: input.enabled, sample: "", updatedAt: now.toISOString(),
    updatedBy: input.operator || "营运端" };
  rule.sample = formatPlatformNumber(rule, currentSequence + 1, now);
  return rule;
}

export function advanceNumberRule(current: PlatformNumberRule, operator: string, now = new Date()): {
  rule: PlatformNumberRule; result: GeneratePlatformNumberResult;
} {
  if (!current.enabled) throw new BadRequestException("编号规则已停用");
  if (!Number.isSafeInteger(current.currentSequence) || current.currentSequence < 0 || current.currentSequence >= Number.MAX_SAFE_INTEGER - 1)
    throw new BadRequestException("当前流水无法安全递增，请核对编号规则");
  const rule = { ...current, currentSequence: current.currentSequence + 1, updatedAt: now.toISOString(), updatedBy: operator || "营运端" };
  rule.sample = formatPlatformNumber(rule, rule.currentSequence + 1, now);
  return { rule, result: { code: rule.code, generatedNo: formatPlatformNumber(rule, rule.currentSequence, now), nextSequence: rule.currentSequence + 1 } };
}
