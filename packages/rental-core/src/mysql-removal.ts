/** Rental 移除预检只读取原订单、支付/回调、作业配置及历史收据的存在性。
 * 原事务、执行者和恢复入口继续裁定业务结果；缺结构或读取证据保持 unknown。
 * 不按期限推断已排空，不补造历史执行版本，不重发或删除原操作。 */
import { empty, sqltag as sql } from "@prisma/client/runtime/library";
import { CoreScopeReferenceSchema, type CoreRemovalAssessment } from "@rental-os/core-contracts";
import type { CoreHostSqlTransaction } from "@rental-os/core-host/mysql";
import { RENTAL_CORE_ID } from "./core-identity";

type Existence = boolean | number | bigint;
interface RentalRemovalRow {
  unfinished: Existence;
  unresolved: Existence;
  callbacks: Existence;
  jobs: Existence;
  history: Existence;
  receipts: Existence;
}

export async function readRentalRemoval(reader: Pick<CoreHostSqlTransaction, "$queryRaw">,
  tenantId?: string): Promise<CoreRemovalAssessment> {
  const tenant = tenantId === undefined ? undefined : CoreScopeReferenceSchema.parse({
    coreId: RENTAL_CORE_ID, tenantId
  }).tenantId;
  const scope = tenant === undefined ? empty : sql`AND tenantId = ${tenant}`;
  const unavailable: CoreRemovalAssessment = { blockers: [{ kind: "unknown", code: "rental_removal_read_unavailable",
    message: "Rental 原业务依赖未返回完整存在性证据，须保留原执行者与历史读取" }] };
  try {
    const rows = await reader.$queryRaw<RentalRemovalRow[]>(sql`
      SELECT
        EXISTS(SELECT 1 FROM rental_orders WHERE status NOT IN ('completed', 'cancelled', 'no_show') ${scope}) AS unfinished,
        (EXISTS(SELECT 1 FROM rental_order_idempotency_records WHERE status <> 'succeeded' ${scope})
          OR EXISTS(SELECT 1 FROM rental_payment_intents WHERE status NOT IN ('paid', 'closed', 'failed') ${scope})
          OR EXISTS(SELECT 1 FROM rental_payment_refunds WHERE status NOT IN ('succeeded', 'failed', 'closed') ${scope})
          OR EXISTS(SELECT 1 FROM payment_webhook_events WHERE status <> 'processed' ${scope})
          OR EXISTS(SELECT 1 FROM rental_notification_logs WHERE (status = 'unknown' OR leaseUntil IS NOT NULL) ${scope})) AS unresolved,
        (EXISTS(SELECT 1 FROM rental_payment_intents WHERE 1 = 1 ${scope})
          OR EXISTS(SELECT 1 FROM rental_payment_refunds WHERE 1 = 1 ${scope})
          OR EXISTS(SELECT 1 FROM payment_webhook_events WHERE 1 = 1 ${scope})) AS callbacks,
        (EXISTS(SELECT 1 FROM rental_tenant_business_settings WHERE 1 = 1 ${scope})
          OR EXISTS(SELECT 1 FROM rental_notification_logs
            WHERE (status NOT IN ('sent', 'cancelled', 'skipped', 'failed') OR nextAttemptAt IS NOT NULL OR leaseUntil IS NOT NULL) ${scope})) AS jobs,
        (EXISTS(SELECT 1 FROM rental_orders WHERE 1 = 1 ${scope})
          OR EXISTS(SELECT 1 FROM customer_profiles WHERE 1 = 1 ${scope})
          OR EXISTS(SELECT 1 FROM business_workspaces WHERE 1 = 1 ${scope})
          OR EXISTS(SELECT 1 FROM tenant_rental_profiles WHERE 1 = 1 ${scope})
          OR EXISTS(SELECT 1 FROM rental_core_state_snapshots WHERE 1 = 1 ${scope})
          OR EXISTS(SELECT 1 FROM rental_notification_logs WHERE 1 = 1 ${scope})) AS history,
        EXISTS(SELECT 1 FROM rental_order_idempotency_records WHERE 1 = 1 ${scope}) AS receipts`);
    const row = rows[0];
    const values = [row?.unfinished, row?.unresolved, row?.callbacks, row?.jobs, row?.history, row?.receipts];
    const knownValues: readonly unknown[] = [true, false, 0, 1, 0n, 1n];
    if (rows.length !== 1 || values.some(value => !knownValues.includes(value))) return unavailable;
    const present = (value: Existence) => value === true || value === 1 || value === 1n;
    const blockers: CoreRemovalAssessment["blockers"] = [];
    if (present(row.unfinished)) blockers.push({ kind: "in_flight", code: "rental_unfinished_orders",
      message: "存在未完成的原租赁订单，须保留原履约和结算执行者" });
    if (present(row.unresolved)) blockers.push({ kind: "unknown", code: "rental_original_results_unresolved",
      message: "存在未形成确定终态的原操作、支付或投递结果，只能按原键和原收据核对" });
    if (present(row.callbacks)) blockers.push({ kind: "callback", code: "rental_payment_callbacks_retained",
      message: "存在原支付、退款或回调记录，须保留原签名归属、迟到回调和资金核对实现" });
    if (present(row.jobs)) blockers.push({ kind: "job", code: "rental_original_jobs_retained",
      message: "存在原作业配置或通知队列，须保留原登记执行者和善后准入" });
    if (present(row.history)) blockers.push({ kind: "history", code: "rental_history_retained",
      message: "存在原订单、会员、经营空间或配置历史，须保留当前受权的原事实读取" });
    if (present(row.receipts)) blockers.push({ kind: "history", code: "rental_operation_receipts_retained",
      message: "存在原业务操作键和响应收据，须保留原请求摘要及原结果核对实现" });
    return { blockers };
  } catch {
    return unavailable;
  }
}
