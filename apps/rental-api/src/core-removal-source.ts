/** 同一宿主只读目标 Core 的业务绑定依赖，并读取可信部署 admission。
 * 公共授权和绑定收据沿原独立读取者保留；业务绑定的范围解析仍由 Core 供给。
 * 未接齐平台任务、文件、回调及历史依赖时 complete 保持 false；租户停用不证明部署停新。
 * 不停止进程、改变授权、排空或执行代码移除。 */
import { sqltag as sql } from "@prisma/client/runtime/library";
import { CorePlatformRemovalObservationSchema, CoreRemovalQuerySchema,
  type CorePlatformRemovalObservation, type CoreRemovalAssessment } from "@rental-os/core-contracts";
import type { CorePlatformRemovalSource } from "@rental-os/core-host";
import type { CoreHostSqlClient, CoreHostSqlTransaction } from "@rental-os/core-host/mysql";

type Existence = boolean | number | bigint;
interface PlatformRemovalRow {
  bindings: Existence;
}

export function createRentalCoreRemovalSource<Tx extends CoreHostSqlTransaction>(input: {
  database: CoreHostSqlClient<Tx>;
  /** 受控宿主提供与新准入检查同源的部署状态；缺源、无效状态或读取失败保持 unknown。 */
  readAdmission?(coreId: string): Promise<CorePlatformRemovalObservation["admission"]>;
}): CorePlatformRemovalSource {
  const { database, readAdmission } = input;
  return {
    async read(value) {
      const { coreId } = CoreRemovalQuerySchema.parse({ coreId: value });
      const blockers: CoreRemovalAssessment["blockers"] = [];
      try {
        const rows = await database.$transaction(transaction => transaction.$queryRaw<PlatformRemovalRow[]>(sql`
          SELECT EXISTS(SELECT 1 FROM platform_core_bindings WHERE core_id = ${coreId}) AS bindings`),
        { isolationLevel: "ReadCommitted" });
        const row = rows[0];
        const knownValues: readonly unknown[] = [true, false, 0, 1, 0n, 1n];
        if (rows.length !== 1 || !knownValues.includes(row?.bindings)) {
          blockers.push({ kind: "unknown", code: "platform_core_removal_read_unavailable",
            message: "目标 Core 的业务绑定未返回完整存在性证据" });
        } else if (row.bindings === true || row.bindings === 1 || row.bindings === 1n) {
          blockers.push({ kind: "history", code: "platform_core_bindings_retained",
            message: "存在目标 Core 的原业务绑定，须保留其范围解析和当前受权历史读取" });
        }
      } catch {
        blockers.push({ kind: "unknown", code: "platform_core_removal_read_unavailable",
          message: "目标 Core 的公共依赖读取不可用，不能证明已排空" });
      }
      let admission: CorePlatformRemovalObservation["admission"] = "unknown";
      if (readAdmission) {
        try {
          // 在公共依赖读取之后取当前状态，不能复用异步等待前的 stopped 观察。
          const observed = CorePlatformRemovalObservationSchema.shape.admission.safeParse(await readAdmission(coreId));
          if (observed.success) admission = observed.data;
        } catch {
          admission = "unknown";
        }
      }
      return { admission, complete: false, blockers };
    }
  };
}
