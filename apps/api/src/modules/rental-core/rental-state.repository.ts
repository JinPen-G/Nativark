/** Workspace recovery snapshots and their stored row revisions. Callers retain
 * the original tenant/workspace fence; revisions never replace category or
 * business-settings versions, nor authorize reading or replaying business facts. */
import { ConflictException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { lockActiveCategoryBinding } from "./category-active-write";

export const RENTAL_CONFIGURATION_REVISION_MAX = 2_147_483_647;

/** A database row revision is a number, never a parsed category version or JSON
 * value. Missing rollout columns and malformed values remain unavailable. */
export function readRentalConfigurationRevision(value: unknown, source: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > RENTAL_CONFIGURATION_REVISION_MAX) {
    throw new ConflictException(`${source}缺少合法的配置行修订`);
  }
  return value;
}

/** Both snapshot writers share this row CAS after the caller's workspace lock.
 * Initial creation stores revision 1; an unchanged observation does not write.
 * Equality is evaluated by MySQL over its JSON representation; a profile edit
 * never loads the aggregate's orders/assets just to compare a bounded facet.
 * Replacement SQL is code-owned, never a request or model expression.
 * The revision covers this stored snapshot, not other normalized config rows. */
export async function writeRentalCoreConfigurationSnapshot(tx: Prisma.TransactionClient, tenantId: string, workspaceId: string,
  initial: Record<string, unknown>, replacement: Prisma.Sql) {
  const rows = await tx.$queryRaw<Array<{ tenantId: string; workspaceId: string; stateType: string; configurationChanged: unknown; configurationRevision: unknown }>>(
    Prisma.sql`SELECT tenantId, workspaceId, configurationRevision, JSON_TYPE(state) AS stateType,
      CASE WHEN CAST(state AS BINARY) = CAST(${replacement} AS BINARY) THEN 0 ELSE 1 END AS configurationChanged
      FROM rental_core_state_snapshots
      WHERE workspaceId = ${workspaceId} FOR UPDATE`);
  if (rows.length > 1 || rows.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId)) {
    throw new ConflictException("Core快照配置已属于其他租户或空间，拒绝覆盖");
  }
  const row = rows[0], revision = row ? readRentalConfigurationRevision(row.configurationRevision, "Core快照") : undefined;
  if (row) {
    if (row.stateType !== "OBJECT" || ![0, 1, 0n, 1n].includes(row.configurationChanged as number | bigint)) {
      throw new ConflictException("Core快照配置或变更依据不可核验");
    }
    if (row.configurationChanged === 0 || row.configurationChanged === 0n) return revision!;
  }
  if (revision === RENTAL_CONFIGURATION_REVISION_MAX) throw new ConflictException("Core快照配置行修订已达上限");
  if (!row) {
    const created = await tx.$executeRaw(Prisma.sql`INSERT INTO rental_core_state_snapshots (workspaceId, tenantId, state, configurationRevision, updatedAt)
      VALUES (${workspaceId}, ${tenantId}, CAST(${JSON.stringify(initial)} AS JSON), 1, NOW(3))`);
    if (created !== 1) throw new ConflictException("Core快照配置创建结果不可核验");
    return 1;
  }
  const changed = await tx.$executeRaw(Prisma.sql`UPDATE rental_core_state_snapshots
    SET state = ${replacement}, configurationRevision = ${revision! + 1}, updatedAt = NOW(3)
    WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND configurationRevision = ${revision}`);
  if (changed !== 1) throw new ConflictException("Core快照配置行修订已变化，拒绝覆盖");
  return revision! + 1;
}

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
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new ConflictException("Core快照配置结构无效");
    const encoded = JSON.stringify(state);
    const profile = state && typeof state === "object" && "profile" in state ? state.profile as { categoryVersionId?: string; categoryAdoptionRevision?: number } : undefined;
    const expected = profile?.categoryVersionId && Number.isSafeInteger(profile.categoryAdoptionRevision)
      ? { categoryVersionId: profile.categoryVersionId, adoptionRevision: profile.categoryAdoptionRevision! } : undefined;
    await this.prisma.$transaction(async tx => {
      const { binding } = await lockActiveCategoryBinding(tx, tenantId, workspaceId, expected);
      if (!expected && binding.adoptionRevision > 0) throw new ConflictException("Core快照缺少当前采用来源，不能重新标记旧资料");
      // Explicit workspace profile edits are owned by the config repository.
      // Retain that path while replacing only the recovery snapshot collections.
      await writeRentalCoreConfigurationSnapshot(tx, tenantId, workspaceId, state as Record<string, unknown>, Prisma.sql`
        CASE WHEN JSON_EXTRACT(state, '$.profilePersisted') = CAST('true' AS JSON)
          THEN JSON_SET(CAST(${encoded} AS JSON), '$.profile', JSON_SET(JSON_EXTRACT(state, '$.profile'),
            '$.categoryVersionId', ${binding.categoryVersionId}, '$.categoryAdoptionRevision', ${binding.adoptionRevision}),
            '$.profilePersisted', CAST('true' AS JSON), '$.configPersisted', CAST('true' AS JSON))
          ELSE CAST(${encoded} AS JSON) END`);
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
