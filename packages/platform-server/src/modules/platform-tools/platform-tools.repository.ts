/** 当前租户的生效字典/编号仓储。调用方持有公共主体的租户父锁，配置与审计共同提交。
 * 更新实际生效版本，保留其他 JSON 字段及草稿，首次写入在已有版本之后建立生效行。 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import type { PlatformDictionaryGroup, PlatformNumberRule } from "@rental-os/platform-contracts";
import type { PlatformToolsContent, PlatformToolsParameterRow, PlatformToolsTransaction } from "./platform-tools.store";

export const PLATFORM_DICTIONARIES_MODULE = "platform-dictionaries";
export const PLATFORM_NUMBER_RULES_MODULE = "platform-number-rules";

export class PlatformToolsRepository {
  async read(tx: PlatformToolsTransaction, tenantId: string, module: string) {
    if (!tenantId) throw new BadRequestException("公共工具缺少当前租户");
    const row = await tx.systemParameterSet.findFirst({ where: { tenantId, module, status: "EFFECTIVE" }, orderBy: { versionNo: "desc" } });
    if (row && row.content !== null && (typeof row.content !== "object" || Array.isArray(row.content)))
      throw new BadRequestException("现有公共工具配置格式无法核对");
    return { row, content: (row?.content ?? {}) as PlatformToolsContent };
  }

  dictionaries(content: PlatformToolsContent, defaults: PlatformDictionaryGroup[] = []): PlatformDictionaryGroup[] {
    const groups = content.groups ?? defaults;
    if (!Array.isArray(groups) || groups.some(group => !group || typeof group !== "object" || Array.isArray(group)
      || typeof group.code !== "string" || typeof group.name !== "string" || !Array.isArray(group.items)))
      throw new BadRequestException("现有字典配置格式无法核对");
    return structuredClone(groups) as PlatformDictionaryGroup[];
  }

  numberRules(content: PlatformToolsContent, defaults: PlatformNumberRule[] = []): PlatformNumberRule[] {
    const rules = content.rules ?? defaults;
    if (!Array.isArray(rules) || rules.some(rule => !rule || typeof rule !== "object" || Array.isArray(rule)
      || typeof rule.code !== "string" || typeof rule.name !== "string" || typeof rule.prefix !== "string"
      || !["yyyyMMdd", "yyyyMM", "yyMMdd", "none"].includes(String(rule.datePattern))
      || !Number.isSafeInteger(rule.currentSequence) || Number(rule.currentSequence) < 0
      || !Number.isInteger(rule.sequenceLength) || Number(rule.sequenceLength) < 1 || Number(rule.sequenceLength) > 12
      || typeof rule.enabled !== "boolean")) throw new BadRequestException("现有编号配置格式无法核对");
    const result = structuredClone(rules) as PlatformNumberRule[];
    if (new Set(result.map(rule => rule.code)).size !== result.length) throw new BadRequestException("现有编号规则编码重复，请核对配置");
    return result;
  }

  async save(tx: PlatformToolsTransaction, tenantId: string, module: string, row: PlatformToolsParameterRow | null,
    content: PlatformToolsContent) {
    const where = { tenantId, module, status: "EFFECTIVE" as const };
    if (row) {
      const updated = await tx.systemParameterSet.updateMany({ where: { ...where, id: row.id, versionNo: row.versionNo },
        data: { content, operator: "platform-governance" } });
      if (updated.count !== 1) throw new ConflictException("公共工具配置在提交期间变化，请重新读取核对");
    } else {
      const last = await tx.systemParameterSet.findFirst({ where: { tenantId, module }, orderBy: { versionNo: "desc" } });
      await tx.systemParameterSet.create({ data: { ...where, versionNo: (last?.versionNo ?? 0) + 1, content, operator: "platform-governance" } });
    }
  }
}
