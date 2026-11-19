/** 给已组合公共 + Rental 的宿主追加原 AI 模型和回指。
 * 此处借用纯 schema 组合器；不将 AI 注册为业务 Core，也不修改原 schema 文件。 */
import { composeCorePrismaSchema } from "@rental-os/core-contracts/prisma";
import { assertAiNativeDataContribution, type AiNativeDataContribution } from "./data";
import { AI_NATIVE_PRISMA_BASE_RELATIONS } from "./prisma-relations";

export { AI_NATIVE_PRISMA_BASE_RELATIONS } from "./prisma-relations";

/** 先 public + Rental，再追加 AI；单独的公共 40 模型不具备原业务关联。 */
export function composeAiNativePrismaSchema(base: string, contribution: AiNativeDataContribution): string {
  assertAiNativeDataContribution(contribution);
  return composeCorePrismaSchema(base, [{ id: "ai-native", schema: contribution.schema,
    publicRelations: AI_NATIVE_PRISMA_BASE_RELATIONS }]);
}
