/** 当前租户的原筛选预设自助服务。沿 operator 会话锁定及复验主体，预设和审计同事务提交。
 * scope 仅标记原 UI 偏好，不授予业务读取权。请求中的 tenantId 和 operator 不提供授权。 */
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { DeletePlatformFilterPresetResult, PlatformFilterPresetQuery, PlatformFilterPresetScope,
  SavePlatformFilterPresetRequest, SystemUserRow } from "@rental-os/platform-contracts";
import { PLATFORM_AUTH_DATA_STORE } from "../platform/platform-auth-data-store";
import { PlatformIdentityRepository } from "../platform/platform-identity.repository";
import { PlatformPrincipalAuthority } from "../platform/platform-principal.authority";
import { PlatformFilterPresetRepository } from "./filter-presets.repository";
import type { PlatformFilterPresetDatabase, PlatformFilterPresetTransaction } from "./filter-presets.store";

/** 原服务实际接受的六个 scope。合同中的其他声明仍需对应业务接点明确开放。 */
export const PLATFORM_FILTER_PRESET_SCOPES = ["rental-os.orders", "rental-os.vehicles", "rental-os.members",
  "rental-os.corporates", "rental-os.stations", "rental-os.vehicle-transfer"] as const;

@Injectable()
export class PlatformFilterPresetService {
  private readonly repository = new PlatformFilterPresetRepository();
  private readonly principals: PlatformPrincipalAuthority<PlatformFilterPresetTransaction>;

  constructor(@Inject(PLATFORM_AUTH_DATA_STORE) private readonly database: PlatformFilterPresetDatabase) {
    this.principals = new PlatformPrincipalAuthority(new PlatformIdentityRepository(database));
  }

  private run<T>(work: (tx: PlatformFilterPresetTransaction, user: SystemUserRow) => Promise<T>): Promise<T> {
    const actor = this.principals.current();
    return this.database.$transaction(async tx => {
      const lease = await this.principals.lock(tx, actor, actor.tenantId);
      if (lease.user.isSaasAdmin) throw new ForbiddenException("SaaS 平台管理员只能访问租户管理能力");
      const result = await work(tx, lease.user);
      if ((await lease.revalidate()).isSaasAdmin) throw new ForbiddenException("当前账号已不符合租户筛选预设访问条件");
      return result;
    }, { isolationLevel: "Serializable" }).catch(error => {
      if (error && typeof error === "object" && "code" in error && ["P2002", "P2034"].includes(String(error.code)))
        throw new ConflictException("筛选预设在提交期间变化或名称重复，请重新读取核对");
      throw error;
    });
  }

  private normalizeFilterPresetScope(scopeKey: string): PlatformFilterPresetScope {
    if (!PLATFORM_FILTER_PRESET_SCOPES.includes(scopeKey as typeof PLATFORM_FILTER_PRESET_SCOPES[number]))
      throw new BadRequestException("筛选预设范围不支持");
    return scopeKey as PlatformFilterPresetScope;
  }

  private normalizeFilterPresetInput(input: SavePlatformFilterPresetRequest, user: SystemUserRow) {
    const scopeKey = this.normalizeFilterPresetScope(input.scopeKey);
    const name = input.name?.trim();
    if (!name) throw new BadRequestException("筛选预设名称不能为空");
    if (name.length > 40) throw new BadRequestException("筛选预设名称不能超过 40 个字符");
    if (!input.filters || typeof input.filters !== "object" || Array.isArray(input.filters))
      throw new BadRequestException("筛选条件必须是对象");
    return { ...input, id: input.id?.trim(), tenantId: user.tenantId, scopeKey, name,
      description: input.description?.trim() || undefined, filters: JSON.parse(JSON.stringify(input.filters)) as Record<string, unknown>,
      isDefault: Boolean(input.isDefault), operator: input.operator?.trim() || user.displayName || "营运端" };
  }

  private audit(tx: PlatformFilterPresetTransaction, user: SystemUserRow, action: string,
    id: string, operator: string, detail: string) {
    return tx.operationLog.create({ data: { tenantId: user.tenantId, userId: user.id, action,
      detail: { operator, targetType: "filter-preset", targetId: id, detail } } });
  }

  listFilterPresets(query: PlatformFilterPresetQuery = {}) {
    return this.run((tx, user) => this.repository.listFilterPresets(tx, user.tenantId,
      query.scopeKey ? this.normalizeFilterPresetScope(query.scopeKey) : undefined));
  }

  saveFilterPreset(input: SavePlatformFilterPresetRequest) {
    return this.run(async (tx, user) => {
      const normalized = this.normalizeFilterPresetInput(input, user);
      const preset = await this.repository.saveFilterPreset(tx, normalized);
      await this.audit(tx, user, "filter-preset.save", preset.id, normalized.operator, `保存筛选预设：${preset.name}`);
      return preset;
    });
  }

  setDefaultFilterPreset(id: string, operator?: string) {
    return this.run(async (tx, user) => {
      const updatedBy = operator || user.displayName || "营运端";
      const preset = await this.repository.setDefaultFilterPreset(tx, user.tenantId, id, updatedBy);
      await this.audit(tx, user, "filter-preset.default", preset.id, updatedBy, `设为默认筛选预设：${preset.name}`);
      return preset;
    });
  }

  deleteFilterPreset(id: string, operator?: string): Promise<DeletePlatformFilterPresetResult> {
    return this.run(async (tx, user) => {
      const updatedBy = operator || user.displayName || "营运端";
      const preset = await this.repository.deleteFilterPreset(tx, user.tenantId, id);
      await this.audit(tx, user, "filter-preset.delete", preset.id, updatedBy, `删除筛选预设：${preset.name}`);
      return { id, deleted: true };
    });
  }
}
