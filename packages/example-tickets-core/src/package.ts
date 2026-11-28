/** 工单示范的Node打包入口，按唯一清单收集实际编译文件并生成同源资料；不安装或执行业务代码。 */
import { lstatSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createCoreArchive, CORE_ARCHIVE_LIMITS } from "@rental-os/core-contracts/archive";
import { corePackageFiles, inspectCorePackageFiles } from "@rental-os/core-contracts/package";
import { CorePackagePathSchema, pinCoreDocumentationLinks, renderCoreGuide, type CoreHostVersions, type CoreManifest, type CoreOpenApiContribution } from "@rental-os/core-contracts";
import { createTicketsManifest } from "./manifest";
import { createTicketsOpenApi } from "./openapi";

export function packTicketsPackage(input: {
  directory: string;
  source: CoreManifest["source"];
  sourceDirectory: string;
  platformSource: CoreManifest["source"];
  /** 固定版本的公开接入README原文；参数名保留原程序调用兼容。 */
  platformTask: string;
  host?: CoreHostVersions;
  ai?: boolean;
}) {
  const manifest = createTicketsManifest(input.source, { ai: input.ai }), root = resolve(input.directory);
  const sourceDirectory = CorePackagePathSchema.parse(input.sourceDirectory);
  for (let directory = root; ; directory = dirname(directory)) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("工单打包根须为不经过链接的普通目录");
    if (dirname(directory) === directory) break;
  }
  // 仅AI选装包加载同次编译的可选出口；Node版本沿清单，普通打包没有AI运行依赖。
  const openapi = input.ai ? (require("../dist-ai/index.mjs") as { createTicketsAiOpenApi(): CoreOpenApiContribution }).createTicketsAiOpenApi()
    : createTicketsOpenApi();
  const generated = new Map<string, Uint8Array>([
    ["core.manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n")],
    ["openapi.json", Buffer.from(JSON.stringify(openapi, null, 2) + "\n")],
    ["CORE_GUIDE.md", Buffer.from(renderCoreGuide(manifest, input.platformTask, input.platformSource))]
  ]);
  let total = 0;
  const files = new Map<string, Uint8Array>();
  for (const file of corePackageFiles(manifest)) {
    let bytes = generated.get(file);
    if (!bytes) {
      const path = resolve(root, file);
      let current = path;
      while (true) {
        if (lstatSync(current).isSymbolicLink()) throw new Error("工单打包路径不能经过链接");
        if (current === root) break;
        const parent = dirname(current);
        if (parent === current) throw new Error("工单文件不属于指定打包根目录");
        current = parent;
      }
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size > CORE_ARCHIVE_LIMITS.fileBytes) throw new Error("工单声明文件不可读或超过包上限");
      bytes = readFileSync(path);
      if (file === "package.json") {
        const metadata = JSON.parse(Buffer.from(bytes).toString("utf8")) as { name?: unknown; version?: unknown } | null;
        if (metadata?.name !== "@rental-os/example-tickets-core" || metadata.version !== manifest.version)
          throw new Error("工单 npm 包名或版本与本次 Core 发行身份不一致，请从同一版本重新构建");
      }
      if (file === "README.md") bytes = Buffer.from(pinCoreDocumentationLinks(Buffer.from(bytes).toString("utf8"),
        `${sourceDirectory}/README.md`, input.source, true));
    }
    total += bytes.length;
    if (bytes.length > CORE_ARCHIVE_LIMITS.fileBytes || total > CORE_ARCHIVE_LIMITS.totalBytes) throw new Error("工单包超过声明大小上限");
    files.set(file, bytes);
  }
  const inspection = inspectCorePackageFiles(files, input.host);
  if (!inspection.ok) throw new Error(inspection.issues.map(issue => `${issue.file}:${issue.field ?? ""} ${issue.message}`).join("\n"));
  return { ...createCoreArchive(files), manifest, fileCount: files.size };
}
