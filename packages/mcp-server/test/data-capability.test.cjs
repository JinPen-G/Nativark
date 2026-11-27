"use strict";
/** 内存构建及只读元数据/原账替身；不安装包、执行 SQL 或连接数据库。 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { registerHooks } = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { createBuild } = require('../../../scripts/check-rental-package-build.cjs');

const root = path.resolve(__dirname, '../../..');
const base = path.resolve(__dirname, '..');
// 本版五份 SQL 的固定材料来源；包发行的 source 由实际构建提交另行确定。
const sqlMaterialCommit = '907c199c2648f24b522d40dd3ce1ef11f41b8490';

function memoryPackage() {
  // Consume this build's formal public exports, never stale dist from another
  // release. The existing build helper selects MCP's locked TypeScript version.
  const build = createBuild(path.join(root, 'node_modules'), { quiet: true });
  for (const name of ['platform-contracts', 'core-contracts', 'core-host'])
    build.compile(`packages/${name}/tsconfig.json`);
  const observer = path.join(root, 'packages/platform-core-host/tsconfig.mcp-test.json').split(path.sep).join('/');
  build.virtual.set(observer, JSON.stringify({ extends: './tsconfig.json',
    files: ['src/mysql-structure.ts', 'src/mysql-physical.ts'], include: [] }));
  build.compile(observer);
  build.compileMcp();
  const files = new Map();
  for (const [file, content] of build.outputs)
    if (file.startsWith(base.split(path.sep).join('/') + '/dist/'))
      files.set(path.relative(base, file).split(path.sep).join('/'), Buffer.from(content));
  for (const file of ['package.json', 'README.md', 'data-contribution.json', 'prisma/schema.prisma'])
    files.set(file, fs.readFileSync(path.join(base, file)));
  files.set('LICENSE', fs.readFileSync(path.join(root, 'LICENSE')));
  const contribution = JSON.parse(files.get('data-contribution.json'));
  // Git 原字节用于复现发行，Windows 工作区可能转换了 SQL 换行。
  for (const item of contribution.sql)
    files.set(item.file, execFileSync('git', ['show', `${sqlMaterialCommit}:packages/mcp-server/${item.file}`], { cwd: root }));
  return { files, build };
}

function physicalRows(tables) {
  const rows = { tables: [], columns: [], indexes: [], checks: [], foreignKeys: [] };
  for (const table of tables) {
    const tableName = table.name;
    rows.tables.push({ tableName, engine: 'InnoDB', collation: table.collation });
    for (const field of table.columns) rows.columns.push({ tableName, ...field, nullable: field.nullable ? 'YES' : 'NO', extra: '' });
    for (const index of table.indexes) index.columns.forEach((columnName, at) => rows.indexes.push({
      tableName, name: index.name, position: at + 1, columnName, nonUnique: index.unique ? 0 : 1, prefix: null
    }));
    for (const check of table.checks) rows.checks.push({ tableName, ...check, enforced: 'YES' });
    for (const key of table.foreignKeys) key.columns.forEach((columnName, at) => rows.foreignKeys.push({
      tableName, name: key.name, position: at + 1, columnName, targetTable: key.targetTable,
      targetColumn: key.targetColumns[at], sameSchema: 1, deleteRule: key.deleteRule, updateRule: key.updateRule
    }));
  }
  return rows;
}

test('MCP 能力包、原结构和原迁移账共同控制准入', async () => {
  const { files, build } = memoryPackage();
  const metadata = JSON.parse(files.get('package.json'));
  // 按包的实际 exports 载入内存构建产物，不覆盖本树现有 dist。
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('@rental-os/mcp-server/')) {
        const key = './' + specifier.slice('@rental-os/mcp-server/'.length);
        const target = metadata.exports[key]?.import;
        if (target) return { url: pathToFileURL(path.join(base, target)).href, shortCircuit: true };
      }
      if (specifier.startsWith('@rental-os/')) {
        const target = build.exported(specifier, true);
        assert(build.outputs.has(target), `missing current public build export: ${specifier}`);
        return { url: pathToFileURL(target).href, shortCircuit: true };
      }
      if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')
        && build.outputs.has(fileURLToPath(context.parentURL).split(path.sep).join('/'))) {
        const target = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier).split(path.sep).join('/');
        const built = [target, target + '.js', target + '/index.js'].find(file => build.outputs.has(file));
        assert(built, `missing current relative build export: ${specifier}`);
        return { url: pathToFileURL(built).href, shortCircuit: true };
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith('file:')) {
        const name = path.relative(base, fileURLToPath(url)).split(path.sep).join('/');
        if (name.startsWith('dist/') && files.has(name) && name.endsWith('.js'))
          return { format: 'module', source: files.get(name), shortCircuit: true };
        const built = build.outputs.get(fileURLToPath(url).split(path.sep).join('/'));
        if (built !== undefined && url.endsWith('.js'))
          return { format: 'commonjs', source: built, shortCircuit: true };
      }
      return next(url, context);
    }
  });
  const structure = require('@rental-os/platform-core-host/mysql-structure');
  const parse = structure.mysqlStructureFromMigrations;
  let expected;
  structure.mysqlStructureFromMigrations = (...args) => (expected = parse(...args));
  try {
    const capability = await import('@rental-os/mcp-server/data-capability');
    const { createMcpMysqlDataPlan } = await import('@rental-os/mcp-server/mysql-data');
    const { createCoreMigrationDeployment } = require('@rental-os/core-contracts/deployment');
    const { createMysqlCoreDeploymentObservation } = require('@rental-os/core-host/mysql-deployment');
    const { createCoreDeployedCatalogue } = require('@rental-os/core-host');
    const source = { repository: 'https://example.invalid/candidate', commit: 'a'.repeat(40) };
    const release = capability.createMcpDataRelease({ files, source });
    console.log(`内存候选完整包 SHA-256 ${release.sha256}；${files.size} 文件；来源为测试夹具`);
    assert.equal(release.id, 'mcp');
    assert.equal(release.version, '0.1.1');
    assert.equal(release.data.version, '0.1.0');
    assert.deepEqual(release.data.migrations.map(item => item.id), [
      'mcp.0001-oauth', 'mcp.0002-read-budget', 'mcp.0003-catalog-goal', 'mcp.0004-catalog-intent', 'mcp.0005-catalog-adoption'
    ]);
    assert.equal(capability.readMcpDataPackage(files, release).migrations.length, 5);
    const changed = new Map(files);
    changed.set('mysql-oauth-schema.sql', Buffer.from('not the fixed SQL'));
    assert.throws(() => capability.readMcpDataPackage(changed, release), /摘要变化/);
    const removed = new Map(files);
    removed.delete('dist/data-capability.js');
    assert.throws(() => capability.createMcpDataRelease({ files: removed, source }), /构建文件集合/);
    const missingInternal = new Map(files);
    missingInternal.delete('dist/json-snapshot.js');
    assert.throws(() => capability.createMcpDataRelease({ files: missingInternal, source }), /构建文件集合/);
    const alteredMetadata = new Map(files);
    const incompleteMetadata = structuredClone(metadata);
    delete incompleteMetadata.exports['./service'];
    alteredMetadata.set('package.json', Buffer.from(JSON.stringify(incompleteMetadata)));
    assert.throws(() => capability.createMcpDataRelease({ files: alteredMetadata, source }), /元数据/);
    assert.throws(() => createMcpMysqlDataPlan({ files, release, tableCollation: 'utf8mb4; DROP TABLE x' }), /排序规则/);
    assert.throws(() => createMcpMysqlDataPlan({ files, release, tableCollation: 'utf8mb4_0900_ai_ci', originalMigrationNames: ['missing'] }), /逐项对应/);
    const plan = createMcpMysqlDataPlan({ files, release, tableCollation: 'utf8mb4_0900_ai_ci' });
    assert.equal(expected.length, 30);
    assert.equal(expected.find(table => table.name === 'mcp_oauth_browser_consents').columns.find(column => column.name === 'state').collation, 'utf8mb4_0900_ai_ci');
    for (const [tableName, indexName] of [
      ['mcp_oauth_grants', 'mcp_catalog_goal_grant_owner'],
      ['mcp_read_goal_budgets', 'mcp_catalog_goal_budget_grant'],
      ['mcp_read_target_bindings', 'mcp_catalog_goal_binding_owner'],
      ['mcp_oauth_grants', 'mcp_oauth_grant_self_list']
    ]) assert(expected.find(table => table.name === tableName).indexes.some(index => index.name === indexName));
    assert(expected.find(table => table.name === 'mcp_read_calls').foreignKeys.some(key => key.targetTable === 'mcp_read_goal_budgets'));
    assert(expected.find(table => table.name === 'mcp_catalog_goal_history').foreignKeys.some(key => key.targetTable === 'mcp_catalog_goal_adoptions'));

    const state = { physical: physicalRows(expected), receipts: [], missingLedger: false };
    const database = { async $queryRaw(statement) {
      const sql = statement.sql.replace(/\s+/gu, ' ').trim();
      assert.match(sql, /^SELECT\b/u);
      if (sql.includes('FROM _prisma_migrations')) {
        if (state.missingLedger) throw new Error('原账不可读');
        return structuredClone(state.receipts);
      }
      const kind = sql.includes('information_schema.TABLES') ? 'tables' : sql.includes('information_schema.COLUMNS') ? 'columns'
        : sql.includes('information_schema.STATISTICS') ? 'indexes' : sql.includes('information_schema.TABLE_CONSTRAINTS') ? 'checks'
          : sql.includes('information_schema.KEY_COLUMN_USAGE') ? 'foreignKeys' : undefined;
      assert(kind, `unexpected read: ${sql}`);
      return structuredClone(state.physical[kind].filter(row => statement.values.includes(row.tableName)));
    } };
    const version = { minInclusive: '0.1.9', maxExclusive: '0.1.10' };
    const platform = { data: { version: '0.1.9', readable: version, migrations: [] }, migrationNames: [],
      async readPhysical() { return { version: '0.1.9', observedAt: '2026-11-26T00:00:00.000Z', sha256: 'f'.repeat(64) }; } };
    const lock = { lockVersion: 1, platform: { versions: { platform: '0.2.0', contract: '0.1.1', node: '24.13.0', capabilities: {} },
      source, sha256: 'b'.repeat(64), data: platform.data }, cores: [], dataCapabilities: [release] };
    const { checkPlatformDataCapabilities } = require('@rental-os/core-contracts');
    assert.deepEqual(release.compatibility.platform, { minInclusive: '0.1.0', maxExclusive: '0.3.0' });
    assert.deepEqual(checkPlatformDataCapabilities(lock), []);
    const previousRange = structuredClone(lock);
    previousRange.dataCapabilities[0].compatibility.platform.maxExclusive = '0.2.0';
    assert(checkPlatformDataCapabilities(previousRange).some(issue => issue.code === 'platform_version'),
      'the former range must still refuse the new platform');
    for (const version of ['0.1.0', '0.1.17']) {
      const prior = structuredClone(lock); prior.platform.versions.platform = version;
      assert.deepEqual(checkPlatformDataCapabilities(prior), [], 'existing platform compatibility remains available');
    }
    for (const version of ['0.0.9', '0.3.0']) {
      const outside = structuredClone(lock); outside.platform.versions.platform = version;
      assert(checkPlatformDataCapabilities(outside).some(issue => issue.code === 'platform_version'));
      assert.throws(() => createCoreMigrationDeployment({ lock: outside, platform: [], cores: new Map(),
        dataCapabilities: new Map([['mcp', files]]) }), /compatibility.platform/);
    }
    const wrongData = structuredClone(lock); wrongData.platform.data.version = '0.1.10';
    assert(checkPlatformDataCapabilities(wrongData).some(issue => issue.code === 'platform_data_version'),
      'a supported platform release does not authorize a different data baseline');
    const deployment = createCoreMigrationDeployment({ lock, platform: [], cores: new Map(), dataCapabilities: new Map([['mcp', files]]) });
    release.data.migrations.forEach((migration, at) => {
      const output = deployment.get(`migrations/${plan.migrationNames[at]}/migration.sql`);
      assert.deepEqual(Buffer.from(output), Buffer.from(files.get(migration.file)));
    });
    const observation = createMysqlCoreDeploymentObservation({ database, platform, cores: [], dataCapabilities: [{ capabilityId: 'mcp', ...plan }] });
    const catalogue = createCoreDeployedCatalogue({ lock, registrations: [], observations: observation });
    const unavailable = error => error.code === 'core_unavailable';
    const unselected = createCoreDeployedCatalogue({ lock: { ...lock, dataCapabilities: [] }, registrations: [], observations: observation });
    await assert.rejects(unselected.requireDataCapabilityAvailable('mcp'), unavailable);

    // 表齐但没有原账时，观察可描述空链，最终数据门禁必须拒绝。
    assert.equal((await observation.read()).dataCapabilities[0].appliedMigrations.length, 0);
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), unavailable);
    state.receipts = plan.migrationNames.map((migrationName, at) => ({ migrationName, checksum: plan.data.migrations[at].sha256,
      finishedAt: new Date('2026-11-26T00:00:00Z'), rolledBackAt: null, hasFailure: false }));
    await catalogue.requireDataCapabilityAvailable('mcp');

    const complete = structuredClone(state.physical);
    state.physical.tables = [];
    assert.equal((await observation.read()).dataCapabilities.length, 0);
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), unavailable);
    state.physical = structuredClone(complete);
    state.physical.tables.pop();
    assert.equal((await observation.read()).dataCapabilities.length, 0);
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), unavailable);
    state.physical = structuredClone(complete);
    state.physical.indexes = state.physical.indexes.filter(row => row.name !== 'mcp_catalog_goal_budget_grant');
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), unavailable);
    state.physical = structuredClone(complete);
    state.physical.checks.pop();
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), unavailable);
    state.physical = structuredClone(complete);
    state.physical.foreignKeys.pop();
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), unavailable);
    state.physical = structuredClone(complete);
    state.physical.tables[0].collation = 'latin1_swedish_ci';
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), unavailable);
    state.physical = complete;
    state.receipts[1].checksum = '0'.repeat(64);
    assert.equal((await observation.read()).dataCapabilities[0].appliedMigrations[1].sha256, '0'.repeat(64));
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), unavailable);
    state.receipts[1].checksum = plan.data.migrations[1].sha256;
    [state.receipts[0], state.receipts[1]] = [state.receipts[1], state.receipts[0]];
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), unavailable);
    [state.receipts[0], state.receipts[1]] = [state.receipts[1], state.receipts[0]];
    state.receipts[0].rolledBackAt = new Date('2026-11-26T01:00:00Z');
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), unavailable);
    state.receipts[0].rolledBackAt = null;
    state.receipts[2].finishedAt = null;
    state.receipts[2].hasFailure = true;
    assert.equal((await observation.read()).dataCapabilities[0].execution.state, 'failed');
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), unavailable);
    state.receipts[2].hasFailure = false;
    assert.equal((await observation.read()).dataCapabilities[0].execution.state, 'unknown');
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), unavailable);
    state.missingLedger = true;
    await assert.rejects(catalogue.requireDataCapabilityAvailable('mcp'), /原账不可读/);
    state.missingLedger = false;

    // 旧账名只模拟已有证据，保留实际名称和 checksum，不产生任何收据。
    const legacyNames = plan.migrationNames.map((_name, at) => `historical_mcp_${at + 1}`);
    const legacyPlan = createMcpMysqlDataPlan({ files, release, tableCollation: 'utf8mb4_0900_ai_ci', originalMigrationNames: legacyNames });
    assert.deepEqual(legacyPlan.migrationNames, legacyNames);
    const legacyObservation = createMysqlCoreDeploymentObservation({ database, platform, cores: [], dataCapabilities: [{ capabilityId: 'mcp', ...legacyPlan }] });
    const legacyCatalogue = createCoreDeployedCatalogue({ lock, registrations: [], observations: legacyObservation });
    state.receipts = legacyNames.map((migrationName, at) => ({ migrationName, checksum: plan.data.migrations[at].sha256,
      finishedAt: new Date('2026-11-25T00:00:00Z'), rolledBackAt: null, hasFailure: false }));
    await legacyCatalogue.requireDataCapabilityAvailable('mcp');
    state.receipts = [];
    await assert.rejects(legacyCatalogue.requireDataCapabilityAvailable('mcp'), unavailable);
  } finally {
    structure.mysqlStructureFromMigrations = parse;
    hooks.deregister();
  }
});
