"use strict";

/**
 * OPS-01A：共用运行时helper——读 env、跑容器内 mysql 客户端、统一日志。
 *
 * 口令一律通过 `MYSQL_PWD` 环境变量传给客户端，**不用** `-p<password>`：
 * 后者会出现在容器内的进程列表里，也会触发 mysql 的明文告警。
 * 所有 stdout/stderr 在打印前都过 `redact()`。
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { redact, resolveDedicatedTarget, OpsTargetError } = require("./dedicated-env.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const CONTAINER = process.env.OPS_MYSQL_CONTAINER || "store-rental-mysql";

/** 从 env 文件读取键值。仅用于本地开发；CI 应直接给进程环境变量。 */
function readEnvFile(relative = ".env") {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split(/\r?\n/)
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"|"$/g, "")];
      })
  );
}

/** 进程环境优先于 env 文件：CI/运维现场用环境变量覆盖，不必改仓库里的文件。 */
function loadDatabaseUrl(envFile = ".env") {
  return process.env.DATABASE_URL || readEnvFile(envFile).DATABASE_URL || "";
}

function requireTarget(envFile = ".env") {
  return resolveDedicatedTarget(loadDatabaseUrl(envFile));
}

/**
 * 建/删演练库需要 DDL 权限，而应用账号（`DATABASE_URL` 里那个）**不该**有。
 *
 * 因此管理凭据单独从 env 取，且与应用账号分开传递：
 * 备份仍用应用账号只读源库，只有演练库的 CREATE/DROP/导入/校验用管理账号。
 * 没配置就明确失败——不回退到应用账号偷偷试一把，也不内置任何默认口令。
 */
function requireAdminTarget(target, envFile = ".env") {
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
  const probe = spawnSync(command, ["--version"], { encoding: "utf8", shell: true });
  return probe.status === 0;
}

function containerRunning(name = CONTAINER) {
  const probe = spawnSync("docker", ["inspect", "-f", "{{.State.Running}}", name], { encoding: "utf8" });
  return probe.status === 0 && probe.stdout.trim() === "true";
}

/**
 * 在容器里执行 mysql 客户端。
 *
 * `binary` 为 `mysql` 或 `mysqldump`；`input` 走 stdin（恢复用），
 * `capture` 为真时返回 stdout（备份用）。口令只经 `-e MYSQL_PWD` 传入。
 */
function runMysql(binary, target, args, { input, capture = false } = {}) {
  const dockerArgs = [
    "exec", "-i",
    "-e", `MYSQL_PWD=${target.password}`,
    CONTAINER, binary,
    `-u${target.user}`,
    "--protocol=TCP", "-h", "127.0.0.1", "-P", "3306",
    ...args
  ];
  const result = spawnSync("docker", dockerArgs, {
    encoding: capture ? "buffer" : "utf8",
    input,
    maxBuffer: 1024 * 1024 * 512
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

module.exports = { ROOT, CONTAINER, readEnvFile, loadDatabaseUrl, requireTarget, requireAdminTarget, log, fail, hasCommand, containerRunning, runMysql, sql };
