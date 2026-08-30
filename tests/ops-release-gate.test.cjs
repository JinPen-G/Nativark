const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * OPS-01B 专项：发布候选清单与只读门禁的契约。
 *
 * 行为层断言纯判定（环境变量名、产物指纹、工作区状态、敏感值拦截），
 * 源码层断言「门禁默认只读」这条最容易被后续改动破坏的性质：
 * 一旦有人在门禁里顺手加上 migrate deploy 或起服务，它就不再是门禁而是发布动作。
 */

const ROOT = path.resolve(__dirname, "..");
const facts = require(path.join(ROOT, "scripts/ops/release-facts.cjs"));

const ok = (m) => console.log(`  ✓ ${m}`);
const buf = (text) => Buffer.from(text, "utf8");

void (() => {
  // ============ 1. 环境变量只校验存在性，且只回名字 ============
  const complete = { DATABASE_URL: "mysql://u:p@h:3306/store_rental_claude", AUTH_TOKEN_SECRET: "x".repeat(40) };
  const result = facts.inspectEnvNames(complete);
  assert.deepEqual(result.missing, [], "必需变量齐备时不应报缺失");
  assert.ok(result.present.includes("DATABASE_URL"), "已配置的变量名应出现在 present");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("mysql://"), false, "结果里不得出现连接串");
  assert.equal(serialized.includes("x".repeat(40)), false, "结果里不得出现密钥值");
  ok("环境变量检查只回名字，连接串与密钥值都不进结果");

  // 空串与纯空白比「没写」更危险：看起来像配过了。必须判为缺失。
  for (const value of ["", "   ", "\t"]) {
    const partial = facts.inspectEnvNames({ DATABASE_URL: "mysql://u:p@h:3306/db_claude", AUTH_TOKEN_SECRET: value });
    assert.deepEqual(partial.missing, ["AUTH_TOKEN_SECRET"], `AUTH_TOKEN_SECRET=「${value}」必须判为缺失`);
  }
  const none = facts.inspectEnvNames({});
  assert.deepEqual(none.missing.sort(), ["AUTH_TOKEN_SECRET", "DATABASE_URL"], "两项必需变量都缺时都要列出");
  assert.ok(none.optionalMissing.includes("API_PORT"), "可选变量缺失应单独列出，不混进必需缺失");
  ok("空串/空白视为缺失；必需与可选缺失分开列出");

  // ============ 2. 产物指纹：可比对、与顺序无关、随内容变 ============
  const files = [
    { path: "apps/api/dist/main.js", bytes: 3, contents: buf("abc") },
    { path: "apps/api/dist/a/b.js", bytes: 2, contents: buf("de") }
  ];
  const first = facts.digestFiles(files);
  const reordered = facts.digestFiles([files[1], files[0]]);
  assert.equal(first.digest, reordered.digest, "同一组文件换顺序必须得到同一指纹——目录遍历顺序跨平台不稳定");
  assert.equal(first.fileCount, 2);
  assert.equal(first.totalBytes, 5);
  const mutated = facts.digestFiles([{ path: "apps/api/dist/main.js", bytes: 3, contents: buf("abd") }, files[1]]);
  assert.notEqual(first.digest, mutated.digest, "内容变了指纹必须变，否则证明不了「测过的就是要发的」");
  const renamed = facts.digestFiles([{ path: "apps/api/dist/main2.js", bytes: 3, contents: buf("abc") }, files[1]]);
  assert.notEqual(first.digest, renamed.digest, "路径变了指纹也必须变");
  assert.equal(facts.digestFiles([]).digest, undefined, "产物缺失时不得伪造一个指纹");
  assert.equal(facts.digestFiles([]).fileCount, 0);
  // Windows 反斜杠路径要归一，否则同一份产物在两台机器上指纹不同。
  const windows = facts.digestFiles([{ path: "apps\\api\\dist\\main.js", bytes: 3, contents: buf("abc") }, files[1]]);
  assert.equal(windows.digest, first.digest, "路径分隔符必须归一化后再摘要");
  ok("产物指纹：与顺序无关、随内容与路径变化、缺失不伪造、分隔符归一");

  // ============ 3. 工作区状态 ============
  assert.equal(facts.summarizeWorktree("").clean, true, "空 porcelain 表示干净");
  assert.equal(facts.summarizeWorktree("   \n\n").clean, true, "只有空行同样算干净");
  const dirty = facts.summarizeWorktree(" M apps/api/src/main.ts\n?? scripts/new.cjs");
  assert.equal(dirty.clean, false, "有改动即为脏——清单里的提交号必须名副其实");
  assert.equal(dirty.changedCount, 2, "未跟踪文件同样计数：它们不在提交里，却可能被打进产物");
  assert.deepEqual(dirty.changed, ["apps/api/src/main.ts", "scripts/new.cjs"], "只回文件名，不回内容");
  ok("工作区状态：未跟踪文件也算脏，只回文件名不回内容");

  // ============ 4. 敏感值拦截 ============
  const password = "store_rental";
  // 关键回归：库名恰好以口令为前缀。这**不是**泄露，必须放行——
  // 一个总在误报的检查很快会被关掉，那比没有检查更糟。
  assert.equal(
    facts.assertNoSecrets({ database: { database: "store_rental_claude" } }, [password]),
    true,
    "库名包含口令子串不构成泄露，不得误报"
  );
  const rejects = (manifest, secrets, pattern, label) => {
    assert.throws(() => facts.assertNoSecrets(manifest, secrets), (error) => {
      assert.match(error.message, pattern, `${label}：实际「${error.message}」`);
      return true;
    }, label);
  };
  rejects({ note: password }, [password], /整体等于一个已知秘密/u, "字符串值整体等于口令");
  rejects({ url: "mysql://svc:s3cr3t@db:3306/x_claude" }, [], /连接串明文/u, "连接串明文");
  rejects({ db: { url: "mysql://svc:store_rental@db:3306/x_claude" } }, [password], /连接串明文|含已知秘密/u, "连接串里含口令");
  rejects({ auth: { secret: "abc123" } }, [], /敏感字段/u, "sensitive 键名未掩码");
  rejects({ items: [{ token: "abc" }] }, [], /敏感字段/u, "数组内的敏感键名也要拦");
  assert.equal(facts.assertNoSecrets({ auth: { secret: "***" } }, []), true, "已掩码的敏感字段应放行");
  ok("敏感值拦截：整值等于秘密/连接串/敏感键名被拒，库名前缀重合与已掩码值放行");

  // ============ 5. 门禁必须默认只读 ============
  const gate = fs.readFileSync(path.join(ROOT, "scripts/ops/release-gate.cjs"), "utf8");
  assert.match(gate, /migrate", "status"/u, "门禁必须做只读迁移状态检查");
  assert.equal(
    /"deploy"|migrate deploy|migrate", "dev"/u.test(gate),
    false,
    "门禁不得自动应用迁移——发布前最该知道的是差什么，而不是已经替你改了"
  );
  for (const forbidden of ["app.listen", "nest start", "dist/main.js", "docker compose up", "docker start", "docker restart"]) {
    assert.equal(gate.includes(forbidden), false, `门禁不得启动或替换服务：命中 ${forbidden}`);
  }
  // 唯一允许的写盘动作是显式 --emit 落清单。
  const writes = gate.match(/fs\.(writeFileSync|mkdirSync|rmSync|unlinkSync|appendFileSync)/gu) ?? [];
  assert.deepEqual(
    [...new Set(writes)].sort(),
    ["fs.mkdirSync", "fs.writeFileSync"],
    `门禁只应有建目录与写清单两种写盘动作，实际 ${[...new Set(writes)].join(",")}`
  );
  assert.match(gate, /if \(flag\("emit"\)\) \{[\s\S]{0,200}mkdirSync/u, "落盘必须在 --emit 分支内");
  assert.match(gate, /dry-run/u, "默认模式必须标明 dry-run");
  assert.match(gate, /assertNoSecrets\(manifest, secrets\)/u, "清单落盘前必须过敏感值闸门");
  assert.match(gate, /assertContainerEndpoint\(requireTarget\(\)\)/u, "目标库必须过专用库与端点守卫");
  ok("门禁默认只读：只查迁移状态不 deploy、不起服务、只有 --emit 才写清单");

  // ============ 6. 清单字段齐备（发布要固定的东西一个都不能少） ============
  for (const field of ["commit", "shortCommit", "branch", "worktreeClean"]) {
    assert.ok(gate.includes(field), `清单缺少 git 字段 ${field}`);
  }
  assert.match(gate, /toolchain: versions/u, "清单必须固定工具链版本");
  assert.match(gate, /builds: buildSummary/u, "清单必须固定产物摘要");
  assert.match(gate, /healthEntrypoints: HEALTH_ENTRYPOINTS/u, "清单必须登记健康检查入口");
  assert.match(gate, /notCovered/u, "清单必须写明未覆盖边界，不得暗示完整 OPS-01 已完成");
  assert.ok(facts.HEALTH_ENTRYPOINTS.some((row) => row.path === "/api/health"), "健康入口必须包含 /api/health");
  assert.ok(
    facts.RELEASE_ENV_VARS.filter((row) => row.required).map((row) => row.name).includes("AUTH_TOKEN_SECRET"),
    "AUTH_TOKEN_SECRET 必须是必需项：缺失时非生产会回落到仓库里公开的开发密钥"
  );
  ok("清单字段：提交、工具链、产物摘要、健康入口与未覆盖边界齐备");

  console.log("\nOPS-01B 发布候选门禁专项：全部通过");
})();
