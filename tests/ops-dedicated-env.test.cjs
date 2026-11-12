const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * OPS-01A 专项：专用环境守卫与脱敏的契约。
 *
 * 这些判定是「不会误伤共享库、不会泄露口令」的唯一依据，因此逐条断言到行为，
 * 而不是靠跑一次演练顺利就认为规则成立——顺利那次恰好目标正确，说明不了守卫有效。
 */

const ROOT = path.resolve(__dirname, "..");
const ops = require(path.join(ROOT, "scripts/ops/dedicated-env.cjs"));
const runtime = require(path.join(ROOT, "scripts/ops/runtime.cjs"));
const { OpsTargetError } = ops;

const ok = (m) => console.log(`  ✓ ${m}`);
const rejects = (fn, pattern, label) => {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof OpsTargetError, `${label}：应抛 OpsTargetError，实际 ${error?.name}`);
    assert.match(error.message, pattern, `${label}：实际「${error.message}」`);
    return true;
  }, label);
};

void (() => {
  // ============ 1. 连接信息只来自 env，缺失即失败 ============
  rejects(() => ops.parseDatabaseUrl(undefined), /缺少 DATABASE_URL/u, "未配置 DATABASE_URL");
  rejects(() => ops.parseDatabaseUrl(""), /缺少 DATABASE_URL/u, "空 DATABASE_URL");
  rejects(() => ops.parseDatabaseUrl("   "), /缺少 DATABASE_URL/u, "空白 DATABASE_URL");
  rejects(() => ops.parseDatabaseUrl("not-a-url"), /不是合法的连接串/u, "非法连接串");
  rejects(() => ops.parseDatabaseUrl("postgresql://u:p@localhost:5432/db"), /仅支持 mysql/u, "非 mysql 驱动");
  rejects(() => ops.parseDatabaseUrl("mysql://u:p@localhost:3306/"), /未指定数据库名/u, "缺库名");
  rejects(() => ops.parseDatabaseUrl("mysql://localhost:3306/rental_os_claude"), /未指定数据库账号/u, "缺账号");
  ok("连接信息缺失、驱动错误、缺库名或缺账号一律明确失败");

  // ============ 2. 共享库与系统库必须被拒 ============
  for (const database of ["store_rental", "STORE_RENTAL", "rental_os", "RENTAL_OS", "rental_os_prod", "rental_os_production", "mysql", "information_schema"]) {
    const reason = ops.rejectionReason(database);
    assert.ok(reason, `共享/系统库 ${database} 必须被拒绝`);
    rejects(
      () => ops.resolveDedicatedTarget(`mysql://u:p@localhost:3306/${database}`),
      /共享或系统库|缺少专用库标记/u,
      `共享库 ${database}`
    );
  }
  ok("共享开发库、生产命名与系统库全部被拒（大小写无关）");

  for (const database of ["rental_os_prod_claude", "rental_os_staging_e2e", "rental_os_live_sandbox"]) {
    rejects(
      () => ops.resolveDedicatedTarget(`mysql://u:p@localhost:3306/${database}`),
      /生产\/共享环境标记/u,
      `混入专用标记的生产库 ${database}`
    );
  }
  assert.equal(ops.rejectionReason("rental_os_zcode"), undefined, "zcode 工作树专用库应通过统一守卫");
  for (const database of ["rental_os_claudedev", "rental_os_e2etest", "rental-os-claude", "rental_os_claude%60evil"]) {
    rejects(
      () => ops.resolveDedicatedTarget(`mysql://u:p@localhost:3306/${database}`),
      /缺少专用库标记|不是安全的数据库名/u,
      `模糊标记或危险库名 ${database}`
    );
  }
  ok("生产标记不能用专用词绕过，库名与专用标记均按安全边界校验");

  // ============ 3. 没有专用标记的库默认拒绝，而不是默认放行 ============
  // 黑名单永远漏项；`rental_os_backup` 这类名字不在黑名单里，但同样不该被当作演练目标。
  for (const database of ["rental_os_backup", "rentaldb", "app_main", "temp1"]) {
    rejects(
      () => ops.resolveDedicatedTarget(`mysql://u:p@localhost:3306/${database}`),
      /缺少专用库标记/u,
      `未标记库 ${database}`
    );
  }
  ok("缺少专用标记的库默认拒绝（fail-closed，不靠黑名单兜底）");

  // ============ 4. 专用库放行，并如实解析连接信息 ============
  const target = ops.resolveDedicatedTarget("mysql://svc:s3cr3t@db.internal:3307/rental_os_claude");
  assert.equal(target.database, "rental_os_claude");
  assert.equal(target.host, "db.internal");
  assert.equal(target.port, 3307);
  assert.equal(target.user, "svc");
  assert.equal(target.password, "s3cr3t");
  for (const marker of ops.DEDICATED_MARKERS) {
    assert.equal(ops.rejectionReason(`rental_os_${marker}`), undefined, `带 ${marker} 标记的库应放行`);
  }
  ok("带专用标记的库放行，主机、端口、账号与库名如实解析");
  const previousMapping = {
    MYSQL_HOST_PORT: process.env.MYSQL_HOST_PORT,
    MYSQL_BIND_HOST: process.env.MYSQL_BIND_HOST
  };
  try {
    delete process.env.MYSQL_HOST_PORT;
    delete process.env.MYSQL_BIND_HOST;
    assert.equal(
      runtime.assertContainerEndpoint(ops.resolveDedicatedTarget("mysql://svc:p@localhost:3306/rental_os_claude")).database,
      "rental_os_claude"
    );
    rejects(
      () => runtime.assertContainerEndpoint(target),
      /只支持容器.*本地 3306/u,
      "远程主机或非 3306 端口"
    );
    rejects(
      () => runtime.assertContainerEndpoint(ops.resolveDedicatedTarget("mysql://svc:p@127.0.0.1:3308/rental_os_claude")),
      /主机或端口必须与显式配置一致/u,
      "未声明的宿主映射端口"
    );
    process.env.MYSQL_HOST_PORT = "3308";
    process.env.MYSQL_BIND_HOST = "127.0.0.1";
    for (const host of ["127.0.0.1", "localhost"]) {
      const mapped = ops.resolveDedicatedTarget(`mysql://svc:p@${host}:3308/rental_os_claude`);
      assert.equal(runtime.assertContainerEndpoint(mapped), mapped, "宿主连接串必须保留原主机与映射端口");
    }
    for (const host of ["mysql", runtime.CONTAINER]) {
      const direct = ops.resolveDedicatedTarget(`mysql://svc:p@${host}:3306/rental_os_claude`);
      assert.equal(runtime.assertContainerEndpoint(direct), direct, "固定容器内部仍使用 3306");
      rejects(
        () => runtime.assertContainerEndpoint({ ...direct, port: 3308 }),
        /主机或端口必须与显式配置一致/u,
        "容器内部不能使用宿主映射端口"
      );
    }
    for (const url of [
      "mysql://svc:p@127.0.0.1:3306/rental_os_claude",
      "mysql://svc:p@127.0.0.2:3308/rental_os_claude",
      "mysql://svc:p@db.internal:3308/rental_os_claude",
      "mysql://svc:p@other-mysql:3306/rental_os_claude"
    ]) {
      rejects(() => runtime.assertContainerEndpoint(ops.resolveDedicatedTarget(url)),
        /主机或端口必须与显式配置一致/u, "错误宿主、端口或其他容器");
    }
    process.env.MYSQL_BIND_HOST = "127.0.0.2";
    assert.equal(runtime.assertContainerEndpoint(ops.resolveDedicatedTarget("mysql://svc:p@127.0.0.2:3308/rental_os_claude")).host, "127.0.0.2");
    rejects(() => runtime.assertContainerEndpoint(ops.resolveDedicatedTarget("mysql://svc:p@localhost:3308/rental_os_claude")),
      /主机或端口必须与显式配置一致/u, "localhost 不能代替其他回环绑定地址");
    process.env.MYSQL_BIND_HOST = "127.0.0.1";
    for (const port of ["1", "65535"]) {
      process.env.MYSQL_HOST_PORT = port;
      assert.equal(runtime.assertContainerEndpoint(ops.resolveDedicatedTarget(`mysql://svc:p@127.0.0.1:${port}/rental_os_claude`)).port, Number(port));
    }
    for (const port of ["0", "65536", "3308.5", "3.308e3", "-3308", "bad", " 3308 "]) {
      process.env.MYSQL_HOST_PORT = port;
      rejects(() => runtime.assertContainerEndpoint(target), /MYSQL_HOST_PORT/u, "无效宿主映射端口");
    }
    process.env.MYSQL_HOST_PORT = "3308";
    for (const host of ["0.0.0.0", "10.0.0.8", "db.internal", "127.999.0.1", "::1"]) {
      process.env.MYSQL_BIND_HOST = host;
      rejects(() => runtime.assertContainerEndpoint(target), /MYSQL_BIND_HOST/u, "未支持的绑定地址");
    }
    process.env.MYSQL_HOST_PORT = "";
    process.env.MYSQL_BIND_HOST = "";
    assert.equal(runtime.assertContainerEndpoint(ops.resolveDedicatedTarget("mysql://svc:p@127.0.0.1:3306/rental_os_claude")).port, 3306);
  } finally {
    for (const [name, value] of Object.entries(previousMapping)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  ok("宿主端口按显式回环映射校验，容器内固定 3306，坏配置及错目标均拒绝");

  // ============ 5. 演练库必须是新库，且与源库不同名 ============
  const drill = ops.buildDrillDatabaseName("rental_os_claude", new Date("2026-08-30T01:02:03.000Z"));
  assert.equal(drill, "rental_os_claude_drill_20260830010203", "演练库名应带时间戳后缀");
  assert.notEqual(drill, "rental_os_claude", "演练库不得与源库同名——往源库恢复是覆盖数据，不是验证备份");
  assert.ok(ops.isDrillDatabase(drill), "生成的演练库必须能被识别为本次演练库");
  assert.ok(drill.length <= 64, "库名不得超过 MySQL 上限");
  rejects(
    () => ops.buildDrillDatabaseName(`rental_os_claude_${"x".repeat(60)}`),
    /不超过 64 字符/u,
    "MySQL 本身不可能存在的超长源库名"
  );
  // 源库本身不合法时不允许生成演练库：否则可以借演练绕过守卫在共享库旁建库。
  rejects(() => ops.buildDrillDatabaseName("store_rental"), /共享或系统库/u, "为共享库生成演练库");
  ok("演练库为带时间戳的新库、可识别、不超长，且不能为共享库生成");

  // ============ 6. 只认本次演练库形态，其余一律不可删 ============
  for (const name of ["store_rental", "rental_os_claude", "rental_os_claude_drill", "rental_os_claude_drill_2026", "drill"]) {
    assert.equal(ops.isDrillDatabase(name), false, `${name} 不应被识别为可删除的演练库`);
  }
  ok("清理判定只认 *_drill_<14位时间戳>，源库与近似名字都不可删");

  // ============ 7. 口令不得进日志 ============
  assert.equal(ops.redact("connecting s3cr3t", ["s3cr3t"]), "connecting ***", "显式口令必须被掩码");
  assert.equal(
    ops.redact("mysql://svc:s3cr3t@db.internal:3307/rental_os_claude"),
    "mysql://svc:***@db.internal:3307/rental_os_claude",
    "连接串口令段必须被掩码，即使未显式传入口令"
  );
  assert.equal(ops.redact("", ["s3cr3t"]), "", "空文本不应报错");
  assert.equal(ops.redact(undefined), "", "undefined 应安全转空串");
  ok("脱敏：显式口令与连接串口令段都不会出现在输出里");

  // ============ 8. 脚本源码里不得留库名或凭据默认值 ============
  // 这条防的是「守卫写对了，但某个入口脚本又内置了一份 store_rental / 口令」。
  const opsDir = path.join(ROOT, "scripts/ops");
  const sources = fs.readdirSync(opsDir).filter((name) => name.endsWith(".cjs"));
  assert.ok(sources.length >= 5, `ops 脚本数量异常：${sources.join(",")}`);
  for (const name of sources) {
    const source = fs.readFileSync(path.join(opsDir, name), "utf8");
    // 允许出现在 PROTECTED_DATABASES 名单与注释里，但不得作为默认值赋给变量。
    assert.equal(
      /=\s*["']store_rental["']/u.test(source),
      false,
      `${name} 不得把共享库名写成默认值`
    );
    assert.equal(
      /password\s*[:=]\s*["'][^"']+["']/u.test(source),
      false,
      `${name} 不得内置口令`
    );
    assert.equal(
      /-p\$\{|["']-p["']\s*\+|`-p\$\{/u.test(source),
      false,
      `${name} 不得用 -p<password> 传口令（会进容器进程列表与告警）`
    );
  }
  const ps1 = ["scripts/backup-mysql.ps1", "scripts/restore-mysql.ps1"];
  for (const relative of ps1) {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.equal(/\[string\]\$Password/u.test(source), false, `${relative} 不得再接受内置口令参数`);
    assert.equal(/store_rental["']/u.test(source), false, `${relative} 不得内置共享库名`);
  }
  ok("入口脚本：无共享库默认值、无内置口令、不使用 -p<password>");

  // ============ 9. 备份脚本必须拒绝空产物与被截断产物 ============
  const backupSource = fs.readFileSync(path.join(opsDir, "backup.cjs"), "utf8");
  assert.match(backupSource, /if \(!body\.length\)/u, "备份必须拒绝空输出");
  assert.match(backupSource, /Dump completed/u, "备份必须校验结束标记，防止截断产物被当成可用备份");
  assert.match(backupSource, /createHash\("sha256"\)/u, "备份必须产出校验和");
  const drillSource = fs.readFileSync(path.join(opsDir, "restore-drill.cjs"), "utf8");
  assert.match(drillSource, /校验和不匹配/u, "演练必须比对校验和");
  assert.match(drillSource, /演练库已保留供排查/u, "失败时必须保留演练库并给出清理指引");
  // OPS-01C 起，改写与校验移入共用内核 restore-core.cjs：这两段是数据安全的
  // 关键判定，两处各留一份拷贝时修好一处、另一处照旧漏，而漏的那次才是事故。
  // 因此断言「演练确实走内核」+「内核里的判定仍在」，而不是在演练脚本里找字面量。
  assert.match(drillSource, /require\("\.\/restore-core\.cjs"\)/u, "演练必须复用共用恢复内核，不得自带一份改写逻辑");
  assert.match(drillSource, /rewriteBackupForTarget\(body\.toString\("utf8"\), target\.database, drill\)/u, "改写必须由内核执行");
  assert.match(drillSource, /verifyClone\(\(statement\) => sql\(admin, statement\), target\.database, drill\)/u, "校验必须由内核执行");
  const coreSource = fs.readFileSync(path.join(opsDir, "restore-core.cjs"), "utf8");
  assert.match(coreSource, /可执行语句/u, "改写不彻底时必须拒绝导入，以免写回源库");
  assert.match(coreSource, /\(\?!\[!\]\)/u, "MySQL 可执行版本注释不能被当普通注释忽略");
  // 抽样一张都没比上时必须失败：空抽样下的「行数一致」是空话。
  assert.match(coreSource, /if \(!rows\.length\)/u, "抽样表全部缺失时必须失败，不得给出空洞的通过结论");
  assert.match(coreSource, /"Tenant"/u, "抽样清单必须使用真实表名（未 @@map 的模型是 PascalCase）");
  assert.match(coreSource, /目标库与源库同名/u, "内核必须拒绝把备份改写回源库");
  // DDL 只能用单独配置的管理凭据，不得回退到应用账号。
  assert.match(drillSource, /requireAdminTarget/u, "建/删演练库必须使用单独的管理凭据");
  assert.match(drillSource, /sql\(admin, `CREATE DATABASE/u, "CREATE DATABASE 必须走管理账号");
  assert.match(drillSource, /sql\(admin, `DROP DATABASE/u, "DROP DATABASE 必须走管理账号");
  const runtimeSource = fs.readFileSync(path.join(opsDir, "runtime.cjs"), "utf8");
  assert.match(runtimeSource, /缺少管理凭据/u, "未配置管理凭据时必须明确失败，不得用应用账号试一把");
  assert.match(runtimeSource, /"-e", "MYSQL_PWD"/u, "docker 参数只能出现 MYSQL_PWD 变量名");
  assert.match(runtimeSource, /env: \{ \.\.\.process\.env, MYSQL_PWD: target\.password \}/u, "口令值必须经子进程环境传入");
  assert.equal(/`MYSQL_PWD=\$\{target\.password\}`/u.test(runtimeSource), false, "口令值不得拼进宿主机 docker 命令参数");
  const statusSource = fs.readFileSync(path.join(opsDir, "migration-status.cjs"), "utf8");
  assert.equal(/migrate deploy["']\]|"deploy"/u.test(statusSource), false, "状态检查不得自动应用迁移");
  ok("产物校验：空/截断备份被拒，演练比对校验和，状态检查不自动改库");

  console.log("\nOPS-01A 专用环境守卫专项：全部通过");
})();
