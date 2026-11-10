import { ConflictException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { lockActiveCategoryBinding } from "./category-active-write";

@Injectable()
export class RentalStateRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService
  ) {}

  enabled() {
    return (this.config.get<string>("PLATFORM_DATA_SOURCE") ?? "mysql").toLowerCase() === "mysql";
  }

  async loadCoreStates() {
    if (!this.enabled()) return [];
    return this.prisma.rentalCoreStateSnapshot.findMany();
  }

  async loadBusinessStates() {
    if (!this.enabled()) return [];
    return this.prisma.rentalBusinessStateSnapshot.findMany();
  }

  async loadTenantProfiles() {
    if (!this.enabled()) return [];
    return this.prisma.tenantRentalProfile.findMany({
      select: { tenantId: true, categoryCode: true }
    });
  }

  /**
   * SPACE-03：快照按**经营空间**存档。
   *
   * 主键换成 workspaceId 之后，每个空间各有自己的恢复副本，调用方不必再
   * 「固定挑默认空间」来避免互相覆盖。
   * 配置仓储已提交的档案路径须保留；采用后缺来源或旧来源的恢复副本拒绝写入，
   * 不把旧集合重新标记成当前版本，也不以快照重建正式经营事实。
   */
  async saveCoreState(tenantId: string, workspaceId: string, state: unknown) {
    if (!this.enabled()) return;
    const encoded = JSON.stringify(state);
    const profile = state && typeof state === "object" && "profile" in state ? state.profile as { categoryVersionId?: string; categoryAdoptionRevision?: number } : undefined;
    const expected = profile?.categoryVersionId && Number.isSafeInteger(profile.categoryAdoptionRevision)
      ? { categoryVersionId: profile.categoryVersionId, adoptionRevision: profile.categoryAdoptionRevision! } : undefined;
    await this.prisma.$transaction(async tx => {
      const { binding } = await lockActiveCategoryBinding(tx, tenantId, workspaceId, expected);
      if (!expected && binding.adoptionRevision > 0) throw new ConflictException("Core快照缺少当前采用来源，不能重新标记旧资料");
      const existing = await tx.rentalCoreStateSnapshot.findUnique({ where: { workspaceId }, select: { tenantId: true } });
      if (existing && existing.tenantId !== tenantId) throw new ConflictException("Core快照已属于其他租户，拒绝覆盖");
      // Explicit workspace profile edits are owned by the config repository.
      // Retain that path while replacing only the recovery snapshot collections.
      await tx.$executeRaw(Prisma.sql`INSERT INTO rental_core_state_snapshots (workspaceId, tenantId, state, updatedAt)
        VALUES (${workspaceId}, ${tenantId}, CAST(${encoded} AS JSON), NOW(3))
        ON DUPLICATE KEY UPDATE state = CASE WHEN JSON_EXTRACT(state, '$.profilePersisted') = CAST('true' AS JSON)
          THEN JSON_SET(CAST(${encoded} AS JSON), '$.profile', JSON_SET(JSON_EXTRACT(state, '$.profile'),
            '$.categoryVersionId', ${binding.categoryVersionId}, '$.categoryAdoptionRevision', ${binding.adoptionRevision}),
            '$.profilePersisted', CAST('true' AS JSON), '$.configPersisted', CAST('true' AS JSON))
          ELSE CAST(${encoded} AS JSON) END, updatedAt = NOW(3)`);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async saveBusinessState(tenantId: string, workspaceId: string, state: unknown) {
    if (!this.enabled()) return;
    const json = JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue;
    await this.prisma.rentalBusinessStateSnapshot.upsert({
      where: { workspaceId },
      update: { state: json },
      create: { workspaceId, tenantId, state: json }
    });
  }
}
