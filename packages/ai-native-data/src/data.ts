/** 固定原 AI 持久模型和迁移字节的独立数据贡献。
 * AI 是可选公共能力；这里不创建业务 Core、运行器、租户、种子或第二套账。
 * 构造只核对调用方提供的包快照，不读环境、连库或把候选认作已部署。 */
import { createHash } from "node:crypto";
import { CoreDataContractSchema, type CoreDataContract } from "@rental-os/core-contracts";
import { AI_NATIVE_DATA_MIGRATIONS, AI_NATIVE_DATA_PROVENANCE, AI_NATIVE_DATA_READABLE,
  AI_NATIVE_DATA_SOURCE, AI_NATIVE_DATA_VERSION, AI_NATIVE_PRISMA_SCHEMA } from "./artifacts";

export { AI_NATIVE_DATA_MIGRATIONS, AI_NATIVE_DATA_PROVENANCE, AI_NATIVE_DATA_READABLE,
  AI_NATIVE_DATA_SOURCE, AI_NATIVE_DATA_VERSION, AI_NATIVE_PRISMA_SCHEMA } from "./artifacts";

export const AI_NATIVE_DATA_OWNER = { kind: "platform-capability", id: "ai-native" } as const;
export const AI_NATIVE_DATA_FILES = [AI_NATIVE_PRISMA_SCHEMA, AI_NATIVE_DATA_PROVENANCE,
  ...AI_NATIVE_DATA_MIGRATIONS] as const;

export interface AiNativeDataContribution {
  readonly owner: typeof AI_NATIVE_DATA_OWNER;
  readonly source: typeof AI_NATIVE_DATA_SOURCE;
  readonly data: CoreDataContract;
  readonly schema: string;
  /** 本版所有数据材料的有序路径及摘要指纹，不是 npm 包或已构建发行摘要。 */
  readonly sha256: string;
  readonly migrations: readonly {
    readonly id: string;
    readonly file: string;
    readonly name: string;
    readonly originalName: string;
    readonly sha256: string;
    readonly sql: string;
  }[];
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const digest = () => sha256(Buffer.from(JSON.stringify(AI_NATIVE_DATA_FILES.map(file => ({
  file: file.file, sha256: file.sha256
})))));

export const AI_NATIVE_DATA_SHA256 = digest();

/** 必须从同一固定包读取全部数据文件；摘要通过后仍不产生迁移或权限收据。 */
export function createAiNativeDataContribution(files: ReadonlyMap<string, Uint8Array>): AiNativeDataContribution {
  const content = new Map<string, string>();
  for (const artifact of AI_NATIVE_DATA_FILES) {
    const original = files.get(artifact.file);
    if (!(original instanceof Uint8Array) || !original.byteLength || original.byteLength > 32 * 1024 * 1024)
      throw new Error(`AI 数据材料缺失或越界：${artifact.file}`);
    const bytes = Uint8Array.from(original);
    if (sha256(bytes) !== artifact.sha256) throw new Error(`AI 数据材料摘要变化：${artifact.file}`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.trim()) throw new Error(`AI 数据材料为空：${artifact.file}`);
    content.set(artifact.file, text);
  }
  // 同一数据目录中的未知文件不能静默变成未登记的迁移或另一份 schema。
  for (const file of files.keys()) if (file.startsWith("prisma/") && !content.has(file))
    throw new Error(`AI 数据目录包含未登记材料：${file}`);
  const data = CoreDataContractSchema.parse({ version: AI_NATIVE_DATA_VERSION, readable: AI_NATIVE_DATA_READABLE,
    migrations: AI_NATIVE_DATA_MIGRATIONS.map(({ id, file, sha256 }) => ({ id, file, sha256 })) });
  return Object.freeze({ owner: AI_NATIVE_DATA_OWNER, source: AI_NATIVE_DATA_SOURCE, data,
    schema: content.get(AI_NATIVE_PRISMA_SCHEMA.file)!, sha256: AI_NATIVE_DATA_SHA256,
    migrations: Object.freeze(AI_NATIVE_DATA_MIGRATIONS.map(migration => Object.freeze({
      ...migration, sql: content.get(migration.file)!
    }))) });
}

/** 组合前重新核对可变调用边界，避免调用方用自报类型替换已核定的材料。 */
export function assertAiNativeDataContribution(contribution: AiNativeDataContribution): void {
  if (contribution.owner?.kind !== AI_NATIVE_DATA_OWNER.kind || contribution.owner.id !== AI_NATIVE_DATA_OWNER.id
    || contribution.sha256 !== AI_NATIVE_DATA_SHA256
    || JSON.stringify(contribution.source) !== JSON.stringify(AI_NATIVE_DATA_SOURCE)
    || sha256(Buffer.from(contribution.schema)) !== AI_NATIVE_PRISMA_SCHEMA.sha256
    || contribution.migrations.length !== AI_NATIVE_DATA_MIGRATIONS.length)
    throw new Error("AI 数据贡献不是本版固定材料");
  const expectedData = CoreDataContractSchema.parse({ version: AI_NATIVE_DATA_VERSION, readable: AI_NATIVE_DATA_READABLE,
    migrations: AI_NATIVE_DATA_MIGRATIONS.map(({ id, file, sha256 }) => ({ id, file, sha256 })) });
  if (JSON.stringify(CoreDataContractSchema.parse(contribution.data)) !== JSON.stringify(expectedData))
    throw new Error("AI 数据合同与固定材料不一致");
  contribution.migrations.forEach((migration, index) => {
    const original = AI_NATIVE_DATA_MIGRATIONS[index];
    if (migration.id !== original.id || migration.file !== original.file || migration.name !== original.name
      || migration.originalName !== original.originalName || migration.sha256 !== original.sha256
      || sha256(Buffer.from(migration.sql)) !== original.sha256)
      throw new Error(`AI 迁移与固定材料不一致：${original.id}`);
  });
}
