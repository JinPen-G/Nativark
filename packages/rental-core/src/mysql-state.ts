/** Workspace recovery snapshots and their stored row revisions. Callers retain
 * the original tenant/workspace fence; revisions never replace category or
 * business-settings versions, nor authorize reading or replaying business facts. */
import { ConflictException, ServiceUnavailableException } from "@nestjs/common";
import { sqltag as sql, raw, join, type Sql } from "@prisma/client/runtime/library";
import { stripNotificationDraftSnapshotBodies } from "./notification-snapshot";
import type { RentalSnapshotTransaction, RentalSnapshotStore, RentalSnapshotConfig, RentalSnapshotContacts } from "./state-storage";

export type { RentalSnapshotTransaction, RentalSnapshotStore, RentalSnapshotConfig, RentalSnapshotContacts, RentalRecoverySnapshotRow } from "./state-storage";

export const RENTAL_CONFIGURATION_REVISION_MAX = 2_147_483_647;

// These are the original backfill's complete keys, plus the subsequently
// normalized pricing-group collection. Values are code-owned SQL identifiers.
// A different legacy key needs the original backfill's explicit mapping; this
// read-only check never guesses a replacement or replays a financial action.
const recoveryCollections = {
  core: {
    operators: ["rental_fulfillment_operators", "id"], locations: ["rental_fulfillment_locations", "id"],
    itemGroups: ["rental_item_groups", "id"], pricingGroups: ["rental_pricing_groups", "id"],
    couponTemplates: ["rental_coupon_templates", "id"], inspectionTemplates: ["rental_inspection_templates", "id"],
    assets: ["rental_assets", "id"], stockBalances: ["rental_stock_balances", "id"],
    orders: ["rental_orders", "id"], inspections: ["rental_inspection_records", "id"]
  },
  business: {
    pricingPlans: ["rental_pricing_plans", "id"], discountPlans: ["rental_discount_plans", "id"],
    services: ["rental_value_added_services", "id"], calendars: ["rental_business_calendars", "year"],
    ruleVersions: ["rental_rule_versions", "id"], quotes: ["rental_quotes", "id"],
    customerCoupons: ["rental_customer_coupons", "id"], rewardLedger: ["rental_reward_ledger_entries", "id"],
    benefitAccounts: ["rental_benefit_accounts", "customerId"], referrals: ["rental_referrals", "inviteeCustomerId"],
    notificationTemplates: ["rental_notification_templates", "id"], notificationLogs: ["rental_notification_logs", "id"]
  }
} as const;

/** MySQL raw unsigned integers may be bigint while model reads are number.
 * Normalize only bounded positive integers; missing or malformed rows remain
 * unavailable, without parsing strings or assuming an initial revision. */
export function readRentalConfigurationRevision(value: unknown, source: string): number {
  if (typeof value === "bigint" && value >= 1n && value <= BigInt(RENTAL_CONFIGURATION_REVISION_MAX)) {
    return Number(value);
  }
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
export async function writeRentalCoreConfigurationSnapshot(tx: RentalSnapshotTransaction, tenantId: string, workspaceId: string,
  initial: Record<string, unknown>, replacement: Sql) {
  const rows = await tx.$queryRaw<Array<{ tenantId: string; workspaceId: string; stateType: string; configurationChanged: unknown; configurationRevision: unknown }>>(
    sql`SELECT tenantId, workspaceId, configurationRevision, JSON_TYPE(state) AS stateType,
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
    const created = await tx.$executeRaw(sql`INSERT INTO rental_core_state_snapshots (workspaceId, tenantId, state, configurationRevision, updatedAt)
      VALUES (${workspaceId}, ${tenantId}, CAST(${JSON.stringify(initial)} AS JSON), 1, NOW(3))`);
    if (created !== 1) throw new ConflictException("Core快照配置创建结果不可核验");
    return 1;
  }
  const changed = await tx.$executeRaw(sql`UPDATE rental_core_state_snapshots
    SET state = ${replacement}, configurationRevision = ${revision! + 1}, updatedAt = NOW(3)
    WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId} AND configurationRevision = ${revision}`);
  if (changed !== 1) throw new ConflictException("Core快照配置行修订已变化，拒绝覆盖");
  return revision! + 1;
}

export class RentalStateRepository<TTransaction extends RentalSnapshotTransaction = RentalSnapshotTransaction> {
  constructor(
    private readonly store: RentalSnapshotStore<TTransaction>,
    private readonly config: RentalSnapshotConfig,
    private readonly contacts: RentalSnapshotContacts<TTransaction>
  ) {}

  enabled() {
    return (this.config.get<string>("PLATFORM_DATA_SOURCE") ?? "mysql").toLowerCase() === "mysql";
  }

  async loadCoreStates() {
    if (!this.enabled()) return [];
    return this.store.rentalCoreStateSnapshot.findMany();
  }

  async loadBusinessStates() {
    if (!this.enabled()) return [];
    return this.store.rentalBusinessStateSnapshot.findMany();
  }

  async loadTenantProfiles() {
    if (!this.enabled()) return [];
    return this.store.tenantRentalProfile.findMany({
      select: { tenantId: true, categoryCode: true }
    });
  }

  /** Before the normalized host opens requests, retain evidence of any legacy
   * records that have not been mapped. Existing normalized values win; this is
   * not a comparison of historical amounts with today's configuration. Missing
   * or remapped keys require the original migration/recovery process, not an
   * empty successful response or automatic snapshot backfill during a request. */
  async assertNormalizedRecovery(kind: "core" | "business") {
    if (!this.enabled()) return;
    const rows = kind === "core" ? await this.loadCoreStates() : await this.loadBusinessStates();
    const collections = recoveryCollections[kind];
    const metadata = kind === "core"
      ? ["profile", "businessSettings", "profilePersisted", "configPersisted", "sampleAssets", "sampleStockBalances", "sampleFactsEnsured"]
      : ["categoryCode", "configPersisted"];
    const known = new Set([...Object.keys(collections), ...metadata]);
    for (const row of rows) {
      const state = row.state;
      if (!state || typeof state !== "object" || Array.isArray(state)) throw new ServiceUnavailableException("历史Rental快照结构不可核验，请沿原恢复流程核对");
      for (const key of Object.keys(state)) {
        if (!known.has(key)) throw new ServiceUnavailableException(`历史Rental快照字段 ${key} 缺少正式恢复映射，原资料保留`);
      }
      const snapshot = state as Record<string, unknown>;
      await this.store.$transaction(async tx => {
        const workspace = await tx.$queryRaw<Array<{ tenantId: string }>>(sql`
          SELECT tenantId FROM business_workspaces WHERE id = ${row.workspaceId} AND tenantId = ${row.tenantId}`);
        if (workspace.length !== 1 || workspace[0].tenantId !== row.tenantId) throw new ServiceUnavailableException("历史Rental快照缺少原租户空间，原资料保留");
        for (const [field, [table, key]] of Object.entries(collections)) {
          const values = snapshot[field];
          if (values === undefined) continue;
          if (!Array.isArray(values)) throw new ServiceUnavailableException(`历史Rental快照 ${field} 结构不可核验`);
          const keys = values.map(value => {
            if (!value || typeof value !== "object" || Array.isArray(value)
              || (value.tenantId !== undefined && value.tenantId !== row.tenantId)
              || (value.workspaceId !== undefined && value.workspaceId !== row.workspaceId)) {
              throw new ServiceUnavailableException(`历史Rental快照 ${field} 归属不可核验`);
            }
            const original = value[key];
            if (key === "year" ? !Number.isSafeInteger(original) : typeof original !== "string" || !original) {
              throw new ServiceUnavailableException(`历史Rental快照 ${field} 缺少完整原键`);
            }
            if (field === "calendars") {
              if (typeof value.version !== "string" || !value.version) throw new ServiceUnavailableException("历史营业日历缺少原版本，不能用同年度其他版本补齐");
              // Old inline audit bodies have no durable mapping receipt in this
              // reader. Keep them for the original audit migration to verify.
              if (value.overrideAudits !== undefined && (!Array.isArray(value.overrideAudits) || value.overrideAudits.length)) {
                throw new ServiceUnavailableException("历史营业日历内嵌审计缺少正式迁移依据，原资料保留");
              }
              return `${original}:${value.version}`;
            }
            return original as string | number;
          });
          const keyExpression = field === "calendars" ? raw("CONCAT(CAST(`year` AS CHAR), ':', `version`)") : raw(`\`${key}\``);
          // Bound each query without interpreting a partial set as complete.
          for (let offset = 0; offset < keys.length; offset += 200) {
            const batch = keys.slice(offset, offset + 200);
            const present = await tx.$queryRaw<Array<{ originalKey: string | number }>>(sql`
              SELECT ${keyExpression} AS originalKey FROM ${raw(`\`${table}\``)}
              WHERE tenantId = ${row.tenantId} AND workspaceId = ${row.workspaceId}
                AND ${keyExpression} IN (${join(batch)})`);
            const existing = new Set(present.map(value => String(value.originalKey)));
            if (batch.some(value => !existing.has(String(value)))) {
              throw new ServiceUnavailableException(`历史Rental快照 ${field} 尚有未核定的原键或主档映射，请沿原恢复流程核对；原资料保留`);
            }
          }
        }
        if (kind === "core") {
          // Parent order existence alone does not prove that its nested original
          // lines/reservations/allocations survived an interrupted old backfill.
          for (const order of (snapshot.orders ?? []) as Array<Record<string, unknown>>) {
            for (const [field, table] of Object.entries({ lines: "rental_order_lines", reservations: "rental_reservations", allocations: "rental_allocations" })) {
              const children = order[field];
              if (children === undefined) continue;
              if (!Array.isArray(children)) throw new ServiceUnavailableException(`历史订单 ${field} 结构不可核验`);
              const keys = children.map(child => {
                if (!child || typeof child.id !== "string" || !child.id || (child.orderId !== undefined && child.orderId !== order.id)) {
                  throw new ServiceUnavailableException(`历史订单 ${field} 缺少完整原关联`);
                }
                return child.id as string;
              });
              for (let offset = 0; offset < keys.length; offset += 200) {
                const batch = keys.slice(offset, offset + 200);
                const present = await tx.$queryRaw<Array<{ originalKey: string }>>(sql`
                  SELECT child.id AS originalKey FROM ${raw(`\`${table}\``)} child
                  JOIN rental_orders parent ON parent.id = child.orderId
                  WHERE parent.tenantId = ${row.tenantId} AND parent.workspaceId = ${row.workspaceId}
                    AND child.orderId = ${order.id as string} AND child.id IN (${join(batch)})`);
                const existing = new Set(present.map(value => value.originalKey));
                if (batch.some(value => !existing.has(value))) throw new ServiceUnavailableException(`历史订单 ${field} 尚有未核定的原关联，原资料保留`);
              }
            }
          }
          for (const field of ["profile", "businessSettings"]) {
            const value = snapshot[field];
            if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value)
              || !("tenantId" in value) || value.tenantId !== row.tenantId)) {
              throw new ServiceUnavailableException(`历史Rental快照 ${field} 与快照租户不一致`);
            }
          }
          if (snapshot.businessSettings) {
            const settings = await tx.$queryRaw<Array<{ tenantId: string }>>(sql`
              SELECT tenantId FROM rental_tenant_business_settings WHERE tenantId = ${row.tenantId} AND workspaceId = ${row.workspaceId}`);
            if (settings.length !== 1) throw new ServiceUnavailableException("历史经营设置尚未完成规范化恢复，原资料保留");
          }
        }
      }, { isolationLevel: "ReadCommitted" });
    }
  }

  /**
   * SPACE-03：快照按**经营空间**存档。
   *
   * 主键换成 workspaceId 之后，每个空间各有自己的恢复副本，调用方不必再
   * 「固定挑默认空间」来避免互相覆盖。
   * 配置仓储已提交的档案路径须保留；采用后缺来源或旧来源的恢复副本拒绝写入，
   * 不把旧集合重新标记成当前版本，也不以快照重建正式经营事实。
   * 原事务调用者保留提交/回滚所有权；读取和CAS不得另开事务。
   */
  async saveCoreState(tenantId: string, workspaceId: string, state: unknown, existingTx?: TTransaction) {
    if (!this.enabled()) return;
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new ConflictException("Core快照配置结构无效");
    const encoded = JSON.stringify(state);
    // Capture one detached payload before waiting on locks. The CAS replacement
    // and initial insert must not observe different edits of the live cache.
    const snapshot: unknown = JSON.parse(encoded);
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new ConflictException("Core快照配置结构无效");
    const profile = "profile" in snapshot ? snapshot.profile as { categoryVersionId?: string; categoryAdoptionRevision?: number } : undefined;
    const expected = profile?.categoryVersionId && Number.isSafeInteger(profile.categoryAdoptionRevision)
      ? { categoryVersionId: profile.categoryVersionId, adoptionRevision: profile.categoryAdoptionRevision! } : undefined;
    const write = async (tx: TTransaction) => {
      const { binding } = await this.contacts.lockCategoryBinding(tx, tenantId, workspaceId, expected);
      if (!expected && binding.adoptionRevision > 0) throw new ConflictException("Core快照缺少当前采用来源，不能重新标记旧资料");
      // Explicit workspace profile edits are owned by the config repository.
      // Retain that path while replacing only the recovery snapshot collections.
      await writeRentalCoreConfigurationSnapshot(tx, tenantId, workspaceId, snapshot as Record<string, unknown>, sql`
        CASE WHEN JSON_EXTRACT(state, '$.profilePersisted') = CAST('true' AS JSON)
          THEN JSON_SET(CAST(${encoded} AS JSON), '$.profile', JSON_SET(JSON_EXTRACT(state, '$.profile'),
            '$.categoryVersionId', ${binding.categoryVersionId}, '$.categoryAdoptionRevision', ${binding.adoptionRevision}),
            '$.profilePersisted', CAST('true' AS JSON), '$.configPersisted', CAST('true' AS JSON))
          ELSE CAST(${encoded} AS JSON) END`);
      if (this.contacts.openingConfiguration) {
        await this.contacts.openingConfiguration(tx, { tenantId, workspaceId }, { kind: "core_snapshot", id: workspaceId });
      }
    };
    if (existingTx) await write(existingTx);
    else await this.store.$transaction(write, { isolationLevel: "ReadCommitted" });
  }

  /** Legacy snapshot hosts retain this writer. The normalized host has already
   * committed its facts and never calls it as a second admission after success. */
  async saveBusinessState(tenantId: string, workspaceId: string, state: unknown, existingTx?: TTransaction) {
    if (!this.enabled()) return;
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new ConflictException("业务快照结构无效");
    const encoded = JSON.stringify(stripNotificationDraftSnapshotBodies(state));
    const detached: unknown = JSON.parse(encoded);
    if (!detached || typeof detached !== "object" || Array.isArray(detached)) throw new ConflictException("业务快照结构无效");
    const write = async (tx: TTransaction) => {
      await this.contacts.lockCategoryBinding(tx, tenantId, workspaceId);
      const rows = await tx.$queryRaw<Array<{ tenantId: string; workspaceId: string }>>(sql`
        SELECT tenantId, workspaceId FROM rental_business_state_snapshots WHERE workspaceId = ${workspaceId} FOR UPDATE`);
      if (rows.length > 1 || rows.some(row => row.tenantId !== tenantId || row.workspaceId !== workspaceId)) {
        throw new ConflictException("业务快照已属于其他租户或空间，拒绝覆盖");
      }
      if (rows.length) {
        await tx.$executeRaw(sql`UPDATE rental_business_state_snapshots SET state = CAST(${encoded} AS JSON), updatedAt = NOW(3)
          WHERE tenantId = ${tenantId} AND workspaceId = ${workspaceId}`);
      } else {
        const created = await tx.$executeRaw(sql`INSERT INTO rental_business_state_snapshots (workspaceId, tenantId, state, updatedAt)
          VALUES (${workspaceId}, ${tenantId}, CAST(${encoded} AS JSON), NOW(3))`);
        if (created !== 1) throw new ConflictException("业务快照创建结果不可核验");
      }
    };
    if (existingTx) await write(existingTx);
    else await this.store.$transaction(write, { isolationLevel: "ReadCommitted" });
  }
}
