/** Rental 新装选择公共 AI 数据和自有扩展；只准备材料，旧混合链仍走原入口。 */
import { Buffer } from "node:buffer";
import type { CoreDeploymentLock, CoreManifest } from "@rental-os/core-contracts";
import { createCorePhasedMigrationDeployment } from "@rental-os/core-contracts/deployment";
import { readPublicAiDataPackage } from "@rental-os/ai-native-data/public-data-package";
import { RENTAL_AI_EXTENSION_MIGRATION, RENTAL_AI_EXTENSION_PREREQUISITES, composeRentalPublicAiPrismaSchema,
  readRentalAiDataExtension } from "./ai-data-extension";
import { createRentalDeploymentFiles } from "./prepare-deployment";
import { rentalHostLegacyApiRoutes } from "./openapi";

/** A new lock is not an upgrade receipt. V1 runtime/update readers must keep rejecting it. */
export function createFreshRentalAiDeployment(input: Parameters<typeof createRentalDeploymentFiles>[0] & {
  publicAi: { release: NonNullable<CoreDeploymentLock["dataCapabilities"]>[number]; files: ReadonlyMap<string, Uint8Array> };
  extension: { source: CoreManifest["source"]; files: ReadonlyMap<string, Uint8Array> };
}) {
  if (input.ai || input.additionalCores?.length) throw new Error("新装 Rental AI 不混用旧 AI 数据或其他业务 Core");
  const ordinary = createRentalDeploymentFiles(input);
  const ai = readPublicAiDataPackage(input.publicAi.files, input.publicAi.release);
  const extension = readRentalAiDataExtension(input.extension.files);
  const [publicMigration] = ai.contribution.migrations;
  const { publicAi, rental } = RENTAL_AI_EXTENSION_PREREQUISITES;
  const { id, file, sha256 } = RENTAL_AI_EXTENSION_MIGRATION;
  const prepared = createCorePhasedMigrationDeployment({
    lock: { ...ordinary.lock, dataCapabilities: [ai.release] }, platform: input.publicMigrations,
    cores: new Map([["rental", input.coreFiles]]), dataCapabilities: new Map([[ai.release.id, input.publicAi.files]]),
    legacyApiRoutes: { rental: rentalHostLegacyApiRoutes() },
    postCapability: [{ release: { coreId: "rental", migration: { id, file, sha256, source: input.extension.source },
      prerequisites: { core: { version: { minInclusive: rental.minInclusive, maxExclusive: rental.maxExclusive }, migration: rental.initial },
        capability: { id: ai.release.id, version: publicAi, migration: { id: publicMigration.id, sha256: publicMigration.sha256 } } } },
      sql: Buffer.from(extension.sql) }]
  });
  const schema = composeRentalPublicAiPrismaSchema(input.publicSchema, ai.contribution, ordinary.rental.schema, extension);
  prepared.files.set("schema.prisma", Buffer.from(schema));
  return { ...prepared, status: "prepared" as const, deployment: "pending" as const };
}
