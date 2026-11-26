/** Shared selection for the opt-in API and its explicit deployment command. */
import { isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CORE_CONTRACT_VERSION, CoreDeploymentLockSchema, checkPlatformDataCapabilities } from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS } from "@rental-os/core-contracts/archive";
import { readPlatformDataCapabilityPackage } from "@rental-os/core-contracts/platform-data-package";
import { readCorePackageOrdinaryFile } from "@rental-os/platform-core-host/core-package-preflight";
import { composePublicAiPrismaSchema } from "@rental-os/ai-native-data/public-data";
import { readPublicAiDataPackage } from "@rental-os/ai-native-data/public-data-package";
import { createZeroCorePublicAiDataAvailability } from "@rental-os/ai-native-data/public-data-admission";
import { Prisma } from "../generated/client";
import { createPublicPlatformDataPlan } from "./platform-data";

export async function selectPublicAiData(lockFile: string, dataDirectory: string) {
  if (!isAbsolute(lockFile) || !isAbsolute(dataDirectory)) throw new Error("须指定绝对部署锁和固定数据包目录");
  const bytes = await readCorePackageOrdinaryFile(lockFile, CORE_ARCHIVE_LIMITS.fileBytes);
  const lock = CoreDeploymentLockSchema.parse(JSON.parse(bytes.toString("utf8")));
  const selected = lock.dataCapabilities?.[0], platform = createPublicPlatformDataPlan();
  if (lock.cores.length || lock.dataCapabilities?.length !== 1 || selected?.id !== "ai-native"
    || lock.platform.versions.node !== process.versions.node || lock.platform.versions.contract !== CORE_CONTRACT_VERSION
    || !isDeepStrictEqual(lock.platform.data, platform.data) || checkPlatformDataCapabilities(lock).length)
    throw new Error("公共 AI 只接受零 Core、单公共 AI 数据能力和兼容的底座锁");
  const { files } = readPlatformDataCapabilityPackage(dataDirectory, selected);
  const ai = readPublicAiDataPackage(files, selected);
  const baseSchema = await readCorePackageOrdinaryFile(resolve(__dirname, "../prisma/schema.prisma"), CORE_ARCHIVE_LIMITS.fileBytes);
  const modelNames = [...composePublicAiPrismaSchema(baseSchema.toString("utf8"), ai.contribution).matchAll(/^model\s+(\w+)\s*\{/gm)]
    .map(entry => entry[1]).sort();
  if (!isDeepStrictEqual(Object.keys(Prisma.ModelName).sort(), modelNames))
    throw new Error("公共 AI 须使用所选组合生成的专属 Client，不能使用普通平台或 Rental Client");
  return createZeroCorePublicAiDataAvailability({ lock, platform, files });
}
