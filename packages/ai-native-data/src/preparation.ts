/** 只形成新库 AI 数据候选；完整包和所选能力由正式部署锁独立核定。
 * 本函数只返回 AI 材料，候选明确 pending，不生成伪 ready 收据或完整宿主部署锁。
 * 旧混合库、B02 桥接及生产迁移继续使用原升级/恢复链。 */
import { createHash } from "node:crypto";
import { composeAiNativePrismaSchema } from "./prisma-schema";
import { assertAiNativeDataContribution, type AiNativeDataContribution } from "./data";

/** 这些是本版提取的真实前置，不从运行 schema 推断新库或已执行迁移。 */
export const AI_NATIVE_DATA_PREREQUISITES = {
  database: "fresh-selected-host",
  platform: { models: 40, dataVersion: "0.1.8" },
  rental: { models: 121, dataVersion: "0.1.0",
    schemaSha256: "08dd7ecebeb5cc1f4a389ee13e062501e89cd7e5ef86bb821e9d58eaf050f7b1",
    migrationId: "rental.20261119030000-initial",
    migrationSha256: "59e69aadf4db0138561ec9233955941da32a2f27f576583bd7915b9f1a7d05ae" }
} as const;

export const AI_NATIVE_DATA_PREPARATION_GAPS = [
  { code: "locked-package-deployment-required",
    detail: "本结果只含 AI 材料；完整宿主须核定 dataCapabilities 的固定完整包，并通过正式迁移部署组合公共和 Core 材料。" },
  { code: "migration-execution-unverified",
    detail: "本候选未执行 DDL，尚无所选宿主原 Prisma 迁移收据、实际物理观察或升级恢复证据。" }
] as const;

/** 返回新的内存文件集合，不覆写既有候选或伪扩展 core.deployment.lock.json。 */
export function createAiNativeDataPreparation(input: {
  readonly baseSchema: string;
  readonly contribution: AiNativeDataContribution;
}) {
  const contribution = input.contribution;
  assertAiNativeDataContribution(contribution);
  const schema = composeAiNativePrismaSchema(input.baseSchema, contribution);
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const candidate = {
    formatVersion: 1, status: "prepared", deployment: "pending", owner: contribution.owner,
    source: contribution.source, dataSha256: contribution.sha256, data: contribution.data,
    baseSchemaSha256: hash(input.baseSchema), schemaSha256: hash(schema),
    prerequisites: AI_NATIVE_DATA_PREREQUISITES,
    migrations: contribution.migrations.map(({ id, name, originalName, sha256 }) => ({ id, name, originalName, sha256 })),
    blockers: AI_NATIVE_DATA_PREPARATION_GAPS
  } as const;
  const files = new Map<string, Uint8Array>([["schema.prisma", Buffer.from(schema)],
    ["ai-native.data.candidate.json", Buffer.from(JSON.stringify(candidate, null, 2) + "\n")]]);
  for (const migration of contribution.migrations)
    files.set(`migrations/${migration.name}/migration.sql`, Buffer.from(migration.sql));
  return { status: "prepared" as const, deployment: "pending" as const,
    candidate, schema, files, blockers: AI_NATIVE_DATA_PREPARATION_GAPS };
}
