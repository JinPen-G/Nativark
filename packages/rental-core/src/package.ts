/** 将受控构建的完整字节集合制成 Rental 标准包；不遍历作者目录、不连接或执行 Core。
 * 宿主负责提供固定来源及构建产物，本入口核出口、相对依赖、数据和随包资料。 */
import { CorePackagePathSchema, pinCoreDocumentationLinks, renderCoreGuide,
  type CoreHostVersions, type CoreManifest } from "@rental-os/core-contracts";
import { CORE_ARCHIVE_LIMITS, createCoreArchive } from "@rental-os/core-contracts/archive";
import { corePackageFiles, inspectCorePackageFiles } from "@rental-os/core-contracts/package";
import { posix } from "node:path";
import { RENTAL_CORE_VERSION } from "./core-identity";
import { createRentalManifest } from "./manifest";
import { readRentalDataPackage } from "./data-package";

const generatedNames = new Set(["core.manifest.json", "CORE_GUIDE.md"]);
const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

/** 源码候选须先构建再传入；仅将缺少 dist 的源码改名打包会明确失败。 */
export function createRentalPackage(input: {
  files: ReadonlyMap<string, Uint8Array>;
  source: CoreManifest["source"];
  sourceDirectory: string;
  platformSource: CoreManifest["source"];
  platformGuide: string;
  host: CoreHostVersions;
  contributions?: Pick<CoreManifest["entries"], "openapi" | "ai" | "jobs" | "events">;
  /** Exact compatibility routes supplied by the actual host, never the Core manifest. */
  legacyApiRoutes?: readonly string[];
}) {
  const sourceDirectory = CorePackagePathSchema.parse(input.sourceDirectory);
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const [file, bytes] of input.files) {
    CorePackagePathSchema.parse(file);
    if (generatedNames.has(file)) throw new Error(`Rental ${file} 由本次固定发行生成，不接受第二份声明`);
    if (!/^(?:dist\/|dist-clients\/|src\/|admin\/|clients\/|prisma\/|package\.json$|README\.md$|LICENSE$)/.test(file))
      throw new Error(`Rental 发行只接收构建、客户端、数据和许可资料：${file}`);
    if (file.split("/").some(part => /^(?:node_modules|\.git|output|\.env(?:\..*)?)$/i.test(part)))
      throw new Error(`Rental 发行不能携带依赖、环境或临时文件：${file}`);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > CORE_ARCHIVE_LIMITS.fileBytes
      || (total += bytes.byteLength) > CORE_ARCHIVE_LIMITS.totalBytes)
      throw new Error("Rental 构建字节超过标准包上限");
    files.set(file, Uint8Array.from(bytes));
  }
  const required = (file: string) => {
    const bytes = files.get(file);
    if (!bytes?.byteLength) throw new Error(`Rental 标准包缺少实际文件 ${file}`);
    return bytes;
  };
  const metadata = JSON.parse(text(required("package.json"))) as Record<string, unknown>;
  if (metadata.name !== "@rental-os/rental-core" || metadata.version !== RENTAL_CORE_VERSION || metadata.license !== "MIT")
    throw new Error("Rental npm 元数据与本版发行不一致");
  const visit = (entry: unknown): void => {
    if (typeof entry === "string") {
      if (!entry.startsWith("./") || entry.includes("*")) throw new Error("Rental 正式出口必须明确指向实际包内文件");
      required(CorePackagePathSchema.parse(entry.slice(2)));
    } else if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      for (const [name, value] of Object.entries(entry)) {
        // A pattern key can expose unknown modules even when its target is a
        // single concrete file. Both sides of the public mapping must be exact.
        if (name.includes("*")) throw new Error("Rental 正式出口名称不能包含通配符");
        visit(value);
      }
    } else throw new Error("Rental npm 出口格式不受支持");
  };
  if (!metadata.exports) throw new Error("Rental 标准包须提供正式 npm 出口");
  visit(metadata.exports);
  for (const key of ["main", "types"]) {
    if (typeof metadata[key] !== "string") throw new Error(`Rental 标准包缺少 ${key} 入口`);
    required(CorePackagePathSchema.parse((metadata[key] as string).replace(/^\.\//, "")));
  }
  required("LICENSE");
  // 检查声明和运行时的本地依赖；外部模块由固定宿主依赖锁负责，包内不能引用 apps/api。
  for (const [file, bytes] of files) {
    if (!/\.(?:[cm]?js|tsx?|d\.ts)$/.test(file)) continue;
    const source = text(bytes);
    const references = /\b(?:from\s*|import\s*\(\s*|import\s*|require\s*\(\s*)["'](\.[^"']+)["']/g;
    for (const match of source.matchAll(references)) {
      const target = posix.normalize(posix.join(posix.dirname(file), match[1]));
      if (target === ".." || target.startsWith("../")) throw new Error(`Rental 依赖越出标准包：${file} → ${match[1]}`);
      const types = file.endsWith(".d.ts"), runtime = /\.[cm]?js$/.test(file);
      // JS 发布入口不能靠只存在的 TS 作者源码补齐运行依赖。
      if (runtime && /\.[cm]?tsx?$/.test(target)) throw new Error(`Rental 运行依赖仍指向未构建源码：${file} → ${match[1]}`);
      const extensions = runtime ? [".js", ".cjs", ".mjs", ".json"] : [".ts", ".tsx", ".d.ts", ".js", ".json"];
      const indexes = runtime ? ["index.js", "index.cjs", "index.mjs", "index.json"] : ["index.ts", "index.tsx", "index.d.ts", "index.js"];
      const candidates = types && target.endsWith(".js")
        ? [target.slice(0, -3) + ".d.ts", target]
        : [target, ...extensions.map(extension => target + extension), ...indexes.map(index => `${target}/${index}`)];
      if (!candidates.some(candidate => files.has(candidate)))
        throw new Error(`Rental 包缺少相对依赖：${file} → ${match[1]}`);
    }
  }
  // Source documents keep their original relative links in the checkout.
  // Pin every shipped document before the manifest and archive fingerprint.
  for (const [file, bytes] of files) {
    if (!file.endsWith(".md")) continue;
    files.set(file, Buffer.from(pinCoreDocumentationLinks(text(bytes),
      `${sourceDirectory}/${file}`, input.source, file === "README.md")));
  }
  const manifest = createRentalManifest({ source: input.source,
    assets: [...files.keys()].filter(file => !["README.md", "LICENSE"].includes(file)), contributions: input.contributions });
  files.set("core.manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n"));
  files.set("CORE_GUIDE.md", Buffer.from(renderCoreGuide(manifest, input.platformGuide, input.platformSource)));
  const declared = new Set(corePackageFiles(manifest));
  if ([...files.keys()].some(file => !declared.has(file))) throw new Error("Rental 文件未纳入唯一发行清单");
  const inspected = inspectCorePackageFiles(files, input.host, input.legacyApiRoutes);
  if (!inspected.ok) throw new Error(inspected.issues.map(issue => `${issue.file}:${issue.field ?? ""} ${issue.message}`).join("\n"));
  const archive = createCoreArchive(files);
  const data = readRentalDataPackage(files, { manifest, sha256: archive.sha256 }, input.host, input.legacyApiRoutes);
  return { ...archive, manifest, fileCount: files.size, data };
}
