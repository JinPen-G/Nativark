/** 原租户级筛选预设算法。调用方已锁定当前租户与主体，预设变更及日志共同提交。 */
import { NotFoundException } from "@nestjs/common";
import type { PlatformFilterPreset, SavePlatformFilterPresetRequest } from "@rental-os/platform-contracts";
import type { PlatformJsonValue } from "../platform/platform-auth-data-store";
import type { PlatformFilterPresetTransaction, StoredPlatformFilterPreset } from "./filter-presets.store";

export class PlatformFilterPresetRepository {
  async listFilterPresets(tx: PlatformFilterPresetTransaction, tenantId: string, scopeKey?: string): Promise<PlatformFilterPreset[]> {
    const rows = await tx.filterPreset.findMany({ where: { tenantId, scopeKey },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] });
    return rows.map(row => this.toFilterPreset(row));
  }

  async saveFilterPreset(tx: PlatformFilterPresetTransaction,
    input: SavePlatformFilterPresetRequest & { tenantId: string; operator: string }): Promise<PlatformFilterPreset> {
    const { tenantId, operator } = input;
    if (input.isDefault) {
      await tx.filterPreset.updateMany({ where: { tenantId, scopeKey: input.scopeKey }, data: { isDefault: false } });
    }
    const existing = input.id
      ? await tx.filterPreset.findFirst({ where: { id: input.id, tenantId } })
      : await tx.filterPreset.findUnique({ where: { tenantId_scopeKey_name: { tenantId, scopeKey: input.scopeKey, name: input.name } } });
    if (input.id && !existing) throw new NotFoundException("筛选预设不存在");
    const data = { tenantId, scopeKey: input.scopeKey, name: input.name, description: input.description,
      filters: input.filters as { [key: string]: PlatformJsonValue | undefined },
      isDefault: Boolean(input.isDefault), isSystem: false, operator };
    const row = existing
      ? await tx.filterPreset.update({ where: { id: existing.id, tenantId }, data })
      : await tx.filterPreset.create({ data });
    return this.toFilterPreset(row);
  }

  async setDefaultFilterPreset(tx: PlatformFilterPresetTransaction, tenantId: string, id: string,
    operator: string): Promise<PlatformFilterPreset> {
    const row = await tx.filterPreset.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("筛选预设不存在");
    await tx.filterPreset.updateMany({ where: { tenantId, scopeKey: row.scopeKey }, data: { isDefault: false } });
    const next = await tx.filterPreset.update({ where: { id, tenantId }, data: { isDefault: true, operator } });
    return this.toFilterPreset(next);
  }

  async deleteFilterPreset(tx: PlatformFilterPresetTransaction, tenantId: string, id: string) {
    const row = await tx.filterPreset.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("筛选预设不存在");
    await tx.filterPreset.delete({ where: { id, tenantId } });
    return this.toFilterPreset(row);
  }

  private toFilterPreset(row: StoredPlatformFilterPreset): PlatformFilterPreset {
    const filters = row.filters && typeof row.filters === "object" && !Array.isArray(row.filters)
      ? row.filters as Record<string, unknown> : {};
    return { id: row.id, tenantId: row.tenantId, scopeKey: row.scopeKey as PlatformFilterPreset["scopeKey"],
      name: row.name, description: row.description ?? undefined, filters, isDefault: row.isDefault,
      isSystem: row.isSystem, updatedAt: row.updatedAt.toISOString(), updatedBy: row.operator || "营运端" };
  }
}
