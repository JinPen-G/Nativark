"use strict";

/**
 * OPS-01B：发布候选事实的**纯**判定层。
 *
 * 这里不跑 git、不读盘、不连库，只把已经取到的原始输出转成结论，
 * 因此可以被专项逐条断言。所有会接触外部世界的动作都在 release-gate.cjs 里。
 *
 * 一条贯穿始终的口径：清单只记**变量名**与**摘要**，从不记值。
 * 发布清单会被贴进工单、粘进聊天、存进制品库——任何进了清单的口令都等于泄露。
 */

const crypto = require("node:crypto");
const { validateApiEnvironment } = require("../../config/environment.cjs");

/**
 * 发布必须确认的环境变量。
 *
 * `required` 的判据是「缺了它这次发布一定不可用或不安全」：
 *   - `DATABASE_URL`：没有它服务连不上库；
 *   - `AUTH_TOKEN_SECRET`：缺失时 `NODE_ENV=production` 会直接抛错，
 *     非生产则回落到仓库里那个公开的开发密钥——发布候选不接受这种回落。
 * 生产运行模式和独立凭据加密密钥同属发布必需项，值由共用校验层核对。
 */
const RELEASE_ENV_VARS = [
  { name: "NODE_ENV", required: true, purpose: "Node 运行模式，正式生产为 production" },
  { name: "RENTAL_DEPLOYMENT_PROFILE", required: true, purpose: "显式选择 personal-demo 或 production 部署用途" },
  { name: "DATABASE_URL", required: true, purpose: "数据库连接串（值不入清单）" },
  { name: "AUTH_TOKEN_SECRET", required: true, purpose: "令牌签名密钥（值不入清单）" },
  { name: "INTEGRATION_ENCRYPTION_KEY", required: true, purpose: "凭据加密密钥（值不入清单）" },
  { name: "PLATFORM_DATA_SOURCE", required: false, purpose: "平台模块数据源选择" },
  { name: "RENTAL_OS_DATA_SOURCE", required: false, purpose: "租赁业务模块数据源选择" },
  { name: "INFRA_DATA_SOURCE", required: false, purpose: "基础设施模块数据源选择" },
  { name: "API_PORT", required: false, purpose: "API 监听端口，默认 3000" },
  { name: "DATABASE_CONNECT_ON_START", required: false, purpose: "启动时是否立即连库" },
  { name: "LOCAL_DEMO_PASSWORD_RESET_ENABLED", required: false, purpose: "个人演示可显式保留登录前重置，正式生产关闭" }
];

/** 发布后用于确认服务可用的入口。只记录路径与期望，不在门禁里替代真实巡检。 */
const HEALTH_ENTRYPOINTS = [
  { path: "/api/health", expects: 'status === "ok"', purpose: "进程存活与路由可达" },
  { path: "/api/reports/ops/health", expects: "HTTP 200", purpose: "运维报表面可达（需鉴权）" }
];

/**
 * 判断环境变量是否齐备。
 *
 * **只回名字**：`present` 里不放值，`missing` 也只列名。
 * 空串与纯空白视为缺失——`AUTH_TOKEN_SECRET=` 这种写法比没写更危险，
 * 因为它看起来像"已经配过了"。
 */
function inspectEnvNames(env, vars = RELEASE_ENV_VARS) {
  const has = (name) => {
    const value = env?.[name];
    return typeof value === "string" && value.trim().length > 0;
  };
  return {
    present: vars.filter((row) => has(row.name)).map((row) => row.name),
    missing: vars.filter((row) => row.required && !has(row.name)).map((row) => row.name),
    optionalMissing: vars.filter((row) => !row.required && !has(row.name)).map((row) => row.name)
  };
}

function inspectReleaseEnvironment(env) {
  try {
    validateApiEnvironment(env, { release: true });
    return { ok: true, problems: [] };
  } catch (error) {
    return { ok: false, problems: [error.message] };
  }
}

/**
 * 把一组文件摘要成一个可比对的产物指纹。
 *
 * 逐文件 sha256 后按路径排序再合成总摘要：同样的产物在不同机器上得到同一个值，
 * 因此「测试环境验过的产物」和「即将发布的产物」能被证明是同一份。
 * 排序是必须的——目录遍历顺序在不同平台不一致，不排序会得到随机指纹。
 */
function digestFiles(files) {
  const entries = files
    .map((file) => ({
      path: String(file.path).replace(/\\/g, "/"),
      bytes: file.bytes,
      sha256: crypto.createHash("sha256").update(file.contents).digest("hex")
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const combined = crypto.createHash("sha256");
  for (const entry of entries) combined.update(`${entry.path}:${entry.sha256}\n`);
  return {
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    digest: entries.length ? combined.digest("hex") : undefined,
    files: entries.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
  };
}

/** 解析 `git status --porcelain`。发布候选要求工作区干净，否则清单里的提交号名不副实。 */
function summarizeWorktree(porcelain) {
  const lines = String(porcelain ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return {
    clean: lines.length === 0,
    changedCount: lines.length,
    // 只回文件名不回内容；未跟踪文件同样算脏——它们不在提交里，却可能被打进产物。
    changed: lines.slice(0, 20).map((line) => line.replace(/^\S+\s+/, ""))
  };
}

/**
 * 校验构建产物是否确实由当前 Git 提交生成。
 *
 * 仅对现有 dist 做摘要不能证明它来自当前源码：切换提交或改坏源码后，旧 dist 仍可能
 * 完整存在。发布门禁必须同时核对「构建时提交」和「当前产物摘要」，缺一不可。
 */
function inspectBuildProvenance(provenance, head, builds) {
  const problems = [];
  if (!provenance || provenance.kind !== "release-build-provenance") {
    problems.push("缺少有效的构建来源证明，请先运行 npm run ops:release-build");
    return { ok: false, problems };
  }
  if (!head || provenance.git?.commit !== head) {
    problems.push(`构建提交 ${provenance.git?.commit || "未知"} 与当前提交 ${head || "未知"} 不一致`);
  }
  const recorded = new Map((provenance.builds ?? []).map((build) => [build.name, build]));
  for (const build of builds) {
    const before = recorded.get(build.name);
    if (!before) {
      problems.push(`${build.name} 缺少构建来源记录`);
      continue;
    }
    if (
      before.digest !== build.digest
      || before.fileCount !== build.fileCount
      || before.totalBytes !== build.totalBytes
    ) {
      problems.push(`${build.name} 当前产物与构建来源记录不一致`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * 清单落盘前的最后一道闸：不允许任何口令、令牌或连接串明文进入。
 *
 * 判定刻意**不用**「整份 JSON 里搜子串」。本地夹具的库口令恰好是库名前缀
 * （`rental_os` / `rental_os_claude`），子串匹配会把一个本就不是秘密的库名
 * 判成泄露——而一个总在误报的检查很快就会被人关掉，那比没有检查更糟。
 *
 * 因此按**值的位置与形态**判定，三条并行：
 *   1. 任何字符串值整体等于某个已知秘密 → 泄露；
 *   2. 形如 URL/连接串的值里出现已知秘密，或本身是 `user:pass@host` 形态 → 泄露；
 *   3. 键名是 password/secret/token/authorization 且值未掩码 → 泄露。
 */
function assertNoSecrets(manifest, secrets = []) {
  const known = secrets.map((secret) => String(secret ?? "").trim()).filter(Boolean);
  const connectionString = /[a-z][a-z0-9+.-]*:\/\/[^:/\s]+:[^@/\s]+@/iu;
  const sensitiveKey = /^(password|secret|token|authorization|credential)s?$/iu;

  const walk = (node, keyPath) => {
    if (typeof node === "string") {
      const lastKey = keyPath[keyPath.length - 1] ?? "";
      if (sensitiveKey.test(String(lastKey)) && !/^\*{3,}$/u.test(node)) {
        throw new Error(`发布清单出现敏感字段 ${keyPath.join(".")}，拒绝输出`);
      }
      if (connectionString.test(node)) {
        throw new Error(`发布清单包含连接串明文（${keyPath.join(".")}），拒绝输出`);
      }
      for (const secret of known) {
        if (node === secret) {
          throw new Error(`发布清单字段 ${keyPath.join(".")} 整体等于一个已知秘密，拒绝输出`);
        }
        if (node.includes("://") && node.includes(secret)) {
          throw new Error(`发布清单字段 ${keyPath.join(".")} 的连接串里含已知秘密，拒绝输出`);
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...keyPath, String(index)]));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) walk(value, [...keyPath, key]);
    }
  };

  walk(manifest, []);
  return true;
}

module.exports = {
  RELEASE_ENV_VARS,
  HEALTH_ENTRYPOINTS,
  inspectEnvNames,
  inspectReleaseEnvironment,
  digestFiles,
  summarizeWorktree,
  inspectBuildProvenance,
  assertNoSecrets
};
