/** 部署者显式同步已核定工单包权限；不启动HTTP、迁移或授予任何租户/成员使用权。 */
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { CoreDeploymentLockSchema } from "@rental-os/core-contracts";
import { registerPlatformCorePermissions } from "@rental-os/platform-core-host";
import { PlatformDatabaseClient } from "@rental-os/platform-api/database";
import { requireTicketsDeploymentPackage } from "./deployment-package";

async function register() {
  if (!process.env.DATABASE_URL || !process.env.CORE_DEPLOYMENT_LOCK)
    throw new Error("工单权限登记须配置独立DATABASE_URL与固定CORE_DEPLOYMENT_LOCK路径");
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(readFileSync(process.env.CORE_DEPLOYMENT_LOCK, "utf8")));
  if (lock.cores.length !== 1 || lock.cores[0].manifest.id !== "example-tickets") throw new Error("本宿主只登记所选工单Core");
  const { manifest } = requireTicketsDeploymentPackage(lock.cores[0], lock.platform.versions);
  const database = new PlatformDatabaseClient();
  try {
    const result = await database.$transaction(tx => registerPlatformCorePermissions(tx, [manifest]), { isolationLevel: "Serializable" });
    process.stdout.write(JSON.stringify({ status: "registered", ...result }) + "\n");
  } finally { await database.$disconnect(); }
}

void register().catch(error => {
  // 数据库异常可能含连接配置；部署失败只输出稳定错误码，输入/冲突说明留可信核验入口处理。
  const code = error && typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : "registration_failed";
  process.stderr.write(`工单权限登记失败：${code}。核对固定包、目录归属及独立数据库。\n`);
  process.exitCode = 1;
});
