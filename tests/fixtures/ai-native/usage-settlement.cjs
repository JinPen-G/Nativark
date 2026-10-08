'use strict';
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../../..'), req = createRequire(path.join(root, 'apps/api/package.json'));
assert.ok(fs.realpathSync(req.resolve('@prisma/client')).startsWith(fs.realpathSync(path.join(root, 'apps/api/node_modules/@prisma/client')) + path.sep));
if (!process[Symbol.for('ts-node.register.instance')]) require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { PrismaUsageSettlementRepository } = require('../../../apps/api/src/modules/ai-native/usage-settlement.repository');
const { UsageAccountingService } = require('../../../apps/api/src/modules/ai-native/usage-accounting.service');
const { contexts } = require('./contract-consumer.cjs');
const clone = v => structuredClone(v), now = new Date('2026-10-04T00:00:00Z');
const scope = { id: 'scope-test', kind: 'WORKSPACE', tenantId: 'tenant-test', workspaceId: 'space-test' };
const input = () => ({ scope: clone(scope), id: 'usage-target', eventKey: 'event-1', kind: 'settlement', input: 20, output: 30 });
const match = (row, where) => Object.entries(where).every(([k,v]) => v instanceof Date ? row[k]?.getTime() === v.getTime() : row[k] === v);
function setup(status = 'reserved') {
  const record = id => ({ id, tenantId: scope.tenantId, workspaceId: scope.workspaceId, callId: 'call-' + id, idempotencyKey: 'key-' + id,
    status, reservedUnits: 100, actualInput: null, actualOutput: null, unknownReason: status === 'unknown' ? 'lost-response' : null,
    expiresAt: new Date(now.getTime() + 60000), updatedAt: new Date(now), settledAt: null });
  const state = { rows: [record('usage-first'), record('usage-target')], entries: [], scope: clone(scope), calls: [], authCount: 0, commits: 0,
    fail: '', count: 1, hook: null, grant: { authorized: true, authorizationKey: 'budget-manager:1', expiresAt: new Date(now.getTime() + 60000), context: { ...clone(contexts[0]), authorizedAt: now.toISOString() } } };
  const authority = { resolve: async request => { state.authCount++; state.calls.push(['auth', clone(request)]); const grant = clone(state.grant); if (state.hook) await state.hook(state.authCount, grant, request); return grant; } };
  let queue = Promise.resolve();
  const db = { $transaction: async (callback, options) => {
    const prior = queue; let unlock; queue = new Promise(r => { unlock = r; }); await prior;
    const rows = clone(state.rows), entries = clone(state.entries); state.calls.push(['transaction', options]);
    const mark = (name, args) => { state.calls.push([name, args]); if (state.fail === name) throw Error('synthetic private DB failure'); };
    try {
      const result = await callback({ aiScope: { findFirst: async args => { mark('scope', args); return match(state.scope, args.where) ? clone(state.scope) : null; } },
        aiUsageReservation: { findFirst: async args => { mark('read', args); return clone(rows.find(r => match(r, args.where)) ?? null); },
          updateMany: async args => { mark('cas', args); const row = rows.find(r => match(r, args.where)); if (!row || state.count !== 1) return { count: row ? state.count : 0 }; Object.assign(row, args.data); return { count: 1 }; } },
        aiUsageLedgerEntry: { findFirst: async args => { mark('ledger.read', args); return clone(entries.find(r => match(r, args.where)) ?? null); },
          create: async args => { mark('ledger.create', args); if (entries.some(r => r.reservationId === args.data.reservationId && r.eventKey === args.data.eventKey)) throw Error('unique'); entries.push(clone(args.data)); return { id: args.data.id }; } } });
      if (state.fail === 'commit') throw Error('commit failed');
      state.rows = rows; state.entries = entries; state.commits++;
      if (state.fail === 'ack') throw Error('commit acknowledgement lost');
      return result;
    } finally { unlock(); }
  } };
  const adapter = new PrismaUsageSettlementRepository(db, authority, () => new Date(now));
  const service = new UsageAccountingService({ commitUsage: value => adapter.commitUsage(value), get: async () => { throw Error('nontransactional get used'); }, transition: async () => { throw Error('nontransactional update used'); } });
  return { state, db, authority, adapter, service, target: () => state.rows[1] };
}
module.exports = { setup, input, scope, now, clone, PrismaUsageSettlementRepository, UsageAccountingService };
