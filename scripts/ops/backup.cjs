"use strict";

/**
 * OPS-01A `backup`：导出专用库并给出可校验的产物。
 *
 * 三个不能省的判定：空文件、非零退出码、缺少结束标记。
 * 少了任何一个，「备份成功」就可能只是生成了一个 0 字节文件——
 * 而这种备份要等到恢复那天才会暴露。
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { redact } = require("./dedicated-env.cjs");
const { ROOT, requireTarget, log, fail, containerRunning, runMysql } = require("./runtime.cjs");

const BACKUP_DIR = process.env.OPS_BACKUP_DIR || path.join(ROOT, "backups");

void (() => {
  let target;
  try {
    target = requireTarget();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  if (!containerRunning()) fail("MySQL 容器未运行，先跑 ops:preflight");

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const file = path.join(BACKUP_DIR, `${target.database}-${stamp}.sql`);

  log(`OPS-01A 备份：${target.database} → ${path.relative(ROOT, file)}`);
  const dump = runMysql("mysqldump", target, [
    "--single-transaction", "--quick", "--routines", "--events", "--triggers",
    // 显式带上库名与建库语句：恢复到**新库**时才不需要人工拼 CREATE DATABASE。
    "--databases", target.database
  ], { capture: true });

  if (dump.status !== 0) {
    fail(`mysqldump 失败：${redact(String(dump.stderr ?? ""), [target.password])}`);
    return;
  }
  const body = Buffer.isBuffer(dump.stdout) ? dump.stdout : Buffer.from(String(dump.stdout ?? ""));
  if (!body.length) {
    fail("mysqldump 退出码为 0 但输出为空——拒绝写出一个空备份");
    return;
  }
  const text = body.toString("utf8");
  if (!/Dump completed/u.test(text)) {
    fail("备份缺少结束标记（Dump completed），可能被截断——不接受这份产物");
    return;
  }

  fs.writeFileSync(file, body);
  const checksum = crypto.createHash("sha256").update(body).digest("hex");
  fs.writeFileSync(`${file}.sha256`, `${checksum}  ${path.basename(file)}\n`);

  log(`  文件：${path.relative(ROOT, file)}`);
  log(`  大小：${body.length} 字节`);
  log(`  sha256：${checksum}`);
  log("\n✓ 备份完成。恢复演练：npm run ops:restore-drill -- --file " + path.relative(ROOT, file));
})();
