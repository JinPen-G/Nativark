/** 工单示范的Node打包入口，按唯一清单收集实际编译文件并生成同源资料；不安装或执行业务代码。 */
import { lstatSync, readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { createCoreArchive, CORE_ARCHIVE_LIMITS } from "@rental-os/core-contracts/archive";
import { corePackageFiles, inspectCorePackageFiles } from "@rental-os/core-contracts/package";
import { CorePackagePathSchema, renderCoreGuide, type CoreHostVersions, type CoreManifest } from "@rental-os/core-contracts";
import { createTicketsManifest } from "./manifest";
import { createTicketsOpenApi } from "./openapi";

/** 模块README中的源码/底座相对链接在独立包中改为固定源码链接，正文仍维护唯一原稿。 */
function packageReadme(text: string, source: CoreManifest["source"], sourceDirectory: string): string {
  const base = `${source.repository.replace(/\.git$/, "")}/blob/${source.commit}/`;
  return text.replace(/\]\((?:<([^>\n]+)>|([^\s)]+))\)/g, (link, angled: string | undefined, plain: string | undefined) => {
    const target = angled ?? plain!;
    if (/^[a-z][a-z0-9+.-]*:|^#/i.test(target)) return link;
    const [file, hash] = target.split("#"), path = posix.normalize(posix.join(sourceDirectory, file));
    if (path === ".." || path.startsWith("../") || posix.isAbsolute(path)) throw new Error("工单说明链接越出固定源码仓库");
    return `](${base}${encodeURI(path)}${hash ? `#${hash}` : ""})`;
  });
}

export function packTicketsPackage(input: {
  directory: string;
  source: CoreManifest["source"];
  sourceDirectory: string;
  platformSource: CoreManifest["source"];
  platformTask: string;
  host?: CoreHostVersions;
}) {
  const manifest = createTicketsManifest(input.source), root = resolve(input.directory);
  const sourceDirectory = CorePackagePathSchema.parse(input.sourceDirectory);
  for (let directory = root; ; directory = dirname(directory)) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("工单打包根须为不经过链接的普通目录");
    if (dirname(directory) === directory) break;
  }
  const generated = new Map<string, Uint8Array>([
    ["core.manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n")],
    ["openapi.json", Buffer.from(JSON.stringify(createTicketsOpenApi(), null, 2) + "\n")],
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
      if (file === "README.md") bytes = Buffer.from(packageReadme(Buffer.from(bytes).toString("utf8"), input.source, sourceDirectory));
    }
    total += bytes.length;
    if (bytes.length > CORE_ARCHIVE_LIMITS.fileBytes || total > CORE_ARCHIVE_LIMITS.totalBytes) throw new Error("工单包超过声明大小上限");
    files.set(file, bytes);
  }
  const inspection = inspectCorePackageFiles(files, input.host);
  if (!inspection.ok) throw new Error(inspection.issues.map(issue => `${issue.file}:${issue.field ?? ""} ${issue.message}`).join("\n"));
  return { ...createCoreArchive(files), manifest, fileCount: files.size };
}
