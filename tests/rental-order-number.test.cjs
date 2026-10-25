const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { allocateRentalOrderNumber } = require('../apps/api/src/modules/rental-core/rental-order-number');
const root = path.resolve(__dirname, '..');

// Offline transaction model: verifies SQL order, scope and allocation decisions;
// not proof of MySQL locking or transaction isolation on a real server.
const records = [{ tenantId: 'tenant-a', workspaceId: 'space-a', orderNo: 'RC20261019000123001' }];
function tx(tenantId = 'tenant-a', workspaceId = 'space-a') {
  const trace = [];
  return { trace, async $queryRaw(query) {
    const sql = query.strings.join('?');
    trace.push(sql);
    if (sql.includes('business_workspaces')) {
      assert.match(sql, /FOR UPDATE/);
      return query.values[0] === workspaceId && query.values[1] === tenantId ? [{ id: workspaceId }] : [];
    }
    assert.match(trace[0], /business_workspaces/);
    assert.match(sql, /ORDER BY `orderNo` DESC LIMIT 1 FOR UPDATE/);
    const [tenant, workspace, min, max, regex] = query.values;
    const rows = records.filter(row => row.tenantId === tenant && row.workspaceId === workspace &&
      row.orderNo >= min && row.orderNo <= max && new RegExp(regex).test(row.orderNo));
    return rows.sort((a, b) => b.orderNo.localeCompare(a.orderNo)).slice(0, 1);
  } };
}
async function main() {
  const now = '2026-10-19T09:00:00.000Z';
  const first = await allocateRentalOrderNumber(tx(), 'tenant-a', 'space-a', now);
  assert.equal(first, 'RC2610190001');
  assert.equal(first.length, 12);
  records.push({ tenantId: 'tenant-a', workspaceId: 'space-a', orderNo: first });
  assert.equal(await allocateRentalOrderNumber(tx(), 'tenant-a', 'space-a', now), 'RC2610190002', 'fresh allocator resumes from persisted rows');
  assert.equal(await allocateRentalOrderNumber(tx('tenant-a', 'space-b'), 'tenant-a', 'space-b', now), first, 'workspace isolation');
  assert.equal(await allocateRentalOrderNumber(tx('tenant-b', 'space-c'), 'tenant-b', 'space-c', now), first, 'tenant isolation');
  assert.equal(await allocateRentalOrderNumber(tx(), 'tenant-a', 'space-a', '2026-10-19T16:00:00.000Z'), 'RC2610200001', 'Shanghai local midnight');
  assert.equal(await allocateRentalOrderNumber(tx(), 'tenant-a', 'space-a', '2026-10-19T16:00:00.000Z', 'UTC'), 'RC2610190002', 'configured business time zone');
  assert.equal(await allocateRentalOrderNumber(tx(), 'tenant-a', 'space-a', '2026-12-31T16:00:00.000Z'), 'RC2701010001', 'year rollover');
  records.push({ tenantId: 'tenant-a', workspaceId: 'space-a', orderNo: 'RC261019abcd' });
  assert.equal(await allocateRentalOrderNumber(tx(), 'tenant-a', 'space-a', now), 'RC2610190002', 'ignore nonnumeric/legacy identifiers');
  // Rolling back an uncommitted allocation leaves no consumed or duplicate row.
  const allocated = await allocateRentalOrderNumber(tx(), 'tenant-a', 'space-a', now);
  assert.equal(await allocateRentalOrderNumber(tx(), 'tenant-a', 'space-a', now), allocated);
  records.push({ tenantId: 'tenant-a', workspaceId: 'space-a', orderNo: 'RC2610199999' });
  await assert.rejects(() => allocateRentalOrderNumber(tx(), 'tenant-a', 'space-a', now), /当日订单编号已达上限/);
  await assert.rejects(() => allocateRentalOrderNumber(tx(), 'wrong-tenant', 'space-a', now), /经营空间不存在/);
  await assert.rejects(() => allocateRentalOrderNumber(tx(), 'tenant-a', 'space-a', now, 'invalid-zone'), RangeError);
  assert.equal(records[0].orderNo, 'RC20261019000123001', 'legacy records unchanged');
  // Model an exclusive parent lock held until commit, not just until MAX read.
  // Several callers start together, but each sees the prior committed number.
  let tail = Promise.resolve();
  async function createInModel() {
    let release;
    const done = new Promise(resolve => { release = resolve; });
    const previous = tail;
    tail = done;
    const client = tx('tenant-a', 'concurrent-space');
    const query = client.$queryRaw.bind(client);
    client.$queryRaw = async sql => {
      if (sql.strings.join('').includes('business_workspaces')) await previous;
      return query(sql);
    };
    try {
      const number = await allocateRentalOrderNumber(client, 'tenant-a', 'concurrent-space', now);
      records.push({ tenantId: 'tenant-a', workspaceId: 'concurrent-space', orderNo: number });
      return number;
    } finally { release(); }
  }
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => createInModel()));
  assert.equal(new Set(concurrent).size, 8);
  assert.deepEqual(concurrent, Array.from({ length: 8 }, (_, i) => `RC261019${String(i + 1).padStart(4, '0')}`));
  const confirmation = fs.readFileSync(path.join(root, 'apps/api/src/modules/rental-core/rental-order-confirmation.service.ts'), 'utf8');
  const allocate = confirmation.indexOf('order.orderNo = await this.coreFacts.allocateOrderNumber');
  assert.ok(allocate > confirmation.indexOf('await this.prisma.$transaction'));
  assert.ok(allocate < confirmation.indexOf('await this.hooks?.evaluate'));
  assert.ok(allocate < confirmation.indexOf('await this.coreFacts.saveOrderAggregate'));
  assert.ok(confirmation.indexOf('const early = await this.idempotency.find') < allocate, 'replay returns before number allocation');
  console.log('order number offline allocation/scope/date/limit and creation-boundary checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
