"use strict";

/**
 * OPS-01A `migration-status`：只读的迁移状态检查。
 *
 * 刻意只跑 `prisma validate` 与 `prisma migrate status`，**不**跑 `migrate dev`
 * 或 `migrate deploy`：状态检查的价值就在于「先知道差什么，再决定动不动」。
 * 把检查和应用绑在一起，等于每次想看状态都顺手改了库。
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { redact } = require("./dedicated-env.cjs");
const { ROOT, loadDatabaseUrl, requireTarget, log, fail } = require("./runtime.cjs");

const API_DIR = path.join(ROOT, "apps", "api");

function prisma(args, target) {
  const run = spawnSync("npx", ["prisma", ...args], {
    cwd: API_DIR,
    encoding: "utf8",
    shell: true,
    // 只把这一条连接串交给 prisma；不继承可能指向别处的其他 DB 变量。
    env: { ...process.env, DATABASE_URL: loadDatabaseUrl() }
  });
  const output = redact(`${run.stdout ?? ""}${run.stderr ?? ""}`, [target.password]);
  return { status: run.status, output };
}

void (() => {
  let target;
  try {
    target = requireTarget();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }
  log(`OPS-01A 迁移状态检查（只读）：${target.database} @ ${target.host}:${target.port}`);

  const validate = prisma(["validate"], target);
  log(validate.output.trim());
  if (validate.status !== 0) fail("Prisma schema 校验失败；先修 schema，再谈迁移与恢复");

  const status = prisma(["migrate", "status"], target);
  log(status.output.trim());
  if (status.status !== 0) {
    // 有待应用迁移时 prisma 也返回非零。这不是脚本错误，而是**需要人工决定**：
    // 是先备份再 deploy，还是这套库根本不该被推进。因此如实退出非零并说明选项。
    console.error([
      "",
      "✗ 迁移状态非「已同步」。可选处置（本脚本不自动执行任何一项）：",
      "  1. 只是落后：先 ops:backup 留一份可恢复备份，再由人工执行 prisma migrate deploy；",
      "  2. 迁移失败中断：不要用 schema 回滚冒充数据恢复——先 ops:restore-drill 验证备份可用，",
      "     再决定是修复迁移还是把已验证备份恢复到新库并切换连接；",
      "  3. 目标库不该被推进：换目标，不要在这套库上继续。"
    ].join("\n"));
    process.exit(1);
  }
  log("\n✓ 迁移状态已同步");
})();
