"use strict";

/**
 * OPS-01A：共用运行时helper——读 env、跑容器内 mysql 客户端、统一日志。
 *
 * 口令一律通过 `MYSQL_PWD` 环境变量传给客户端，**不用** `-p<password>`，
 * 也不把 `MYSQL_PWD=<value>` 拼进 docker 命令参数：两者都会让口令出现在进程参数里。
 * 所有 stdout/stderr 在打印前都过 `redact()`。
 */

const fs = require("node:fs");
const path = require("node:path");
const { isIP } = require("node:net");
const { spawnSync } = require("node:child_process");
const { redact, resolveDedicatedTarget, OpsTargetError } = require("./dedicated-env.cjs");
const { loadProjectEnvironment, readEnvironmentFile } = require("../../config/environment.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
// CLI entry points need the environment before deriving container and output names.
// Library imports keep their existing explicit loading boundary.
if (require.main && path.dirname(require.main.filename) === __dirname) {
  Object.assign(process.env, loadProjectEnvironment({ appDirectory: path.join(ROOT, "apps", "api"), mode: process.env.NODE_ENV }));
}
const CONTAINER = process.env.OPS_MYSQL_CONTAINER || "rental-os-mysql";

/** 从 env 文件读取键值。仅用于本地开发；CI 应直接给进程环境变量。 */
function readEnvFile(relative) {
  if (relative !== undefined) return readEnvironmentFile(path.resolve(ROOT, relative));
  return loadProjectEnvironment({ appDirectory: path.join(ROOT, "apps", "api"), mode: process.env.NODE_ENV,
    env: { RENTAL_ENV_FILE: process.env.RENTAL_ENV_FILE } });
}

/** 进程环境优先于 env 文件：CI/运维现场用环境变量覆盖，不必改仓库里的文件。 */
function loadDatabaseUrl(envFile) {
  return process.env.DATABASE_URL || readEnvFile(envFile).DATABASE_URL || "";
}

function requireTarget(envFile) {
  return assertContainerEndpoint(resolveDedicatedTarget(loadDatabaseUrl(envFile)));
}

/**
 * mysql 客户端固定在 `OPS_MYSQL_CONTAINER` 内执行，容器端口始终为 3306。
 * 宿主连接只接受 Compose 显式配置的 IPv4 回环绑定和映射端口；默认保留
 * 127.0.0.1 / localhost 的 3306。容器服务名仍只接受 mysql 和固定容器名。
 * Prisma 使用原宿主连接串，mysql 使用容器内部端点，两者必须指向同一容器。
 */
function assertContainerEndpoint(target) {
  const rawPort = process.env.MYSQL_HOST_PORT || "3306";
  const hostPort = Number(rawPort);
  const bindHost = process.env.MYSQL_BIND_HOST || "127.0.0.1";
  if (!/^\d+$/u.test(rawPort) || !Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535) {
    throw new OpsTargetError("MYSQL_HOST_PORT 必须是 1 到 65535 的整数");
  }
  if (isIP(bindHost) !== 4 || !bindHost.startsWith("127.")) {
    throw new OpsTargetError("MYSQL_BIND_HOST 必须是 IPv4 回环地址，OPS 不接受远程或公开绑定");
  }
  const host = String(target.host).toLowerCase();
  const localHost = host === bindHost || (bindHost === "127.0.0.1" && host === "localhost");
  const containerHost = host === "mysql" || host === CONTAINER.toLowerCase();
  if ((localHost && target.port === hostPort) || (containerHost && target.port === 3306)) {
    return target;
  }
  throw new OpsTargetError(
    `当前 OPS-01A 只支持容器 ${CONTAINER} 的本地 3306 端点及 ${bindHost}:${hostPort} 宿主映射。实际为 ${target.host}:${target.port}。`
    + "主机或端口必须与显式配置一致，不能静默改连其他容器或远程数据库。"
  );
}

/**
 * 建/删演练库需要 DDL 权限，而应用账号（`DATABASE_URL` 里那个）**不该**有。
 *
 * 因此管理凭据单独从 env 取，且与应用账号分开传递：
 * 备份仍用应用账号只读源库，只有演练库的 CREATE/DROP/导入/校验用管理账号。
 * 没配置就明确失败——不回退到应用账号偷偷试一把，也不内置任何默认口令。
 */
function requireAdminTarget(target, envFile) {
  const env = readEnvFile(envFile);
  const user = process.env.OPS_ADMIN_USER || env.OPS_ADMIN_USER || "root";
  const password = process.env.OPS_ADMIN_PASSWORD || env.OPS_ADMIN_PASSWORD
    || process.env.MYSQL_ROOT_PASSWORD || env.MYSQL_ROOT_PASSWORD || "";
  if (!password) {
    throw new OpsTargetError(
      "缺少管理凭据：恢复演练要新建演练库，请在 env 配置 OPS_ADMIN_USER / OPS_ADMIN_PASSWORD"
      + "（或 MYSQL_ROOT_PASSWORD）。应用账号不应持有 DDL 权限，脚本也不会用它代替。"
    );
  }
  return { ...target, user, password };
}

function log(message, secrets = []) {
  console.log(redact(message, secrets));
}

function fail(message, secrets = []) {
  console.error(`✗ ${redact(message, secrets)}`);
  process.exit(1);
}

function hasCommand(command) {
  const probe = spawnSync(command, ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

/**
 * 不经过 shell 调用当前 npm 安装自带的 npm/npx CLI。
 * Windows 直接 spawn `npm.cmd` 会返回 EINVAL；开启 shell 又会触发参数拼接告警。
 */
function runPackageCommand(kind, args, options = {}) {
  if (!new Set(["npm", "npx"]).has(kind)) throw new OpsTargetError(`不支持的包命令 ${kind}`);
  const npmCli = process.env.npm_execpath;
  const cli = npmCli
    ? kind === "npm" ? npmCli : path.join(path.dirname(npmCli), "npx-cli.js")
    : undefined;
  if (cli && fs.existsSync(cli)) {
    return spawnSync(process.execPath, [cli, ...args], options);
  }
  // 非 npm script 场景的兜底；参数均由调用方固定，不接收用户输入。
  return spawnSync(kind, args, { ...options, shell: process.platform === "win32" });
}

function containerRunning(name = CONTAINER) {
  const probe = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf8" });
  return probe.status === 0 && probe.stdout.trim() === "true";
}

/**
 * 在容器里执行 mysql 客户端。
 *
 * `binary` 为 `mysql` 或 `mysqldump`；`input` 走 stdin（恢复用），
 * `capture` 为真时返回 stdout（备份用）。docker 参数只出现变量名，值由子进程环境传入。
 */
function runMysql(binary, target, args, { input, capture = false } = {}) {
  const dockerArgs = [
    "exec", "-i",
    "-e", "MYSQL_PWD",
    CONTAINER, binary,
    `-u${target.user}`,
    "--protocol=TCP", "-h", "127.0.0.1", "-P", "3306",
    ...args
  ];
  const result = spawnSync("docker", dockerArgs, {
    encoding: capture ? "buffer" : "utf8",
    input,
    maxBuffer: 1024 * 1024 * 512,
    env: { ...process.env, MYSQL_PWD: target.password }
  });
  return result;
}

/** 执行一条 SQL 并返回文本输出。失败即抛，附带脱敏后的 stderr。 */
function sql(target, statement, { database } = {}) {
  const args = ["-N", "-B", "-e", statement];
  if (database) args.push(database);
  const run = runMysql("mysql", target, args);
  if (run.status !== 0) {
    throw new OpsTargetError(`SQL 执行失败：${redact(run.stderr || run.stdout || "未知错误", [target.password])}`);
  }
  return String(run.stdout ?? "").trim();
}

module.exports = { ROOT, CONTAINER, readEnvFile, loadDatabaseUrl, requireTarget, requireAdminTarget, assertContainerEndpoint, log, fail, hasCommand, runPackageCommand, containerRunning, runMysql, sql };
