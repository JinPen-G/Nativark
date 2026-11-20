/** 明确启用 AI 的 Rental 装配入口。实际完整数据包、原迁移账与物理观察分别核定；
 * 不在无 AI 入口导入原 Runtime，不生成 Client、连接数据库或启动生命周期。 */
import { dirname, resolve } from "node:path";
import type { ConfigService } from "@nestjs/config";
import type { CoreDeploymentLock } from "@rental-os/core-contracts";
import { requireAiNativeDataPackage } from "@rental-os/ai-native-data/data-package";
import { createAiNativeMysqlDataPlanFromContribution } from "@rental-os/ai-native-data/mysql-data";
import { createRentalAiParticipants, requireRentalAiSelection } from "./ai-composition";
import { composeRentalApplication } from "./assembly";
import type { RentalDatabaseClient } from "./database";

export function composeRentalAiApplication(input: {
  database: RentalDatabaseClient;
  configuration: ConfigService;
  lock: CoreDeploymentLock;
}) {
  const lock = requireRentalAiSelection(input.lock);
  const root = resolve(dirname(require.resolve("@rental-os/ai-native-data/data-package")), "..");
  const installed = requireAiNativeDataPackage(root, lock.dataCapabilities![0]);
  const dataPlan = createAiNativeMysqlDataPlanFromContribution(installed.contribution);
  const participants = createRentalAiParticipants({ ...input, lock });
  return composeRentalApplication({ ...input, lock, aiMode: "enabled", ai: { ...participants, dataPlan } });
}

export type RentalAiHostAssembly = ReturnType<typeof composeRentalAiApplication>;
