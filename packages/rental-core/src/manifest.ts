/** Rental 发行清单由固定构建输入生成；源码目录不携带伪造的发布提交。
 * 权限声明与页面/原角色映射同源；声明本身不授予租户、成员或经营空间权限。 */
import { CoreManifestSchema, type CoreManifest } from "@rental-os/core-contracts";
import { RENTAL_CORE_ID, RENTAL_CORE_SCOPE, RENTAL_CORE_VERSION } from "./core-identity";
import { RENTAL_DATA_MIGRATIONS, RENTAL_DATA_READABLE, RENTAL_DATA_VERSION, RENTAL_PRISMA_SCHEMA } from "./data";
import { RENTAL_PERMISSION_DECLARATIONS } from "./permissions";

export function createRentalManifest(input: {
  source: CoreManifest["source"];
  /** 来自实际构建字节清单；缺失的入口、声明和相对依赖由打包入口拒绝。 */
  assets: readonly string[];
  contributions?: Pick<CoreManifest["entries"], "openapi" | "ai" | "jobs" | "events">;
}): CoreManifest {
  return CoreManifestSchema.parse({
    manifestVersion: 1, id: RENTAL_CORE_ID, name: "Rental Core",
    description: "保留品类、经营空间、会员、报价订单、履约资金及各端接口的租赁业务 Core",
    author: "Nativark contributors", version: RENTAL_CORE_VERSION, source: input.source, license: "MIT",
    compatibility: {
      // 原按钮变体与同事务部署观察要求底座0.1.10；旧底座须在加载前拒绝本版Core。
      platform: { minInclusive: "0.1.10", maxExclusive: "0.2.0" },
      contract: { minInclusive: "0.1.1", maxExclusive: "0.2.0" }
    },
    runtime: { node: { minInclusive: "22.12.0", maxExclusive: "25.0.0" } },
    entries: { server: "dist/server.js", admin: "admin/index.tsx", ...input.contributions },
    permissions: RENTAL_PERMISSION_DECLARATIONS, scope: RENTAL_CORE_SCOPE,
    data: { version: RENTAL_DATA_VERSION, readable: RENTAL_DATA_READABLE,
      migrations: RENTAL_DATA_MIGRATIONS.map(({ id, file, sha256 }) => ({ id, file, sha256 })) },
    requires: [],
    assets: [...new Set(["package.json", RENTAL_PRISMA_SCHEMA.file, "prisma/migrations/migration_lock.toml", ...input.assets])].sort()
  });
}
