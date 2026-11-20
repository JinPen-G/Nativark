/** 同宿主读取目标 Core 的平台台账和原部署准入，不停止、排空或删除对象。
 * 公共表没有 Core 外键：只认原 Rental 命名或同租户业务引用，其他归属明确留缺口。
 * 终态记录仍需原历史读取；TTL、归档和租约到期均不证明原执行/回调已结束。 */
import { join, raw, sqltag as sql, type Sql } from "@prisma/client/runtime/library";
import { CorePlatformRemovalObservationSchema, CoreRemovalAssessmentSchema, CoreRemovalQuerySchema,
  type CorePlatformRemovalObservation, type CoreRemovalAssessment } from "@rental-os/core-contracts";
import type { CorePlatformRemovalSource } from "@rental-os/core-host";
import type { CoreHostSqlClient, CoreHostSqlTransaction } from "@rental-os/core-host/mysql";

type Reader = Pick<CoreHostSqlTransaction, "$queryRaw">;
type Blocker = CoreRemovalAssessment["blockers"][number];
export interface RentalAiRemovalDependencies {
  read(coreId: string): Promise<CoreRemovalAssessment & { complete: boolean }>;
}
const present = (value: unknown) => value === true || value === 1 || value === 1n;
const existence = (value: unknown) => value === true || value === false || value === 0 || value === 1 || value === 0n || value === 1n;

/** 某表缺失不能抹掉其他来源已观察到的在途/历史证据。 */
async function observe(reader: Reader, query: Sql, code: string, message: string,
  facts: Record<string, Blocker>, blockers: Blocker[]): Promise<boolean> {
  try {
    const rows = await reader.$queryRaw<Array<Record<string, unknown>>>(query);
    if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]
      || Object.keys(facts).some(key => !existence(rows[0][key]))) throw Error("invalid observation");
    for (const [key, blocker] of Object.entries(facts)) if (present(rows[0][key])) blockers.push(blocker);
    return true;
  } catch {
    blockers.push({ kind: "unknown", code, message });
    return false;
  }
}

// 固定原写入种类见 RentalFileBusinessReferences / RentalIntegrationRuntime。
// 通用别名须命中同租户原对象；不读取 payload.coreId 或按租户拥有Rental推定归属。
const rentalTypes = ["rental_order", "rental_quote", "rental_item_group", "rental_asset", "rental_work_order", "order_contract",
  "data_exchange_stations", "data_exchange_vehicles", "data_exchange_members", "data_exchange_corporates", "data_exchange_orders", "data_exchange_import_report"];
function rentalReference(): Sql {
  return sql`(r.businessType IN (${join(rentalTypes)})
    OR (r.businessType = 'order' AND EXISTS(SELECT 1 FROM rental_orders o WHERE o.id = r.businessId AND o.tenantId = r.tenantId))
    OR (r.businessType = 'quote' AND EXISTS(SELECT 1 FROM rental_quotes o WHERE o.id = r.businessId AND o.tenantId = r.tenantId))
    OR (r.businessType IN ('customer', 'customer_profile') AND EXISTS(SELECT 1 FROM customer_profiles o WHERE o.id = r.businessId AND o.tenantId = r.tenantId))
    OR (r.businessType = 'work_order' AND EXISTS(SELECT 1 FROM rental_work_orders o WHERE o.id = r.businessId AND o.tenantId = r.tenantId))
    OR (r.businessType = 'item_group' AND EXISTS(SELECT 1 FROM rental_item_groups o WHERE o.id = r.businessId AND o.tenantId = r.tenantId))
    OR (r.businessType = 'asset' AND EXISTS(SELECT 1 FROM rental_assets o WHERE o.id = r.businessId AND o.tenantId = r.tenantId))
    OR (r.businessType IN ('customer_contract','corporate_contract') AND EXISTS(SELECT 1 FROM customer_corporate_contracts o WHERE o.id = r.businessId AND o.tenantId = r.tenantId))
    OR (r.businessType IN ('customer_invoice_profile','invoice_profile') AND EXISTS(SELECT 1 FROM customer_corporate_invoice_profiles o WHERE o.id = r.businessId AND o.tenantId = r.tenantId))
    OR (r.businessType IN ('customer_credit','credit') AND EXISTS(SELECT 1 FROM customer_corporate_credits o WHERE o.id = r.businessId AND o.tenantId = r.tenantId))
    OR (r.businessType = 'membership_review' AND EXISTS(SELECT 1 FROM customer_membership_reviews o WHERE o.id = r.businessId AND o.tenantId = r.tenantId))
    OR (r.businessType = 'document_print_job' AND EXISTS(SELECT 1 FROM DocumentPrintJob o WHERE o.id = r.businessId AND o.tenantId = r.tenantId))
    OR (r.businessType = 'async_job' AND EXISTS(SELECT 1 FROM AsyncJob o WHERE o.id = r.businessId AND o.tenantId = r.tenantId
      AND o.businessType IN (${join(rentalTypes)})))
    OR (r.businessType = 'tbox_device' AND EXISTS(SELECT 1 FROM TBoxDevice o WHERE o.id = r.businessId AND o.tenantId = r.tenantId)))`;
}

export function createRentalCoreRemovalSource<Tx extends CoreHostSqlTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  readAdmission?(coreId: string): Promise<CorePlatformRemovalObservation["admission"]>;
  /** 由固定 AI 数据宿主装配；未装运行时不等于没有旧 AI 数据。 */
  aiDependencies?: RentalAiRemovalDependencies;
}): CorePlatformRemovalSource {
  return { async read(value) {
    const { coreId } = CoreRemovalQuerySchema.parse({ coreId: value });
    const blockers: Blocker[] = [];
    let complete = true;
    try {
      await input.database.$transaction(async transaction => {
        complete = await observe(transaction, sql`SELECT EXISTS(SELECT 1 FROM platform_core_bindings WHERE core_id = ${coreId}) AS bindings`,
          "platform_core_bindings_read_unavailable", "目标 Core 的原业务绑定结构或存在性不可核定", {
            bindings: { kind: "history", code: "platform_core_bindings_retained", message: "存在目标 Core 原业务绑定，须保留范围解析和当前受权历史读取" }
          }, blockers) && complete;
        const owned = rentalReference();
        for (const source of [
          { table: "AsyncJob", code: "platform_async_jobs", label: "公共异步任务", owner: owned,
            active: sql`r.status NOT IN ('success', 'failed', 'skipped')`, kind: "job" as const },
          { table: "FileAsset", code: "platform_files", label: "公共文件及上传/清理", owner: sql`(${owned} OR r.businessModule IN ('rental-core', 'rental-os')
              OR (r.businessModule = 'ai-native' AND r.businessType = 'ai_knowledge_document'))`,
            active: sql`(r.status IN ('pending_upload', 'delete_pending', 'delete_in_progress') OR EXISTS(SELECT 1 FROM file_upload_sessions u
              WHERE u.fileAssetId = r.id AND u.tenantId = r.tenantId
                AND (u.status NOT IN ('completed', 'failed') OR u.cleanupError IS NOT NULL)))`, kind: "job" as const },
          { table: "ExternalAdapterLog", code: "platform_adapter_receipts", label: "原外部适配调用收据", owner: owned,
            active: sql`r.status NOT IN ('success', 'mock_success', 'failed')`, kind: "callback" as const },
          { table: "NotificationSendLog", code: "platform_notification_receipts", label: "公共通知投递收据", owner: owned,
            active: sql`r.status NOT IN ('sent', 'success', 'mock_success', 'failed')`, kind: "callback" as const }
        ]) {
          // 标识符全部来自源码闭集；目标Core及客户端值不拼接SQL。
          const table = raw(source.table), target = coreId === "rental", before = blockers.length;
          const known = await observe(transaction, sql`SELECT
            EXISTS(SELECT 1 FROM ${table} r WHERE ${target} AND ${source.owner}) AS history,
            EXISTS(SELECT 1 FROM ${table} r WHERE ${target} AND ${source.owner} AND ${source.active}) AS active,
            EXISTS(SELECT 1 FROM ${table} r WHERE NOT COALESCE(${source.owner}, FALSE)) AS unowned`,
          source.code + "_read_unavailable", source.label + "的原表/关联或存在性不可核定", {
            history: { kind: "history", code: source.code + "_retained", message: source.label + "仍需 Rental 原业务归属及历史结果读取" },
            active: { kind: source.kind, code: source.code + "_unresolved", message: source.label + "仍有非确定终态，不能按TTL、尝试次数或空进程推定完成" },
            unowned: { kind: "unknown", code: source.code + "_ownership_missing", message: source.label + "缺可信 Core 归属；仅有业务种类/JSON或无法命中原对象不能证明与目标Core无关" }
          }, blockers);
          complete = known && !blockers.slice(before).some(item => item.code === source.code + "_ownership_missing") && complete;
        }
        complete = await observe(transaction, sql`SELECT EXISTS(SELECT 1 FROM file_upload_sessions u
          LEFT JOIN FileAsset f ON f.id = u.fileAssetId AND f.tenantId = u.tenantId WHERE f.id IS NULL) AS orphan`,
        "platform_upload_sessions_read_unavailable", "公共上传会话与原文件的同租户关联无法读取", {
          orphan: { kind: "unknown", code: "platform_upload_session_owner_missing", message: "存在缺少原文件归属的上传/清理会话，不能证明目标Core无依赖" }
        }, blockers) && complete;
      }, { isolationLevel: "ReadCommitted" });
    } catch {
      complete = false;
      blockers.push({ kind: "unknown", code: "platform_removal_transaction_unavailable", message: "平台依赖观察事务不可用，已观察原记录继续保留" });
    }
    if (blockers.some(item => item.code === "platform_upload_session_owner_missing")) complete = false;
    if (coreId === "rental") {
      try {
        if (!input.aiDependencies) throw Error("missing source");
        const result = await input.aiDependencies.read(coreId);
        const parsed = CoreRemovalAssessmentSchema.safeParse({ blockers: result?.blockers });
        if (!parsed.success || typeof result.complete !== "boolean"
          || parsed.data.blockers.some(item => item.operation && item.operation.coreId !== coreId)) throw Error("invalid source");
        blockers.push(...parsed.data.blockers); complete = result.complete && complete;
      } catch {
        complete = false;
        blockers.push({ kind: "unknown", code: "rental_ai_dependency_source_missing", message: "Rental 原AI任务、知识/文件及执行收据来源缺失或不可读；未挂AI运行时不证明没有历史依赖" });
      }
    }
    let admission: CorePlatformRemovalObservation["admission"] = "unknown";
    try {
      // 所有可能等待的依赖读取之后再观察原部署状态。
      const parsed = CorePlatformRemovalObservationSchema.shape.admission.safeParse(await input.readAdmission?.(coreId));
      if (parsed.success) admission = parsed.data;
    } catch { /* 保留 unknown，不能将读取失败解释成 stopped。 */ }
    return { admission, complete, blockers };
  } };
}

/** 当前 AI 数据贡献明确依赖 Rental；Workspace 外键指向原 BusinessWorkspace。
 * 不导入 AI Runtime、不取模型配置/正文/凭据。缺Core归属的租户/平台历史保持缺口；
 * 不用 Rental 原AI记录阻挡工单等其他Core。 */
export function createRentalAiRemovalDependencies<Tx extends CoreHostSqlTransaction>(database: CoreHostSqlClient<Tx>): RentalAiRemovalDependencies {
  return { async read(value) {
    const { coreId } = CoreRemovalQuerySchema.parse({ coreId: value });
    if (coreId !== "rental") return { complete: true, blockers: [] };
    const blockers: Blocker[] = []; let complete = true;
    try {
      await database.$transaction(async tx => {
        const scope = sql`EXISTS(SELECT 1 FROM ai_scopes s JOIN business_workspaces w ON w.id = s.workspaceId AND w.tenantId = s.tenantId
          WHERE s.id = t.scopeId AND s.kind = 'workspace')`;
        complete = await observe(tx, sql`SELECT
          EXISTS(SELECT 1 FROM ai_tasks t WHERE ${scope}) AS history,
          EXISTS(SELECT 1 FROM ai_tasks t WHERE ${scope} AND t.status NOT IN ('succeeded','partially_succeeded','failed','cancelled')) AS active,
          EXISTS(SELECT 1 FROM ai_runs r JOIN ai_tasks t ON t.id = r.taskId AND t.scopeId = r.scopeId
            WHERE ${scope} AND (r.leaseOwnerId IS NOT NULL OR r.leaseExpiresAt IS NOT NULL)) AS leased,
          EXISTS(SELECT 1 FROM ai_steps r JOIN ai_tasks t ON t.id = r.taskId AND t.scopeId = r.scopeId
            WHERE ${scope} AND (r.status = 'unknown' OR r.effect = 'possible')) AS unresolved,
          EXISTS(SELECT 1 FROM ai_tasks t WHERE NOT ${scope}) AS unowned`,
        "rental_ai_tasks_read_unavailable", "原AI Task/Run/Step/scope结构或归属读取不可用", {
          history: { kind: "history", code: "rental_ai_tasks_retained", message: "原AI任务及关联Run/Step/Plan、审批和结果收据仍依赖Rental事实读取" },
          active: { kind: "in_flight", code: "rental_ai_tasks_in_flight", message: "存在未终结原AI任务，归档/取消请求不等于执行已完成" },
          leased: { kind: "in_flight", code: "rental_ai_leases_retained", message: "原Run仍记录租约；过期不证明原执行、占用或外部结果已结清" },
          unresolved: { kind: "unknown", code: "rental_ai_effects_unknown", message: "原Step保留unknown或可能已产生效果，只能沿原调用与收据核对" },
          unowned: { kind: "unknown", code: "rental_ai_task_scope_missing", message: "原AI任务缺同租户Rental空间归属，不能由scene文本或模型内容猜Core" }
        }, blockers) && complete;
        complete = await observe(tx, sql`SELECT EXISTS(SELECT 1 FROM ai_usage_ledger_entries) AS history,
          EXISTS(SELECT 1 FROM ai_usage_ledger_entries l WHERE NOT EXISTS(SELECT 1 FROM ai_usage_reservations r
            JOIN business_workspaces w ON w.id = r.workspaceId AND w.tenantId = r.tenantId
            WHERE r.id = l.reservationId AND r.tenantId = l.tenantId)) AS unowned`,
        "rental_ai_usage_ledger_read_unavailable", "原AI用量收据与原占用关联不可读", {
          history: { kind: "history", code: "rental_ai_usage_ledger_retained", message: "存在原AI用量收据，须保留同一占用和当前受权账本读取" },
          unowned: { kind: "unknown", code: "rental_ai_usage_ledger_scope_missing", message: "原AI用量收据缺同租户原占用/空间归属，不能补造归属或解释为零消耗" }
        }, blockers) && complete;
        complete = await observe(tx, sql`SELECT
          EXISTS(SELECT 1 FROM ai_budget_reservations) AS history,
          EXISTS(SELECT 1 FROM ai_budget_reservations WHERE status NOT IN ('settled','released') OR dispatchState = 'unknown' OR unknownReason IS NOT NULL) AS unresolved,
          EXISTS(SELECT 1 FROM ai_budget_reservations r LEFT JOIN ai_scopes s ON s.id = r.scopeId
            LEFT JOIN business_workspaces w ON w.id = s.workspaceId AND w.tenantId = s.tenantId
            WHERE s.kind <> 'workspace' OR w.id IS NULL OR NOT (r.tenantId <=> s.tenantId) OR NOT (r.workspaceId <=> s.workspaceId)) AS unowned`,
        "rental_ai_budget_read_unavailable", "原AI预算占用及派发归属读取不可用", {
          history: { kind: "history", code: "rental_ai_budget_receipts_retained", message: "存在原AI预算/派发占用记录，必须保留同一账本及原收据解释" },
          unresolved: { kind: "unknown", code: "rental_ai_budget_unresolved", message: "原AI占用或派发结果未核定，过期不能释放或重发" },
          unowned: { kind: "unknown", code: "rental_ai_budget_scope_missing", message: "原AI平台/租户预算或旧记录未具备可信Core归属，保留原账本核对路径" }
        }, blockers) && complete;
        complete = await observe(tx, sql`SELECT
          EXISTS(SELECT 1 FROM ai_business_failure_outbox) AS history,
          EXISTS(SELECT 1 FROM ai_business_failure_outbox WHERE status <> 'closed' OR leaseOwner IS NOT NULL OR leaseUntil IS NOT NULL) AS active`,
        "rental_ai_outbox_read_unavailable", "原Rental AI业务失败出箱结构或存在性不可读", {
          history: { kind: "history", code: "rental_ai_outbox_retained", message: "原业务失败出箱引用Rental订单/通知/退款/检查事实，须保留原事件和处理收据" },
          active: { kind: "job", code: "rental_ai_outbox_unresolved", message: "原失败出箱未闭合或仍有租约，expired/重试耗尽不能证明任务及外部效果结束" }
        }, blockers) && complete;
        // 无任务的原稿/知识/检查/授权根记录也不能被空 ai_tasks 掩盖。
        // 根表的子记录沿原 schema 外键保留；每张根表单独报告结构/归属缺口。
        const workspaceRoots = ["ai_desktop_business_policies", "ai_desktop_business_policy_operations", "ai_client_scene_materials",
          "ai_client_task_policies", "ai_automation_subjects", "ai_knowledge_action_policies", "ai_knowledge_policy_management_authorities",
          "ai_inspection_drafts", "ai_inspection_evidence_bindings", "ai_knowledge_documents", "ai_knowledge_index_generations",
          "ai_structured_memories", "ai_memory_operations", "ai_human_confirmations", "ai_data_erasures", "ai_scopes", "ai_legacy_b02_scopes",
          "ai_invocation_admissions", "ai_usage_reservations"];
        for (const table of workspaceRoots) {
          const name = raw(table);
          complete = await observe(tx, sql`SELECT EXISTS(SELECT 1 FROM ${name}) AS history,
            EXISTS(SELECT 1 FROM ${name} r WHERE NOT EXISTS(SELECT 1 FROM business_workspaces w
              WHERE w.id = r.workspaceId AND w.tenantId = r.tenantId)) AS unowned`,
          table + "_removal_read_unavailable", table + " 原资料/关联无法核定", {
            history: { kind: "history", code: table + "_retained", message: table + " 保留原资料、策略或操作收据，不能随代码移除丢失原读取" },
            unowned: { kind: "unknown", code: table + "_scope_missing", message: table + " 缺同租户原空间归属，不能推断Core依赖已清空" }
          }, blockers) && complete;
        }
        for (const table of ["ai_tenant_model_configurations", "ai_tenant_ai_allowances", "ai_tenant_ai_credit_requests", "ai_gateway_price_records"]) {
          complete = await observe(tx, sql`SELECT EXISTS(SELECT 1 FROM ${raw(table)}) AS retained`,
          table + "_removal_read_unavailable", table + " 原归属记录不可读", {
            retained: { kind: "unknown", code: table + "_scope_missing", message: table + " 未提供可完整映射至Core的原历史归属，须保留原记录及执行/读取依赖" }
          }, blockers) && complete;
        }
      }, { isolationLevel: "ReadCommitted" });
    } catch { complete = false; blockers.push({ kind: "unknown", code: "rental_ai_removal_transaction_unavailable", message: "原AI依赖观察事务失败，不能证明历史及执行依赖为空" }); }
    if (blockers.some(item => item.code.endsWith("_scope_missing"))) complete = false;
    return { complete, blockers };
  } };
}
