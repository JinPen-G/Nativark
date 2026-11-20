/** Rental 移除预检只读取原订单、支付/回调、作业配置及历史收据的存在性。
 * 原事务、执行者和恢复入口继续裁定业务结果；缺结构或读取证据保持 unknown。
 * 不按期限推断已排空，不补造历史执行版本，不重发或删除原操作。 */
import { empty, raw, sqltag as sql } from "@prisma/client/runtime/library";
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
  const blockers: CoreRemovalAssessment["blockers"] = [];
  const knownValues: readonly unknown[] = [true, false, 0, 1, 0n, 1n];
  const present = (value: Existence) => value === true || value === 1 || value === 1n;
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
    if (!Array.isArray(rows) || rows.length !== 1 || values.some(value => !knownValues.includes(value))) throw Error("invalid existence");
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
  } catch { blockers.push(...unavailable.blockers); }
    // 原资料的独立根记录不能由“没有订单”替代；终态/取消/撤销仍是历史。
    // 表名来自固定源码清单，租户仍参数绑定。子表沿原必需外键追溯这些根。
    const roots = ["business_workspaces", "customer_profiles", "client_channel_profiles", "website_channel_profiles",
      "website_assets", "mini_program_channels", "client_registration_challenges", "customer_membership_registration_settings",
      "enterprise_portal_tenant_settings", "enterprise_invite_policies", "enterprise_portal_operations", "customer_membership_plans",
      "DocumentPrintJob", "TBoxDevice"];
    for (const table of roots) {
      try {
        const found = await reader.$queryRaw<Array<{ retained: Existence }>>(sql`SELECT EXISTS(SELECT 1 FROM ${raw(table)} WHERE 1 = 1 ${scope}) AS retained`);
        if (found.length !== 1 || !knownValues.includes(found[0]?.retained)) throw Error("invalid existence");
        if (present(found[0].retained)) blockers.push({ kind: "history", code: table.toLowerCase() + "_removal_history",
          message: table + " 存在原资料、配置或操作收据，须保留其当前受权读取和历史解释" });
      } catch {
        blockers.push({ kind: "unknown", code: table.toLowerCase() + "_removal_read_unavailable",
          message: table + " 原根记录结构或归属无法读取，不能由空订单推断没有历史依赖" });
      }
    }
    try {
      const work = await reader.$queryRaw<Array<{ printing: Existence; pricing: Existence; offline: Existence }>>(sql`SELECT
        EXISTS(SELECT 1 FROM DocumentPrintJob WHERE status NOT IN ('mock_generated','generated','completed','failed') ${scope}) AS printing,
        EXISTS(SELECT 1 FROM rental_price_adjustment_plans WHERE status NOT IN ('applied','cancelled','failed') ${scope}) AS pricing,
        EXISTS(SELECT 1 FROM rental_offline_payment_registrations WHERE status = 'pending' ${scope}) AS offline`);
      if (work.length !== 1 || [work[0]?.printing, work[0]?.pricing, work[0]?.offline].some(value => !knownValues.includes(value))) throw Error("invalid existence");
      if (present(work[0].printing)) blockers.push({ kind: "job", code: "rental_print_jobs_retained", message: "原打印任务未形成确定终态，必须保留原模板、文件引用和任务执行者" });
      if (present(work[0].pricing)) blockers.push({ kind: "job", code: "rental_pricing_jobs_retained", message: "原调价草稿或待执行计划仍存在，不能按计划时间已过推定执行完成" });
      if (present(work[0].offline)) blockers.push({ kind: "in_flight", code: "rental_offline_payments_pending", message: "原线下付款登记仍待确认，不能以缺在线支付记录当作未付款或已结清" });
    } catch {
      blockers.push({ kind: "unknown", code: "rental_pending_work_read_unavailable", message: "原打印、调价或线下付款待处理来源不可读，须保留原执行者" });
    }
    // 全部署检查还需保留全局品类版本及散列限流记录；租户范围不能猜散列归属。
    if (tenant === undefined) {
      for (const table of ["rental_category_definitions", "client_api_rate_buckets"]) {
        try {
          const found = await reader.$queryRaw<Array<{ retained: Existence }>>(sql`SELECT EXISTS(SELECT 1 FROM ${raw(table)}) AS retained`);
          if (found.length !== 1 || !knownValues.includes(found[0]?.retained)) throw Error("invalid existence");
          if (present(found[0].retained)) blockers.push({ kind: "history", code: table + "_removal_history", message: table + " 保留原品类/历史版本或安全计数，代码移除不能丢失原解释" });
        } catch { blockers.push({ kind: "unknown", code: table + "_removal_read_unavailable", message: table + " 原全局历史来源不可核定" }); }
      }
    }
  return { blockers };
}
