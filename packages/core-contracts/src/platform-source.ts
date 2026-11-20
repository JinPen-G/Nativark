/** 从固定 Git 源码生成零 Core 底座发行：保留公共实现、UIArc 与公共数据链。
 * workspace、锁文件和默认命令按同一公共依赖闭包生成，不安装依赖、加载业务或执行迁移。
 * 公共运行包入口及四个直接脚本助手随同一次源码发行提供。
 * 归档只读取提交中的普通文件；输出和部署由调用方明确办理。 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { posix } from "node:path";
import { createCoreArchive, CORE_ARCHIVE_LIMITS } from "./archive";

export const PLATFORM_SOURCE_WORKSPACES = [
  "packages/platform-contracts", "packages/core-contracts", "packages/core-host",
  "packages/platform-server", "packages/platform-core-host", "packages/platform-admin",
  "apps/platform-api", "apps/platform-admin"
] as const;
const sourcePaths = [
  ...PLATFORM_SOURCE_WORKSPACES, "packages/ui-arc", "packages/ui-tablecn/LICENSE.md", "packages/ui-tablecn/README.md",
  "packages/ui-motiq/runtime", "packages/ui-motiq/LICENSE", "packages/ui-motiq/README.md",
  "scripts/package-platform-host.cjs",
  "scripts/build-selected-prisma.cjs",
  "scripts/rental-platform-build.cjs",
  "scripts/rental-host-lock.cjs",
  "scripts/package-rental-host.cjs",
  "config", "AGENTS.md", "CLAUDE.md", "LICENSE", ".env.example", ".gitignore", ".gitattributes",
  "tsconfig.base.json", "package.json", "package-lock.json", "apps/admin/AGENTS.md"
];
type Json = Record<string, unknown>;
interface Package extends Json {
  name: string; version: string; workspaces?: string[]; scripts?: Record<string, string>;
  dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>; peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}
interface LockEntry extends Package { link?: boolean; resolved?: string }
interface Lock extends Json { name: string; version: string; lockfileVersion: number; packages: Record<string, LockEntry> }
export interface PlatformSourceIdentity { repository: string; commit: string }
export interface PlatformSource {
  files: ReadonlyMap<string, Uint8Array>;
  version: string;
  source: PlatformSourceIdentity;
  workspaces: readonly { path: string; name: string; version: string }[];
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const json = <T>(files: ReadonlyMap<string, Uint8Array>, path: string): T => {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`底座源码缺少 ${path}`);
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as T;
};
function sourceIdentity(source: PlatformSourceIdentity): PlatformSourceIdentity {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(source.repository)
    || !/^[0-9a-f]{40}$/.test(source.commit)) throw new Error("底座源码须固定 GitHub 仓库与完整提交");
  return { repository: source.repository.replace(/\.git$/, ""), commit: source.commit };
}
function included(path: string): boolean {
  return sourcePaths.some(root => path === root || path.startsWith(root + "/"))
    && !path.split("/").some(part => ["node_modules", "dist", "generated", ".git", "test", "tests"].includes(part));
}

/** 从既有锁文件保留所选 workspace 的实际依赖/peer闭包，原外部版本、摘要和安装信息保持。 */
function projectLock(lock: Lock, root: Package, packages: ReadonlyMap<string, Package>): Lock {
  if (lock.lockfileVersion !== 3 || !lock.packages[""]) throw new Error("底座源码要求本仓 v3 锁文件");
  const entries: Record<string, LockEntry> = { "": { ...lock.packages[""], ...root } };
  const queue = ["", ...packages.keys()], seen = new Set<string>();
  const resolve = (owner: string, name: string) => {
    let directory = owner;
    while (true) {
      if (posix.basename(directory) !== "node_modules") {
        const path = posix.join(directory, "node_modules", name);
        if (lock.packages[path]) return path;
      }
      if (!directory) return undefined;
      directory = posix.dirname(directory);
      if (directory === ".") directory = "";
    }
  };
  while (queue.length) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const entry: LockEntry | undefined = path === "" ? entries[""] : packages.get(path) ?? lock.packages[path];
    if (!entry) throw new Error(`锁文件缺少底座依赖 ${path}`);
    if (entry.link) {
      if (!entry.resolved || !packages.has(entry.resolved)) throw new Error(`底座不能依赖未选 workspace ${path}`);
      entries[path] = { ...entry }; queue.push(entry.resolved); continue;
    }
    entries[path] = { ...entry };
    const required = { ...entry.dependencies, ...entry.devDependencies };
    const optional = entry.optionalDependencies ?? {};
    const peers = entry.peerDependencies ?? {};
    const bundled = entry.bundleDependencies ?? entry.bundledDependencies;
    for (const name of new Set([...Object.keys(required), ...Object.keys(optional), ...Object.keys(peers)])) {
      // npm 的 bundleDependencies 已在所锁定外部包中，不要求另一个顶层锁条目。
      if ((name in required || name in optional) && (bundled === true || Array.isArray(bundled) && bundled.includes(name))) continue;
      const dependency = resolve(path, name);
      if (!dependency) {
        if (name in optional || (!(name in required) && entry.peerDependenciesMeta?.[name]?.optional)) continue;
        throw new Error(`锁文件缺少 ${path || "根包"} 的依赖 ${name}`);
      }
      queue.push(dependency);
    }
  }
  for (const [directory, meta] of packages) {
    const link = resolve("", meta.name);
    if (!link || lock.packages[link]?.resolved !== directory) throw new Error(`底座 workspace 链接不一致: ${meta.name}`);
    entries[link] = { ...lock.packages[link] };
  }
  return { ...lock, name: root.name, version: root.version, packages: entries };
}

function platformReadme(source: PlatformSourceIdentity): string {
  return `# Nativark 公共底座\n\n` +
    `这是不包含业务 Core 的底座源码，来源固定于 [${source.commit}](${source.repository}/tree/${source.commit})。\n\n` +
    `公共 API 和后台提供登录、租户/人员/角色、基础设置及 Core 授权入口。侧栏、面包屑、通知、休息和面板属于公共后台。\n\n` +
    `## 本地运行\n\n使用 Node 22.12 或更新的 LTS 补丁与 npm，准备自己的独立 MySQL。初始化和API启动直接读取当前进程的 DATABASE_URL、AUTH_TOKEN_SECRET 和 SEED_PLATFORM_PASSWORD，配置模板见 .env.example。PowerShell使用 $env:变量名 = '自己的值'，Bash使用 export 变量名='自己的值'；配置、Client与迁移顺序见[公共API五步](apps/platform-api/README.md#默认零-core-的五步)。\n\n` +
    "```sh\nnpm ci\nnpm run db:generate\nnpm run build\nnpm run db:migrate:deploy\nnpm run db:initialize\nnpm run dev\n```\n\n" +
    `命令会使用公共 Prisma schema 和迁移；首次初始化建立平台管理账号，重复执行不重置已有账号。后台默认 5176，API 默认 3000；自己的环境、迁移与服务启动由使用者办理。\n\n` +
    `## 开发 Core\n\n从 [五步接入与 Agent 模板](packages/core-contracts/README.md#五步快速接入)开始。` +
    `Core 自己提供业务、存储和页面，通过正式贡献注册，复用 [公共后台](packages/platform-admin/README.md)；` +
    `注册后由 SaaS 管理员授权租户，再分配成员。无 Core 时公共后台可用，业务与通用 Agent 任务未开放。\n\n` +
    `## 维护\n\n底座来源和文件摘要见 platform.source.json。下游保留自己的 Core 与部署配置，选择兼容上游版本，` +
    `按 [独立更新](packages/core-contracts/README.md#分别更新底座或一个-core)准备候选；迁移、切换及失败恢复按所选版本说明执行。` +
    `当前发行的真实运行与兼容验证范围见各 [API](apps/platform-api/README.md) / [Web](apps/platform-admin/README.md)导读。\n\n` +
    `自有源码采用 [MIT](LICENSE)，UIArc 和保留的第三方源码沿各自许可。维护者内部开发资料不包含在此源码包。\n`;
}

export function createPlatformSource(
  input: ReadonlyMap<string, Uint8Array>, identity: PlatformSourceIdentity
): PlatformSource {
  const source = sourceIdentity(identity), files = new Map<string, Uint8Array>();
  for (const [path, bytes] of input) if (included(path)) files.set(path, bytes);
  const root = json<Package>(files, "package.json"), packages = new Map<string, Package>();
  for (const path of PLATFORM_SOURCE_WORKSPACES) {
    const meta = json<Package>(files, path + "/package.json");
    packages.set(path, { ...meta, scripts: Object.fromEntries(Object.entries(meta.scripts ?? {}).filter(([key]) => key !== "test")) });
  }
  const names = new Set([...packages.values()].map(meta => meta.name));
  for (const [path, meta] of packages) {
    for (const name of Object.keys({ ...meta.dependencies, ...meta.devDependencies, ...meta.optionalDependencies, ...meta.peerDependencies }))
      if (name.startsWith("@rental-os/") && !names.has(name)) throw new Error(`底座 ${path} 依赖未选模块 ${name}`);
    files.set(path + "/package.json", jsonBytes(meta));
  }
  root.workspaces = [...PLATFORM_SOURCE_WORKSPACES];
  root.scripts = {
    build: "npm run build:api && npm run build:admin",
    "build:api": "npm run build -w @rental-os/platform-api",
    "build:admin": "npm run build -w @rental-os/platform-admin-app",
    lint: "npm run lint -w @rental-os/platform-api && npm run lint -w @rental-os/platform-admin-app",
    dev: 'concurrently -n API,ADMIN "npm run start -w @rental-os/platform-api" "npm run dev -w @rental-os/platform-admin-app"',
    start: "npm run start -w @rental-os/platform-api",
    "db:generate": "npm run prisma:generate -w @rental-os/platform-api",
    "db:migrate:deploy": "npm run prisma:migrate:deploy -w @rental-os/platform-api",
    "db:initialize": "npm run initialize -w @rental-os/platform-api",
    "export:platform": "npm run export:platform -w @rental-os/core-contracts --",
    "core:check": "npm run check -w @rental-os/core-contracts --",
    capabilities: "npm run capabilities -w @rental-os/core-contracts --"
  };
  files.set("package.json", jsonBytes(root));
  files.set("package-lock.json", jsonBytes(projectLock(json<Lock>(files, "package-lock.json"), root, packages)));
  files.set("README.md", Buffer.from(platformReadme(source)));
  // 组合工程的兼容链接仍可追溯到原提交；私有资料不生成不可访问的公开链接。
  for (const [path, bytes] of files) if (path.endsWith(".md")) {
    const text = Buffer.from(bytes).toString("utf8").replace(/\[([^\]]+)\]\(([^\s)]+)\)/g, (original, label: string, target: string) => {
      if (/^(?:[a-z]+:|#)/i.test(target)) return original;
      const [file, anchor] = target.split("#"), resolved = posix.normalize(posix.join(posix.dirname(path), file));
      if (files.has(resolved) || [...files.keys()].some(path => path.startsWith(resolved + "/"))) return original;
      if (resolved === "docs" || resolved.startsWith("docs/")) return label;
      const kind = posix.extname(resolved) ? "blob" : "tree";
      return `[${label}](${source.repository}/${kind}/${source.commit}/${resolved}${anchor ? "#" + anchor : ""})`;
    });
    files.set(path, Buffer.from(text));
  }
  const workspaces = [...packages].map(([path, meta]) => ({ path, name: meta.name, version: meta.version }));
  files.set("platform.source.json", jsonBytes({
    format: "nativark-platform-source-1", profile: "platform-only", version: root.version, source, workspaces,
    files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, bytes]) => ({ path, sha256: hash(bytes) }))
  }));
  return { files, version: root.version, source, workspaces };
}

const git = (directory: string, args: string[], input?: string): Promise<Buffer> => new Promise((resolve, reject) => {
  const child = execFile("git", ["-C", directory, ...args], {
    encoding: "buffer", windowsHide: true, maxBuffer: CORE_ARCHIVE_LIMITS.totalBytes
  }, (error, stdout, stderr) => error ? reject(new Error(`底座源码 Git 读取失败: ${stderr.toString().trim() || error.message}`)) : resolve(stdout));
  child.stdin?.end(input);
});

/** 一次对象批读，不追活动分支、读取工作区WIP或携带依赖/构建目录。 */
export async function readPlatformSourceFromGit(directory: string, identity: PlatformSourceIdentity): Promise<PlatformSource> {
  const source = sourceIdentity(identity);
  const commit = (await git(directory, ["rev-parse", "--verify", source.commit + "^{commit}"])).toString().trim();
  if (commit !== source.commit) throw new Error("底座源码提交身份不一致");
  const tree = (await git(directory, ["ls-tree", "-r", "-z", commit, "--", ...sourcePaths])).toString("utf8");
  const entries = tree.split("\0").filter(Boolean).map(line => {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!match) throw new Error("底座源码只接受提交中的普通文件");
    return { object: match[2], path: match[3] };
  }).filter(entry => included(entry.path));
  if (!entries.length || entries.length > CORE_ARCHIVE_LIMITS.files) throw new Error("底座源码文件数不在支持范围");
  const objects = await git(directory, ["cat-file", "--batch"], entries.map(entry => entry.object).join("\n") + "\n");
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  for (const entry of entries) {
    const end = objects.indexOf(10, offset);
    if (end < 0) throw new Error("底座源码对象应答不完整");
    const header = /^([0-9a-f]{40}) blob (\d+)$/.exec(objects.toString("ascii", offset, end));
    if (!header || header[1] !== entry.object) throw new Error("底座源码对象身份不一致");
    const length = Number(header[2]), start = end + 1;
    if (length > CORE_ARCHIVE_LIMITS.fileBytes || start + length >= objects.length || objects[start + length] !== 10)
      throw new Error("底座源码对象越界或不完整");
    files.set(entry.path, objects.subarray(start, start + length)); offset = start + length + 1;
  }
  if (offset !== objects.length) throw new Error("底座源码对象应答含未声明内容");
  return createPlatformSource(files, source);
}

export function packPlatformSource(source: PlatformSource) {
  return createCoreArchive(source.files);
}
