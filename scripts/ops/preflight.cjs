"use strict";

/**
 * OPS-01A `preflight`：发布/恢复动作前的环境预检。
 *
 * 默认 fail-closed：任何一项不通过就退出非零，不给「大概能跑」的中间状态。
 * 这里只做**只读**探测，不建库、不改数据。
 */

const fs = require("node:fs");
const path = require("node:path");
const { OpsTargetError, rejectionReason } = require("./dedicated-env.cjs");
const { ROOT, CONTAINER, loadDatabaseUrl, requireTarget, log, hasCommand, containerRunning, sql } = require("./runtime.cjs");

const BACKUP_DIR = process.env.OPS_BACKUP_DIR || path.join(ROOT, "backups");

function check(label, fn) {
  try {
    const detail = fn();
    log(`  ✓ ${label}${detail ? `：${detail}` : ""}`);
    return true;
  } catch (error) {
    log(`  ✗ ${label}：${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

void (() => {
  log("OPS-01A 预检");
  const results = [];
  let target;

  results.push(check("docker 可用", () => {
    if (!hasCommand("docker")) throw new OpsTargetError("未找到 docker，请先安装并启动 Docker Desktop");
    return "已安装";
  }));
  results.push(check("MySQL 容器运行中", () => {
    if (!containerRunning()) throw new OpsTargetError(`容器 ${CONTAINER} 未运行；可用 docker compose up -d mysql 启动`);
    return CONTAINER;
  }));
  results.push(check("DATABASE_URL 已配置", () => {
    if (!loadDatabaseUrl()) throw new OpsTargetError("缺少 DATABASE_URL（进程环境或 .env）");
    return "已读取（不回显内容）";
  }));
  results.push(check("目标库为专用库", () => {
    target = requireTarget();
    return `${target.database} @ ${target.host}:${target.port}`;
  }));

  if (target) {
    results.push(check("数据库可连通且目标库存在", () => {
      const found = sql(target, `SHOW DATABASES LIKE '${target.database}'`);
      if (!found) throw new OpsTargetError(`连接成功但目标库 ${target.database} 不存在`);
      return "连通";
    }));
    results.push(check("迁移记录表可读", () => {
      const applied = sql(target, "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL", { database: target.database });
      return `已应用 ${applied} 条迁移`;
    }));
    // 只有确认过专用库之后才谈备份目录：错目标下建目录本身就是噪声。
    results.push(check("备份目录可写", () => {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const probe = path.join(BACKUP_DIR, `.write-probe-${process.pid}`);
      fs.writeFileSync(probe, "ok");
      fs.unlinkSync(probe);
      return path.relative(ROOT, BACKUP_DIR) || BACKUP_DIR;
    }));
  }

  // 顺带把「为什么共享库会被拒」显示出来，便于运维确认守卫确实生效。
  const sharedReason = rejectionReason("store_rental");
  log(`  · 守卫自检：共享库 store_rental 会被拒绝（${sharedReason}）`);

  const failed = results.filter((ok) => !ok).length;
  if (failed) {
    console.error(`\n✗ 预检未通过：${failed} 项失败。修复后重跑，不要跳过预检执行备份或恢复。`);
    process.exit(1);
  }
  log("\n✓ 预检通过：可以执行 migration-status / backup / restore-drill");
})();
