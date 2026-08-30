"use strict";

/**
 * OPS-01A：专用环境目标解析与守卫。
 *
 * 这里只做**纯判定**，不碰数据库、不起子进程，因此可以被专项直接断言。
 * 三条不可退让的规则：
 *   1. 连接信息只来自 `DATABASE_URL`（env 文件或进程环境），仓库里不留任何凭据；
 *   2. 目标库必须**显式**是专用库；共享/生产库名一律拒绝，默认拒绝而不是默认放行；
 *   3. 任何对外输出都经过 `redact()`，口令不得进日志、报错或报告。
 */

/** 明确禁止的库名（共享开发库与常见生产命名）。判定用规范化小写全等，不做模糊匹配。 */
const PROTECTED_DATABASES = new Set([
  "store_rental",
  "store_rental_prod",
  "store_rental_production",
  "store_rental_staging",
  "mysql",
  "sys",
  "information_schema",
  "performance_schema"
]);

/**
 * 专用库必须带的标记之一。
 *
 * 用「必须命中标记」而不是「不在黑名单即可」：黑名单永远漏项，
 * 而新建一个叫 `store_rental_backup` 的库并把它当演练目标是很容易发生的事。
 */
const DEDICATED_MARKERS = ["claude", "e2e", "drill", "dedicated", "sandbox"];
const FORBIDDEN_ENV_MARKERS = new Set(["prod", "production", "staging", "live", "primary"]);

class OpsTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpsTargetError";
  }
}

/** 把可能含口令的文本替换成掩码。凡是要打印的字符串都必须先过这里。 */
function redact(text, secrets = []) {
  let output = String(text ?? "");
  for (const secret of secrets) {
    if (!secret) continue;
    output = output.split(secret).join("***");
  }
  // 兜底：URL 形态的 user:pass@host 一律掩掉口令段。
  return output.replace(/(\/\/[^/:@\s]+):[^@\s]+@/g, "$1:***@");
}

/**
 * 解析并校验 `DATABASE_URL`。
 *
 * 缺失、驱动不对、库名为空、命中保护名单、缺专用标记，都直接抛错——
 * 这些都不是「继续跑跑看」的情况，跑下去就是在错误目标上做备份或恢复。
 */
function parseDatabaseUrl(rawUrl) {
  if (!rawUrl || !String(rawUrl).trim()) {
    throw new OpsTargetError("缺少 DATABASE_URL：连接信息只能来自 env，脚本不内置默认库与口令");
  }
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw new OpsTargetError("DATABASE_URL 不是合法的连接串");
  }
  if (url.protocol !== "mysql:") {
    throw new OpsTargetError(`仅支持 mysql 目标，实际为 ${url.protocol.replace(":", "") || "（空）"}`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new OpsTargetError("DATABASE_URL 未指定数据库名");
  const user = decodeURIComponent(url.username || "");
  if (!user) throw new OpsTargetError("DATABASE_URL 未指定数据库账号");
  const password = decodeURIComponent(url.password || "");
  return {
    host: url.hostname || "127.0.0.1",
    port: Number(url.port || 3306),
    user,
    password,
    database
  };
}

/** 判定库名是否为**专用**库。返回原因字符串表示拒绝，`undefined` 表示通过。 */
function rejectionReason(database) {
  const name = String(database ?? "").trim().toLowerCase();
  if (!name) return "数据库名为空";
  // 后续 SQL 需要把库名作为标识符使用。这里只接受项目约定的安全字符，
  // 避免引号、反引号或路径字符进入 SHOW/CREATE/DROP DATABASE 语句。
  if (!/^[a-z0-9_]+$/u.test(name) || name.length > 64) {
    return `「${database}」不是安全的数据库名（只允许字母、数字、下划线且不超过 64 字符）`;
  }
  if (PROTECTED_DATABASES.has(name)) {
    return `「${database}」是共享或系统库，OPS-01A 只允许在专用库上执行`;
  }
  const tokens = name.split("_").filter(Boolean);
  const forbidden = tokens.find((token) => FORBIDDEN_ENV_MARKERS.has(token));
  if (forbidden) {
    return `「${database}」包含生产/共享环境标记 ${forbidden}，即使同时带专用标记也拒绝`;
  }
  if (!DEDICATED_MARKERS.some((marker) => tokens.includes(marker))) {
    return `「${database}」缺少专用库标记（需包含 ${DEDICATED_MARKERS.join(" / ")} 之一），默认拒绝`;
  }
  return undefined;
}

/** 解析 + 守卫。通过后返回连接信息，调用方可以放心执行读写。 */
function resolveDedicatedTarget(rawUrl) {
  const target = parseDatabaseUrl(rawUrl);
  const reason = rejectionReason(target.database);
  if (reason) throw new OpsTargetError(reason);
  return target;
}

/**
 * 生成恢复演练库名。
 *
 * 带时间戳后缀，保证每次演练都是**新库**：直接往源库恢复会把「验证备份可用」
 * 变成「用备份覆盖现有数据」，那是两件完全不同的事。
 * 生成结果同样要过专用库守卫——`_drill_` 标记天然满足，但不能因此跳过检查。
 */
function buildDrillDatabaseName(sourceDatabase, stamp = new Date()) {
  const reason = rejectionReason(sourceDatabase);
  if (reason) throw new OpsTargetError(reason);
  const iso = stamp.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  // MySQL 库名上限 64 字符：先给后缀留位，再截断源库名，避免生成非法名字。
  const suffix = `_drill_${iso}`;
  const head = String(sourceDatabase).slice(0, 64 - suffix.length);
  const name = `${head}${suffix}`;
  const drillReason = rejectionReason(name);
  if (drillReason) throw new OpsTargetError(drillReason);
  return name;
}

/** 演练库必须是本次生成的：只有匹配这个形态的库才允许被脚本删除。 */
function isDrillDatabase(name) {
  const value = String(name ?? "");
  return !rejectionReason(value) && /_drill_\d{14}$/u.test(value);
}

module.exports = {
  DEDICATED_MARKERS,
  PROTECTED_DATABASES,
  OpsTargetError,
  redact,
  parseDatabaseUrl,
  rejectionReason,
  resolveDedicatedTarget,
  buildDrillDatabaseName,
  isDrillDatabase
};
