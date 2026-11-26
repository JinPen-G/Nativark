/** Public AI persistence for a fresh installation without a business Core.
 * The mixed 0.1.0 history retains its original receipts and entry points.
 * Reading these assets neither upgrades that history nor grants runtime access. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { CoreDataContractSchema, type CoreDataContract } from "@rental-os/core-contracts";
import { composeCorePrismaSchema } from "@rental-os/core-contracts/prisma";

export const PUBLIC_AI_DATA_VERSION = "0.2.0";
export const PUBLIC_AI_DATA_OWNER = { kind: "platform-capability", id: "ai-native" } as const;
export const PUBLIC_AI_DATA_FILES = [
  { file: "prisma-public/schema.prisma", sha256: "c83f610971f4a99247af9c2c4d16c28605b72af2794ab70bd8752ea85a3ec874" },
  { file: "prisma-public/20261126000000-initial.sql", sha256: "2309b03cab4c9bfd8c70d59c221990a8c0ff93e547e75b09f6d087b0aac3b111" },
  { file: "prisma-public/provenance.json", sha256: "a53f24d378ab06cc83fe803de4acec03e0b5872ffabe8792afe3dff160b974cc" }
] as const;
export const PUBLIC_AI_DATA_PREREQUISITES = {
  platform: { minInclusive: "0.1.8", maxExclusive: "0.1.10" }, cores: []
} as const;
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const materialHash = hash(JSON.stringify(PUBLIC_AI_DATA_FILES));
const migration = {
  id: "ai-native.20261126000000-public-initial", ...PUBLIC_AI_DATA_FILES[1],
  name: "platform-capability.ai-native.20261126000000-public-initial"
} as const;
const contract = () => CoreDataContractSchema.parse({
  version: PUBLIC_AI_DATA_VERSION, readable: { minInclusive: "0.2.0", maxExclusive: "0.3.0" },
  migrations: [{ id: migration.id, file: migration.file, sha256: migration.sha256 }]
});

export interface PublicAiDataContribution {
  readonly owner: typeof PUBLIC_AI_DATA_OWNER;
  readonly installation: "fresh-public";
  readonly sha256: string;
  readonly data: CoreDataContract;
  readonly schema: string;
  readonly migrations: readonly { id: string; file: string; sha256: string; name: string; sql: string }[];
}

export function createPublicAiDataContribution(files: ReadonlyMap<string, Uint8Array>): PublicAiDataContribution {
  const content = new Map<string, string>();
  for (const asset of PUBLIC_AI_DATA_FILES) {
    const bytes = files.get(asset.file);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 32 * 1024 * 1024 || hash(bytes) !== asset.sha256)
      throw new Error(`公共 AI 固定材料缺失或变化：${asset.file}`);
    content.set(asset.file, new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  }
  for (const file of files.keys()) if (file.startsWith("prisma-public/") && !content.has(file))
    throw new Error(`公共 AI 目录包含未登记材料：${file}`);
  return Object.freeze({ owner: PUBLIC_AI_DATA_OWNER, installation: "fresh-public", sha256: materialHash,
    data: contract(), schema: content.get(PUBLIC_AI_DATA_FILES[0].file)!,
    migrations: Object.freeze([Object.freeze({ ...migration, sql: content.get(migration.file)! })]) });
}

export function assertPublicAiDataContribution(value: PublicAiDataContribution): void {
  if (value.installation !== "fresh-public" || value.sha256 !== materialHash
    || !isDeepStrictEqual(value.owner, PUBLIC_AI_DATA_OWNER)
    || !isDeepStrictEqual(CoreDataContractSchema.parse(value.data), contract())
    || hash(value.schema) !== PUBLIC_AI_DATA_FILES[0].sha256 || value.migrations.length !== 1)
    throw new Error("公共 AI 数据贡献不是本版固定材料");
  const { sql, ...metadata } = value.migrations[0];
  if (!isDeepStrictEqual(metadata, migration) || hash(sql) !== migration.sha256)
    throw new Error("公共 AI 迁移身份或正文变化");
}

/** The host contributes its own generator, public models and existing Tenant key. */
export function composePublicAiPrismaSchema(base: string, contribution: PublicAiDataContribution): string {
  assertPublicAiDataContribution(contribution);
  return composeCorePrismaSchema(base, [{ id: "ai-native", schema: contribution.schema, publicRelations: {
    Tenant: ["aiModelConfiguration AiTenantModelConfiguration?", "aiCreditAllowance AiTenantAiAllowance[]",
      "aiCreditRequests AiTenantAiCreditRequest[]", "aiScopes AiScope[]"]
  } }]);
}

/** Returns pending material only. The host must validate the actual database,
 * full package, deployment lock and migration receipts before applying it. */
export function createPublicAiDataPreparation(baseSchema: string, contribution: PublicAiDataContribution) {
  const schema = composePublicAiPrismaSchema(baseSchema, contribution);
  const files = new Map<string, Uint8Array>([["schema.prisma", Buffer.from(schema)]]);
  for (const item of contribution.migrations) files.set(`migrations/${item.name}/migration.sql`, Buffer.from(item.sql));
  return { status: "prepared" as const, deployment: "pending" as const, installation: contribution.installation,
    data: structuredClone(contribution.data), materialSha256: contribution.sha256,
    prerequisites: structuredClone(PUBLIC_AI_DATA_PREREQUISITES), schema, files };
}
