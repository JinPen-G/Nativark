/** 宿主把已下载的普通归档登记为固定引用，读取限于同一明确目录与发行摘要。
 * 注册项由受控装配供给，当前 SaaS 权限由应用复验，字节检查复用原归档入口。 */
import { lstat, open } from "node:fs/promises";
import { join, parse, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { CorePackagePathSchema } from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS } from "@rental-os/core-contracts/archive";
import {
  CorePackageArtifactReferenceSchema, CorePackageArtifactSchema,
  type CorePackageArtifact, type CorePackageArtifactSource, type CorePackageArtifactSummary
} from "./ports";

const artifactSummary = z.discriminatedUnion("kind", [
  CorePackageArtifactSchema.options[0].omit({ bytes: true }), CorePackageArtifactSchema.options[1].omit({ bytes: true }),
  CorePackageArtifactSchema.options[2].omit({ bytes: true })
]);

export const CorePackageArchiveIndexSchema = z.object({
  format: z.literal("core-package-archives-1"),
  artifacts: z.array(z.object({
    reference: CorePackageArtifactReferenceSchema, file: CorePackagePathSchema, artifact: artifactSummary
  }).strict()).max(1000).refine(items => new Set(items.map(item => item.reference)).size === items.length, "本地安装包引用须唯一")
}).strict();

async function ordinaryFile(absolute: string, maxBytes: number) {
  let current = parse(absolute).root;
  const parts = relative(current, absolute).split(sep);
  for (const part of parts) {
    const parent = await lstat(current);
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error("安装包路径经过链接或非目录");
    current = join(current, part);
  }
  const file = await lstat(current);
  if (!file.isFile() || file.isSymbolicLink()) throw new Error("安装包须为普通文件");
  if (file.size <= 0 || file.size > maxBytes) throw new Error("安装包大小不在读取范围内");
  return file;
}

export async function readCorePackageOrdinaryFile(file: string, maxBytes: number) {
  const original = await ordinaryFile(file, maxBytes);
  const handle = await open(file, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== original.dev || opened.ino !== original.ino || opened.size !== original.size)
      throw new Error("安装包在打开期间已变化");
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) throw new Error("安装包读取未达到原长度");
      offset += result.bytesRead;
    }
    const extra = await handle.read(Buffer.alloc(1), 0, 1, bytes.length);
    const latest = await ordinaryFile(file, maxBytes);
    if (extra.bytesRead !== 0 || latest.dev !== original.dev || latest.ino !== original.ino
      || latest.size !== original.size || latest.mtimeMs !== original.mtimeMs || latest.ctimeMs !== original.ctimeMs)
      throw new Error("安装包在读取期间已变化");
    return bytes;
  } finally { await handle.close(); }
}

export function createPlatformCorePackageArchiveSource(input: {
  directory: string;
  artifacts: ReadonlyMap<string, CorePackageArtifactSummary & { file: string }>;
}): CorePackageArtifactSource {
  const directory = resolve(input.directory);
  const artifacts = new Map<string, CorePackageArtifactSummary & { file: string }>();
  for (const [reference, item] of input.artifacts) {
    CorePackageArtifactReferenceSchema.parse(reference);
    const { file: registeredFile, ...summary } = item;
    const file = CorePackagePathSchema.parse(registeredFile);
    if (!file.endsWith(".tgz") || file.split("/").some(part => /^(?:\.git|node_modules)$/i.test(part) || /^\.env(?:\.|$)/i.test(part)))
      throw new Error("安装包登记须使用受管目录内的 tgz 文件");
    const artifact = CorePackageArtifactSchema.parse({ ...summary, bytes: new Uint8Array() });
    const { bytes: _bytes, ...validated } = artifact;
    artifacts.set(reference, { ...validated, file });
  }
  return {
    async read(reference) {
      const item = artifacts.get(reference);
      if (!item) return undefined;
      const file = resolve(directory, item.file);
      const bytes = await readCorePackageOrdinaryFile(file, CORE_ARCHIVE_LIMITS.totalBytes);
      const { file: _file, ...summary } = item;
      return { ...structuredClone(summary), bytes } satisfies CorePackageArtifact;
    }
  };
}

/** 首次使用时读取宿主管理的本地登记，成功后固定本进程引用，实际归档每次核查。 */
export function createPlatformCorePackageArchiveIndexSource(input: { directory: string }): CorePackageArtifactSource {
  const directory = resolve(input.directory);
  let registered: Promise<CorePackageArtifactSource> | undefined;
  return {
    async read(value) {
      const reference = CorePackageArtifactReferenceSchema.parse(value);
      if (!registered) {
        const reading = readCorePackageOrdinaryFile(join(directory, "index.json"), CORE_ARCHIVE_LIMITS.fileBytes).then(bytes => {
          const index = CorePackageArchiveIndexSchema.parse(JSON.parse(bytes.toString("utf8")));
          return createPlatformCorePackageArchiveSource({ directory, artifacts: new Map(index.artifacts.map(item =>
            [item.reference, { ...item.artifact, file: item.file }])) });
        });
        registered = reading;
        // 失败后下一请求可重新读取，成功登记保持原引用，避免在途请求被新索引重新解释。
        void reading.catch(() => { if (registered === reading) registered = undefined; });
      }
      return (await registered).read(reference);
    }
  };
}
