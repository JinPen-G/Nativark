"use strict";
/** Concrete SQL adapter and original OAuth services, with an explicit in-process
 * SQL transaction substitute. No database, listener, env file or shared rebuild. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js"));
const installed = createRequire(path.join(root, "clients/agent-desktop/harness/packages/mcp/mcp-client/package.json"));
const signal = () => new AbortController().signal;
let artifact;
async function compiled() {
  if (artifact) return artifact;
  const output = fs.mkdtempSync(path.join(root, "output/mcp-mysql-store-verification-"));
  const staged = path.join(output, "node_modules/@rental-os/mcp-server"), source = path.join(root, "packages/mcp-server");
  fs.mkdirSync(staged, { recursive: true });
  fs.copyFileSync(path.join(source, "package.json"), path.join(staged, "package.json"));
  const typeRoots = [path.join(root, "clients/agent-desktop/harness/node_modules/@types")];
  const options = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ["node"], typeRoots, rootDir: path.join(source, "src"), outDir: path.join(staged, "dist"),
    paths: { "@modelcontextprotocol/server": [path.join(path.dirname(installed.resolve("@modelcontextprotocol/server")), "index.d.mts")] } };
  const check = program => {
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
    const result = program.emit(); assert.equal(result.emitSkipped, false); assert.equal(result.diagnostics.length, 0);
  };
  // Compile the OAuth/read-budget persistence adapters and actual dependency
  // closure, not unrelated business readers or shared; never overwrite common dist.
  check(ts.createProgram([path.join(source, "src/original-traffic-meter.ts"), path.join(source, "src/prisma-oauth-store.ts"), path.join(source, "src/prisma-mcp-read-budget.ts"), path.join(source, "src/prisma-mcp-read-accounting.ts"), path.join(source, "src/prisma-mcp-read-bindings.ts"), path.join(source, "src/prisma-mcp-catalog-goals.ts"), path.join(source, "src/prisma-mcp-read-goal-settlement.ts"), path.join(source, "src/capability-mapping.ts")], options));
  const consumer = path.join(output, "consumer.mts");
  fs.writeFileSync(consumer, [
    'export { createOriginalMcpTrafficMeter, originalMcpTrafficClass } from "@rental-os/mcp-server/original-traffic-meter";',
    'export { createPrismaOAuthStore } from "@rental-os/mcp-server/prisma-oauth-store";',
    'export { createPrismaMcpReadBudget } from "@rental-os/mcp-server/prisma-mcp-read-budget";',
    'export { createPersistentMcpReadAccounting, OriginalMcpReadBudgetError, captureMcpReadInput } from "@rental-os/mcp-server/persistent-read-accounting";',
    'export { createPrismaMcpReadAccounting } from "@rental-os/mcp-server/prisma-mcp-read-accounting";',
    'import { createPrismaMcpReadAccounting } from "@rental-os/mcp-server/prisma-mcp-read-accounting";',
    'export { createPrismaMcpReadBindings } from "@rental-os/mcp-server/prisma-mcp-read-bindings";',
    'export { createPrismaMcpCatalogGoals, captureOriginalMcpCatalogGoal, ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION } from "@rental-os/mcp-server/prisma-mcp-catalog-goals";',
    'export { createPrismaMcpReadGoalSettlement } from "@rental-os/mcp-server/prisma-mcp-read-goal-settlement";',
    'export { MCP_BUSINESS_CAPABILITIES } from "@rental-os/mcp-server/capability-mapping";',
    'import { createPrismaMcpReadBindings } from "@rental-os/mcp-server/prisma-mcp-read-bindings";',
    'import type { OriginalMcpReadBindingAuthority, OriginalMcpReadGoalOwner } from "@rental-os/mcp-server/prisma-mcp-read-bindings";',
    'interface ScopedOwner extends OriginalMcpReadGoalOwner { dataScope: "organization"; }',
    'export const bindNativeAssociations = (authority: OriginalMcpReadBindingAuthority<OriginalNative, ScopedOwner>, subjects: { current(call: import("@rental-os/mcp-server/persistent-read-accounting").OriginalMcpReadCallRef): ScopedOwner }): ReturnType<typeof createPrismaMcpReadBindings<OriginalNative, ScopedOwner>> => createPrismaMcpReadBindings(authority, subjects);',
    'import type { OriginalMcpReadInputTargetSource } from "@rental-os/mcp-server/prisma-mcp-read-accounting";',
    'export function bindNativeInputAccounting(db: OAuthSqlDatabase<OriginalNative>, target: OriginalMcpReadInputTargetSource<OriginalNative>): ReturnType<typeof createPrismaMcpReadAccounting> { return createPrismaMcpReadAccounting(db, target); }',
    'import type { OriginalMcpReadTargetSource } from "@rental-os/mcp-server/prisma-mcp-read-budget";',
    'export function bindNativeBudget(db: OAuthSqlDatabase<OriginalNative>, target: OriginalMcpReadTargetSource<OriginalNative>) { return createPrismaMcpReadBudget(db, target); }',
    'import { createPrismaMcpReadBudget } from "@rental-os/mcp-server/prisma-mcp-read-budget";',
    'export { createPersistentOAuthAuthorization } from "@rental-os/mcp-server/persistent-oauth-authorization";',
    'export { createPersistentOAuthTokenService, createPersistentOAuthResourceVerifier, oauthCredentialDigest } from "@rental-os/mcp-server/persistent-oauth-tokens";',
    'import type { OAuthSqlDatabase, OAuthSqlTransaction, OriginalOAuthCodeAudit, PrismaOAuthStore } from "@rental-os/mcp-server/prisma-oauth-store";',
    'export function useNative(store: PrismaOAuthStore, audit: OriginalOAuthCodeAudit, database: OAuthSqlDatabase): void { void store; void audit; void database; }',
    'export const nativeQuery = (tx: OAuthSqlTransaction) => tx.$queryRaw<unknown[]>`SELECT 1`;',
    'interface OriginalNative extends OAuthSqlTransaction { originalMarker: "native"; }',
    'export const borrowNative = (store: PrismaOAuthStore<OriginalNative>, native: OriginalNative, signal: AbortSignal) => store.withNative(native, async tx => {',
    ' const marker: "native" = store.native(tx).originalMarker; void marker; return tx.readFamily("original-family"); }, signal);',
  ].join("\n"));
  check(ts.createProgram([consumer], { ...options, rootDir: output, outDir: path.join(output, "consumer-build") }));
  artifact = await import(pathToFileURL(path.join(output, "consumer-build/consumer.mjs")).href);
  fs.writeFileSync(path.join(output, "scope.json"), JSON.stringify({ strict: "OAuth/read-budget/input-bound accounting actual dependency closure", publicConsumer: "NodeNext manifest exports and emitted ESM", database: "explicit SQL substitute; no real DB", output }, null, 2));
  return artifact;
}

function sqlFixture() {
  // Only a test substitute: this queue is NOT the product's lock or ledger.
  const tables = ["codes", "families", "access", "refresh", "budgets", "readCalls", "readBindings", "catalogGoals", "ownerGrants", "operationLogs", "trafficBuckets"];
  const fixture = { state: Object.fromEntries(tables.map(t => [t, {}])), audits: [], calls: [], transactions: 0,
    loseCommit: false, cancelAfterCommit: undefined, failAudit: false, zeroCas: false, replay: false, tail: Promise.resolve() };
  fixture.database = { async $transaction(callback, options) {
    assert.deepEqual(options, { isolationLevel: "Serializable", maxWait: 2500, timeout: 5000 });
    const prior = fixture.tail; let release; fixture.tail = new Promise(resolve => { release = resolve; });
    await prior; fixture.transactions++;
    const working = structuredClone(fixture.state), audits = [];
    const statement = (parts, values) => {
      assert.ok(Array.isArray(parts.raw));
      const text = parts.join("?").replace(/\s+/g, " ");
      fixture.calls.push({ text, values: structuredClone(values) }); return text;
    };
    const native = {
      async $queryRaw(parts, ...values) {
        const text = statement(parts, values);
        if (text.includes('FROM client_api_rate_buckets')) {
          assert.match(text,/WHERE scopeKey = \? AND bucketStart = \? LIMIT 1 FOR UPDATE$/);
          if (fixture.missingTrafficSchema) throw Error('explicit missing original rate table');
          const row=working.trafficBuckets[values[0]+'|'+values[1].getTime()];
          return fixture.badTrafficRow ? [] : row ? [{ count:row.count }] : [];
        }
        if (text.includes('FROM mcp_read_catalog_goals')) {
          if (fixture.missingGoalSchema || fixture.goalBusy) throw Error('explicit unavailable original goal schema/fence');
          const row = text.includes('WHERE ownerKey') ? working.catalogGoals[values[0]] : Object.values(working.catalogGoals).find(row => row.goalId === values[0]);
          return row ? [structuredClone(row)] : [];
        }
        if (text.includes('FROM mcp_oauth_grants FORCE INDEX')) {
          return Object.values(working.ownerGrants).filter(row => row.userId === values[0] && row.tenantId === values[1] && row.workspaceId === values[2])
            .sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0,51).map(({ id }) => ({ id }));
        }
        if (text.includes('FROM mcp_read_')) {
          if (text.includes('FROM mcp_read_calls FORCE INDEX')) {
            assert.match(text, /FORCE INDEX \(mcp_read_calls_goal\) WHERE goalId = \? ORDER BY callId LIMIT 21 FOR UPDATE NOWAIT$/);
            if (fixture.settlementBusy) throw Error('explicit original call-set busy');
            const rows=Object.values(working.readCalls).filter(row=>row.goalId===values[0]).sort((a,b)=>a.callId<b.callId?-1:a.callId>b.callId?1:0).slice(0,21).map(row=>structuredClone(row));
            return fixture.settlementHook ? fixture.settlementHook(rows) : rows;
          }
          if (text.includes('FROM mcp_read_target_bindings FORCE INDEX')) {
            const rows = Object.values(working.readBindings).filter(row => row.userId === values[0] && row.tenantId === values[1] && row.workspaceId === values[2]);
            return rows.slice(0,1).map(row => ({ bindingKey: row.bindingKey }));
          }
          if (text.includes('FROM mcp_read_goal_budgets FORCE INDEX')) {
            return Object.values(working.budgets).filter(row => row.grantId === values[0]).slice(0,1).map(row => ({ goalId: row.goalId }));
          }
          if (text.includes('FROM mcp_read_target_bindings')) {
            assert.match(text, /WHERE bindingKey = \? FOR UPDATE NOWAIT$/);
            if (fixture.bindingBusy) throw Error('synthetic NOWAIT busy');
            return working.readBindings[values[0]] ? [structuredClone(working.readBindings[values[0]])] : [];
          }
          if (text.includes('FROM mcp_read_goal_budgets')) { assert.match(text, / FOR UPDATE(?: NOWAIT)?$/); return working.budgets[values[0]] ? [structuredClone(working.budgets[values[0]])] : []; }
          const row = working.readCalls[values[0]];
          if (text.startsWith('SELECT goalId ')) return row ? [{ goalId: row.goalId }] : [];
          assert.match(text, / FOR UPDATE$/); return row ? [structuredClone(row)] : [];
        }
        assert.match(text, / FOR UPDATE$/);
        const table = /FROM mcp_oauth_(\w+)/.exec(text)[1];
        let row;
        if (text.includes("WHERE authorizationId")) row = Object.values(working.codes).find(row => row.authorizationId === values[0]);
        else row = working[table][values[0]];
        return row ? [structuredClone(row)] : [];
      },
      async $executeRaw(parts, ...values) {
        const text = statement(parts, values);
        if (text.startsWith('INSERT INTO client_api_rate_buckets')) {
          if (fixture.missingTrafficSchema) throw Error('explicit missing original rate table');
          const key=values[1]+'|'+values[2].getTime(),old=working.trafficBuckets[key];
          working.trafficBuckets[key]={ scopeKey:values[1],bucketStart:values[2],count:(old?.count ?? 0)+1 };return old ? 2 : 1;
        }
        if (text.includes('mcp_read_')) {
          if (fixture.zeroCas) return 0;
          if (text.startsWith('INSERT INTO mcp_read_catalog_goals')) {
            assert.ok(!working.catalogGoals[values[0]] && !Object.values(working.catalogGoals).some(row => row.goalId === values[1]));
            working.catalogGoals[values[0]] = Object.fromEntries(['ownerKey','goalId','grantId','grantRevision','userId','tenantId','workspaceId','authorityHash','recordHash','recordJson'].map((key,i) => [key,values[i]])); return 1;
          }
          if (text.startsWith('INSERT INTO mcp_read_target_bindings')) {
            if (working.readBindings[values[0]] || Object.values(working.readBindings).some(r => r.goalId === values[1] && r.grantId === values[2] && r.toolName === values[7] && r.inputHash === values[8])) throw Error('synthetic unique original goal invocation');
            working.readBindings[values[0]] = Object.fromEntries(['bindingKey', 'goalId', 'grantId', 'grantRevision', 'userId', 'tenantId', 'workspaceId', 'toolName', 'inputHash', 'recordHash', 'recordJson'].map((key, i) => [key, values[i]])); return 1;
          }
          if (text.startsWith('INSERT INTO mcp_read_goal_budgets')) {
            if (working.budgets[values[0]]) throw Error('synthetic unique goal');
            working.budgets[values[0]] = { goalId: values[0], grantId: values[1], bindingHash: values[2], recordJson: values[3], revision: 1,
              consumedCalls: values[4], consumedActiveMs: values[5], reservedActiveMs: values[6], concurrentReads: values[7] }; return 1;
          }
          if (text.startsWith('INSERT INTO mcp_read_calls')) {
            if (working.readCalls[values[0]] || !working.budgets[values[1]] || working.budgets[values[1]].grantId !== values[2]) throw Error('synthetic unique call / goal-grant FK');
            working.readCalls[values[0]] = { callId: values[0], goalId: values[1], grantId: values[2], callBindingHash: values[3], recordJson: values[4], state: 'reserved', activeMs: null }; return 1;
          }
          if (text.startsWith('UPDATE mcp_read_goal_budgets')) {
            const row = working.budgets[values[5]]; if (!row || row.revision !== values[6] || row.bindingHash !== values[7]) return 0;
            Object.assign(row, { revision: values[0], consumedCalls: values[1], consumedActiveMs: values[2], reservedActiveMs: values[3], concurrentReads: values[4] }); return 1;
          }
          const unknown = text.includes("SET state = 'unknown'"), row = working.readCalls[values[unknown ? 0 : 2]];
          if (!row || row.state !== 'reserved' || row.callBindingHash !== values[unknown ? 1 : 3]) return 0;
          row.state = unknown ? 'unknown' : values[0]; row.activeMs = unknown ? null : values[1]; return 1;
        }
        if (text.startsWith("INSERT")) {
          const table = /INTO mcp_oauth_(\w+)/.exec(text)[1], key = values[0];
          if (working[table][key]) throw new Error("synthetic unique constraint");
          let row;
          if (table === "codes") {
            if (Object.values(working.codes).some(row => row.authorizationId === values[1])) throw new Error("synthetic unique authorization");
            row = { digest: values[0], authorizationId: values[1], recordJson: values[2], consumedFamilyId: null };
          } else if (table === "families") row = { recordJson: values[1], revoked: 0 };
          else {
            assert.ok(working.families[values[1]], "synthetic family FK");
            row = { familyId: values[1], recordJson: values[2], ...(table === "refresh" ? { used: 0 } : {}) };
          }
          working[table][key] = row; return 1;
        }
        if (fixture.zeroCas) return 0;
        if (text.includes("SET consumedFamilyId")) {
          const row = working.codes[values[1]];
          if (!row || row.consumedFamilyId !== null) return 0;
          assert.ok(working.families[values[0]], "synthetic family FK");
          assert.ok(!Object.values(working.codes).some(row => row.consumedFamilyId === values[0]));
          row.consumedFamilyId = values[0]; return 1;
        }
        const table = text.includes("SET used") ? "refresh" : "families", field = table === "refresh" ? "used" : "revoked";
        const row = working[table][values[0]]; if (!row || row[field] !== 0) return 0;
        row[field] = 1; return 1;
      },
    };
    native.operationLog = {
      async findUnique({ where }) { return structuredClone(working.operationLogs[where.id] ?? null); },
      async create({ data }) { if (fixture.failGoalAudit) throw Error('explicit original goal audit failure'); assert.ok(!working.operationLogs[data.id]);
        working.operationLogs[data.id] = structuredClone(data); return structuredClone(data); }
    };
    fixture.native = native; fixture.pendingAudits = audits;
    try {
      const result = await callback(native);
      if (fixture.replay) await callback(native);
      fixture.state = working; fixture.audits.push(...audits);
      fixture.cancelAfterCommit?.abort();
      if (fixture.loseCommit || fixture.loseCommitOnce) { fixture.loseCommitOnce = false; throw new Error("synthetic unknown commit"); }
      return result;
    } finally { release(); }
  } };
  fixture.audit = { async record(native, record) {
    assert.equal(native, fixture.native);
    if (fixture.failAudit) throw new Error("synthetic audit unavailable");
    fixture.pendingAudits.push(structuredClone(record));
  } };
  return fixture;
}
test('original goal settlement evidence validates every original call and never closes resets or repairs',async()=>{
  const api=await compiled(),{ fixture:originalFixture,source }=require('./fixtures/mcp/original-identity.cjs');
  const make=()=>{
    const f=sqlFixture(),original=originalFixture(),context=source('apps/api/src/modules/auth/original-mcp-read-context.ts').createOriginalMcpCatalogReadContext();
    f.state.ownerGrants['grant-a']={ id:'grant-a',userId:'user-a',tenantId:'tenant-a',workspaceId:'workspace-a' };
    const logs=new (source('apps/api/src/common/operation-log.service.ts').OperationLogService)({ operationLog:{ create(){ throw Error('global audit forbidden'); } } });
    const goal=source('apps/api/src/modules/auth/original-mcp-catalog-goals.ts').createOriginalMcpCatalogGoals(api,{ enabled:true },context,logs);
    const input={ limit:2 },auth={ subject:'issuer-subject',token:'private-fixture-token',clientId:'client-a',resource:'https://mcp.example.invalid/mcp',scopes:['catalog:read'] };
    const name=api.MCP_BUSINESS_CAPABILITIES.find(row=>row.code==='rental.catalog.search').name,call={ callId:'goal-evidence-probe',authorization:auth,toolName:name,inputHash:api.captureMcpReadInput(input).inputHash };
    const frame=(native,work,stop=signal())=>original.auth.withTrustedWorkspacePrincipal(native,async actual=>{ assert.equal(actual,native);return structuredClone(original.binding); },stop,
      resolve=>original.guard.withTrustedCatalogRead(2,resolve,identity=>context.bind(auth,name,call.inputHash)({ grantId:'grant-a',grantRevision:1 },identity,stop,work,native),stop));
    const native=(work,stop=signal())=>f.database.$transaction(tx=>{ Object.assign(tx,original.tx);return frame(tx,()=>work(tx,stop),stop); },{ isolationLevel:'Serializable',maxWait:2500,timeout:5000 });
    const prepare=()=>native((tx,stop)=>goal.preparation.prepareIn(tx,auth,name,input,stop));
    const read=(consume=async()=> 'actual-callback',stop=signal())=>frame(original.tx,()=>api.createPrismaMcpReadAccounting(f.database,goal.source).withCall(auth,name,input,consume,stop),stop);
    const observe=(stop=signal())=>native((tx,s)=>goal.settlement.readIn(call,input,tx,s),stop);
    return { f,original,context,goal,input,call,auth,prepare,read,observe,native };
  };
  const h=make();await h.prepare();const initial=structuredClone(h.f.state),notObserved=await h.observe();assert.equal(notObserved.state,'not_observed');assert.equal(notObserved.consumedCalls,null);assert.equal(notObserved.retryable,false);assert.deepEqual(h.f.state,initial);
  await h.read();const before=structuredClone(h.f.state),observed=await h.observe();assert.equal(observed.state,'settled');assert.equal(observed.consumedCalls,1);assert.equal(observed.concurrentReads,0);assert.equal(observed.reservedActiveMs,0);assert.match(observed.ledgerHash,/^[a-f0-9]{64}$/);
  assert.equal(observed.observation,'native_call_rows_not_commit_or_goal_completion_evidence');assert.deepEqual(h.f.state,before,'read does not close/refund/reset/save audit');
  assert.doesNotMatch(JSON.stringify(observed),/private-fixture-token|issuer-subject|user-a|goal-evidence-probe/);assert.equal(Object.isFrozen(observed),true);
  const key=Object.keys(h.f.state.readCalls)[0];delete h.f.state.readCalls[key];await assert.rejects(h.observe());h.f.state=structuredClone(before);
  h.f.state.budgets[observed.goalId].consumedActiveMs++;await assert.rejects(h.observe());h.f.state=structuredClone(before);
  h.f.state.readCalls[key].grantId='other-grant';await assert.rejects(h.observe());h.f.state=structuredClone(before);
  const reservation=JSON.parse(h.f.state.readCalls[key].recordJson);reservation.consumedCalls=2;h.f.state.readCalls[key].recordJson=JSON.stringify(reservation);await assert.rejects(h.observe());h.f.state=structuredClone(before);
  h.f.settlementBusy=true;await assert.rejects(h.observe());h.f.settlementBusy=false;assert.deepEqual(h.f.state,before);
  let reads=0;h.f.settlementHook=rows=>{ reads++;if(reads===2)rows[0].activeMs++;return rows; };await assert.rejects(h.observe(),'late changed ledger never yields settled evidence');h.f.settlementHook=undefined;assert.deepEqual(h.f.state,before);
  const pending=make();await pending.prepare();const cancel=new AbortController();await assert.rejects(pending.read(async()=>{ cancel.abort();return 'late result'; },cancel.signal));
  const heldBefore=structuredClone(pending.f.state),held=await pending.observe();assert.equal(held.state,'pending');assert.equal(held.concurrentReads,1);assert.ok(held.reservedActiveMs>0);assert.deepEqual(pending.f.state,heldBefore,'unknown holds remain original');
  const failed=make();await failed.prepare();await assert.rejects(failed.read(async()=>{ throw Error('failed original callback'); }));const failedEvidence=await failed.observe();assert.equal(failedEvidence.state,'settled');assert.equal(failedEvidence.consumedCalls,1,'failed read stays consumed but is not a completed business goal');
  const denied=make();await denied.prepare();denied.original.member.isActive=false;const deniedBefore=structuredClone(denied.f.state);await assert.rejects(denied.observe());assert.deepEqual(denied.f.state,deniedBefore);
  const stopped=new AbortController();stopped.abort();const stopBefore=structuredClone(h.f.state);await assert.rejects(h.observe(stopped.signal));assert.deepEqual(h.f.state,stopBefore);
  await assert.rejects(h.goal.settlement.readIn(h.call,h.input,h.original.tx,signal()),'no live owner/Native cannot observe');
});

test('original catalog goal author persists before reads and never resets on credentials queries or reconstruction', async () => {
  const api = await compiled();
  const { fixture: originalFixture, source } = require('./fixtures/mcp/original-identity.cjs');
  const { createOriginalMcpCatalogReadContext } = source('apps/api/src/modules/auth/original-mcp-read-context.ts');
  const { createOriginalMcpCatalogGoals } = source('apps/api/src/modules/auth/original-mcp-catalog-goals.ts');
  const { OperationLogService } = source('apps/api/src/common/operation-log.service.ts');
  const name = api.MCP_BUSINESS_CAPABILITIES.find(row => row.code === 'rental.catalog.search').name;
  const make = () => {
    const f = sqlFixture(), original = originalFixture(), context = createOriginalMcpCatalogReadContext();
    f.state.ownerGrants['grant-a'] = { id: 'grant-a', userId: 'user-a', tenantId: 'tenant-a', workspaceId: 'workspace-a' };
    const logs = new OperationLogService({ operationLog: { create() { throw Error('global audit forbidden'); } } });
    const goal = createOriginalMcpCatalogGoals(api, { enabled: true }, context, logs);
    const auth = { subject: 'issuer-subject', token: 'private-fixture-token', clientId: 'client-a', resource: 'https://mcp.example.invalid/mcp', scopes: ['catalog:read'] };
    const frame = (native, input, credential, run, stop = signal(), grantId = 'grant-a') => original.auth.withTrustedWorkspacePrincipal(native,
      async actual => { assert.equal(actual, native); return structuredClone(original.binding); }, stop,
      resolve => original.guard.withTrustedCatalogRead(input.limit, resolve, identity => context.bind(credential, name, api.captureMcpReadInput(input).inputHash)(
        { grantId, grantRevision: 1 }, identity, stop, run, native), stop));
    const prepare = (input = { limit: 2 }, credential = auth, stop = signal(), grantId = 'grant-a') => f.database.$transaction(native => {
      Object.assign(native, original.tx);
      return frame(native, input, credential, () => goal.preparation.prepareIn(native, credential, name, input, stop), stop, grantId);
    }, { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
    let reads = 0;
    const read = (input = { limit: 2 }, credential = auth, current = goal) => frame(original.tx, input, credential,
      () => api.createPrismaMcpReadAccounting(f.database, current.source).withCall(credential, name, input, async () => { reads++; return 'explicit-reader-fixture'; }, signal()));
    return { f, original, context, logs, goal, auth, prepare, read, reads: () => reads };
  };
  const h = make();
  await assert.rejects(() => h.read()); assert.equal(h.reads(), 0); assert.deepEqual(h.f.state.catalogGoals, {}, 'budget source cannot manufacture an original goal');
  await h.prepare(); const first = Object.values(h.f.state.catalogGoals)[0], target = JSON.parse(first.recordJson).target;
  assert.match(first.goalId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(Object.keys(h.f.state.catalogGoals).length, 1); assert.equal(Object.keys(h.f.state.readBindings).length, 1);
  assert.deepEqual(Object.values(h.f.state.operationLogs).map(row => row.action).sort(), ['mcp.read.goal.admitted','mcp.read.goal.bindings.published']);
  assert.doesNotMatch(JSON.stringify(h.f.state.catalogGoals), /private-fixture-token|\"name\"|permissions|locationIds/);
  await h.prepare(); assert.equal(Object.keys(h.f.state.operationLogs).length, 2, 'same original binding has no second publication audit');
  await h.read(); assert.equal(h.reads(), 1); assert.equal(h.f.state.budgets[first.goalId].consumedCalls, 1);
  const other = { limit: 2, name: 'Camera' }; await h.prepare(other); await h.read(other);
  assert.equal(Object.keys(h.f.state.catalogGoals).length, 1); assert.equal(h.f.state.budgets[first.goalId].consumedCalls, 2);
  assert.equal(JSON.parse(Object.values(h.f.state.catalogGoals)[0].recordJson).target.originalInputHash, target.originalInputHash, 'another query does not rebind/reset the original input/goal');
  const rebuilt = createOriginalMcpCatalogGoals(api, { enabled: true }, h.context, h.logs);
  await h.read({ limit: 2 }, { ...h.auth, token: 'another-short-lived-fixture-token' }, rebuilt);
  assert.equal(h.f.state.budgets[first.goalId].consumedCalls, 3, 'reconstruction/new token keeps original counters');
  await assert.rejects(() => h.prepare({ limit: 2 }, { ...h.auth, clientId: 'client-b' }, signal(), 'grant-b'));
  assert.equal(Object.keys(h.f.state.catalogGoals).length, 1, 'another client/grant cannot start a replacement goal');
  const canonical = structuredClone(h.f.state.catalogGoals); h.f.failGoalAudit = true;
  await assert.rejects(() => h.prepare({ limit: 2, name: 'Lens' })); h.f.failGoalAudit = false;
  assert.deepEqual(h.f.state.catalogGoals, canonical); assert.equal(Object.keys(h.f.state.readBindings).length, 2, 'failed audit rolls association back');
  for (let i = 3; i < 20; i++) { await h.prepare(); await h.read(); }
  const spent = structuredClone(h.f.state);
  await assert.rejects(() => h.prepare({ limit: 2, name: 'new-after-limit' }));
  await assert.rejects(() => h.read()); assert.equal(h.reads(), 20); assert.deepEqual(h.f.state, spent, 'spent goal neither rolls over nor grows association/audit metadata');
  const denied = make(); denied.original.member.role.permissions = [];
  await assert.rejects(() => denied.prepare()); assert.deepEqual(denied.f.state.catalogGoals, {});
  const unknown = make(); unknown.f.loseCommitOnce = true;
  await assert.rejects(() => unknown.prepare()); assert.equal(Object.keys(unknown.f.state.catalogGoals).length, 1, 'unknown preparation keeps its committed original frontier');
  await unknown.prepare(); assert.equal(Object.keys(unknown.f.state.catalogGoals).length, 1); assert.equal(Object.keys(unknown.f.state.operationLogs).length, 2);
  const absent = make(); absent.f.missingGoalSchema = true;
  await assert.rejects(() => absent.prepare()); assert.deepEqual(absent.f.state.catalogGoals, {});
  const legacy = make(); legacy.f.state.ownerGrants['old-grant'] = { ...legacy.f.state.ownerGrants['grant-a'], id: 'old-grant' };
  legacy.f.state.budgets['old-goal'] = { goalId: 'old-goal', grantId: 'old-grant' };
  await assert.rejects(() => legacy.prepare()); assert.deepEqual(legacy.f.state.catalogGoals, {}, 'old grant history is not an empty/new frontier');
  const initialFail = make(); initialFail.f.failGoalAudit = true;
  await assert.rejects(() => initialFail.prepare()); assert.deepEqual(initialFail.f.state.catalogGoals, {}); assert.deepEqual(initialFail.f.state.operationLogs, {});
  const lostAudit = make(); await lostAudit.prepare(); const admittedId = Object.values(lostAudit.f.state.operationLogs).find(row => row.action === 'mcp.read.goal.admitted').id;
  delete lostAudit.f.state.operationLogs[admittedId]; const auditBaseline = structuredClone(lostAudit.f.state);
  await assert.rejects(() => lostAudit.read()); assert.equal(lostAudit.reads(), 0); assert.deepEqual(lostAudit.f.state, auditBaseline, 'missing original audit never becomes an empty successful repair');
  const lostPublication = make(); await lostPublication.prepare(); const publicationId = Object.values(lostPublication.f.state.operationLogs).find(row => row.action === 'mcp.read.goal.bindings.published').id;
  delete lostPublication.f.state.operationLogs[publicationId]; const publicationBaseline = structuredClone(lostPublication.f.state);
  await assert.rejects(() => lostPublication.read()); assert.equal(lostPublication.reads(), 0); assert.deepEqual(lostPublication.f.state, publicationBaseline);
  const abort = new AbortController(); abort.abort(); const cancelled = make();
  await assert.rejects(() => cancelled.prepare({ limit: 2 }, cancelled.auth, abort.signal)); assert.deepEqual(cancelled.f.state.catalogGoals, {});
});

const resource = "https://mcp.example.invalid/mcp";
function values(api) {
  const verifier = "v".repeat(43), challenge = createHash("sha256").update(verifier).digest("base64url"), expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const request = { clientId: "client", clientRevision: 1, resource, redirectUri: "http://127.0.0.1:49152/callback", scopes: ["catalog:read"], state: "state", codeChallenge: challenge };
  const grant = { id: "original-grant", subject: "original-user", revision: 1, clientId: "client", resource, scopes: ["catalog:read"], expiresAt };
  const code = { digest: api.oauthCredentialDigest("original-code"), authorizationId: "original-consent", authorizationRevision: 1,
    grantId: grant.id, subject: grant.subject, grantRevision: 1, clientId: "client", resource, scopes: grant.scopes,
    redirectUri: request.redirectUri, codeChallengeMethod: "S256", codeChallenge: challenge, expiresAt, consumedFamilyId: null };
  return { verifier, request, grant, code, config: { enabled: true, resourceUrl: resource, allowedScopes: grant.scopes, accessTtlSeconds: 900, refreshTtlSeconds: 3600 } };
}

test("Prisma OAuth SQL store compiles through public exports and enforces transaction ownership, CAS and audit", async t => {
  const api = await compiled(), v = values(api);
  await t.test("same original transaction, unique authorization, escaped capability and exact parameter binding", async () => {
    const f = sqlFixture(), store = api.createPrismaOAuthStore(f.database, f.audit); let escaped;
    await store.transaction(async tx => {
      escaped = tx; assert.equal(store.native(tx), f.native);
      await tx.insertCode(v.code);
      assert.deepEqual(await tx.readCodeForAuthorization(v.code.authorizationId), v.code);
      assert.deepEqual(await tx.readCode(v.code.digest), v.code);
      assert.throws(() => api.createPrismaOAuthStore(f.database, f.audit).native(tx));
    }, signal());
    assert.throws(() => store.native(escaped)); await assert.rejects(() => escaped.readCode(v.code.digest));
    let borrowed; const beforeBorrow = f.transactions, options = { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 };
    await f.database.$transaction(native => store.withNative(native, async tx => {
      borrowed = tx; assert.equal(store.native(tx), native); assert.deepEqual(await tx.readCode(v.code.digest), v.code);
      assert.throws(() => api.createPrismaOAuthStore(f.database, f.audit).native(tx));
    }, signal()), options);
    assert.equal(f.transactions, beforeBorrow + 1); assert.throws(() => store.native(borrowed)); await assert.rejects(() => borrowed.readCode(v.code.digest));
    await assert.rejects(() => f.database.$transaction(async native => {
      await store.withNative(native, tx => tx.insertCode({ ...v.code, digest: 'b'.repeat(64), authorizationId: 'borrowed-rollback' }), signal());
      throw new Error('original outer transaction failed after borrowed callback returned');
    }, options));
    assert.equal(Object.keys(f.state.codes).length, 1); assert.equal(f.audits.length, 1, 'borrowed return is not a commit receipt; original audit rolls back with outer owner');
    const cancelled = new AbortController(); cancelled.abort(); let consumed = 0;
    await assert.rejects(() => store.withNative(f.native, async () => { consumed++; }, cancelled.signal)); assert.equal(consumed, 0);
    await assert.rejects(() => store.transaction(tx => tx.insertCode({ ...v.code, digest: "a".repeat(64) }), signal()));
    assert.equal(Object.keys(f.state.codes).length, 1); assert.equal(f.audits.length, 1);
    assert.deepEqual(f.audits[0], { authorizationId: v.code.authorizationId, authorizationRevision: 1, grantId: v.grant.id });
    assert.ok(f.calls.every(call => !call.text.includes(v.code.digest)), "credential digests are parameters, never SQL text");
    assert.throws(() => api.createPrismaOAuthStore(f.database));
  });
  await t.test("audit failure and failed CAS roll back; cancellation and unknown commit do not retry", async () => {
    const f = sqlFixture(), store = api.createPrismaOAuthStore(f.database, f.audit);
    f.failAudit = true; await assert.rejects(() => store.transaction(tx => tx.insertCode(v.code), signal()));
    assert.deepEqual(f.state.codes, {}); assert.equal(f.audits.length, 0); f.failAudit = false;
    f.loseCommit = true; await assert.rejects(() => store.transaction(tx => tx.insertCode(v.code), signal()));
    assert.equal(Object.keys(f.state.codes).length, 1); assert.equal(f.transactions, 2); f.loseCommit = false;
    f.zeroCas = true; await assert.rejects(() => store.transaction(tx => tx.consumeRefresh("b".repeat(64)), signal()));
    const controller = new AbortController(); controller.abort(); const before = f.transactions;
    await assert.rejects(() => store.transaction(async () => {}, controller.signal)); assert.equal(f.transactions, before);
    f.zeroCas = false; const after = new AbortController(); f.cancelAfterCommit = after;
    await assert.rejects(() => store.transaction(tx => tx.insertCode({ ...v.code, digest: "c".repeat(64), authorizationId: "other-original-consent" }), after.signal));
    assert.ok(f.state.codes["c".repeat(64)], "cancelled delivery can follow durable commit");
    f.cancelAfterCommit = undefined; f.replay = true; let calls = 0;
    await assert.rejects(() => store.transaction(async () => { calls++; }, signal())); assert.equal(calls, 1);
  });
  await t.test("corrupt row bindings, flag and input accessor are rejected", async () => {
    const f = sqlFixture(), store = api.createPrismaOAuthStore(f.database, f.audit);
    await store.transaction(tx => tx.insertCode(v.code), signal());
    f.state.codes[v.code.digest].recordJson = JSON.stringify({ ...JSON.parse(f.state.codes[v.code.digest].recordJson), digest: "d".repeat(64) });
    await assert.rejects(() => store.transaction(tx => tx.readCode(v.code.digest), signal()));
    f.state.codes[v.code.digest].recordJson = JSON.stringify({ ...JSON.parse(f.state.codes[v.code.digest].recordJson), digest: v.code.digest, authorizationId: "wrong-original-consent" });
    await assert.rejects(() => store.transaction(tx => tx.readCode(v.code.digest), signal()));
    let getters = 0; const bad = { ...v.code }; Object.defineProperty(bad, "digest", { enumerable: true, get() { getters++; return v.code.digest; } });
    await assert.rejects(() => store.transaction(tx => tx.insertCode(bad), signal())); assert.equal(getters, 0);
    f.state.families.family = { recordJson: JSON.stringify({ id: "family", grantId: v.grant.id, subject: v.grant.subject, clientId: "client", resource, scopes: v.grant.scopes, grantRevision: 1, expiresAt: v.grant.expiresAt }), revoked: 2 };
    await assert.rejects(() => store.transaction(tx => tx.readFamily("family"), signal()));
  });
});

test("original code issuance and token rotation consume the concrete SQL store without resetting families", async () => {
  const api = await compiled(), f = sqlFixture(), v = values(api);
  const store = api.createPrismaOAuthStore(f.database, f.audit), secondStore = api.createPrismaOAuthStore(f.database, f.audit);
  const current = async (grantId, clientId, revision, tx) => { assert.equal(store.native(tx), f.native); return structuredClone(v.grant); };
  const authorizer = api.createPersistentOAuthAuthorization({ ...v.config, codeTtlSeconds: 600 }, store, {
    current: async (input, browser, tx) => { assert.equal(store.native(tx), f.native); return { kind: "approved", id: v.code.authorizationId, revision: 1,
      expiresAt: v.grant.expiresAt, request: input, grant: structuredClone(v.grant) }; },
  });
  const browser = new Request("https://auth.example.invalid/authorize");
  const outcome = await authorizer.authorize(v.request, browser, signal()); assert.equal(outcome.kind, "code");
  await assert.rejects(() => authorizer.authorize(v.request, browser, signal()));
  const service = api.createPersistentOAuthTokenService(v.config, store, { current, revocationOwner: async (grantId, clientId) => grantId === v.grant.id && clientId === "client" });
  const other = api.createPersistentOAuthTokenService(v.config, secondStore, { current: async () => structuredClone(v.grant), revocationOwner: async () => true });
  const input = { clientId: "client", clientRevision: 1, resource, redirectUri: v.request.redirectUri, code: outcome.code, codeVerifier: v.verifier };
  const token = await service.exchangeCode(input, signal());
  assert.equal(Object.keys(f.state.families).length, 1);
  const verifier = api.createPersistentOAuthResourceVerifier(v.config, store, { current: async (grantId, tx) => { assert.equal(store.native(tx), f.native); return structuredClone(v.grant); } });
  assert.equal((await verifier.verifyAccessToken(token.access_token)).subject, v.grant.subject);
  const rotated = await other.refresh({ clientId: "client", clientRevision: 1, resource, refreshToken: token.refresh_token }, signal());
  assert.notEqual(rotated.refresh_token, token.refresh_token);
  await assert.rejects(() => service.refresh({ clientId: "client", clientRevision: 1, resource, refreshToken: token.refresh_token }, signal()), error => error.code === "invalid_grant");
  assert.ok(Object.values(f.state.families).every(row => row.revoked === 1));
  await assert.rejects(() => verifier.verifyAccessToken(token.access_token)); await assert.rejects(() => verifier.verifyAccessToken(rotated.access_token));
  await service.revoke({ clientId: "client", clientRevision: 1, token: rotated.refresh_token }, signal());
  const persisted = JSON.stringify({ state: f.state, audits: f.audits });
  for (const credential of [outcome.code, token.access_token, token.refresh_token, rotated.access_token, rotated.refresh_token]) assert.ok(!persisted.includes(credential));
  for (const call of f.calls.filter(call => call.text.startsWith("SELECT"))) assert.match(call.text, / FOR UPDATE$/);
  const ddl = fs.readFileSync(path.join(root, "packages/mcp-server/mysql-oauth-schema.sql"), "utf8");
  assert.match(ddl, /UNIQUE KEY mcp_oauth_code_authorization \(authorizationId\)/); assert.match(ddl, /UNIQUE KEY mcp_oauth_code_family \(consumedFamilyId\)/);
  // Count the original token-store tables, not later independent AS projections.
  const tokenDdl = ddl.split("-- Current public-client AS projection")[0];
  assert.equal((tokenDdl.match(/ENGINE=InnoDB/g) || []).length, 4); assert.equal((tokenDdl.match(/ON DELETE RESTRICT/g) || []).length, 3);
});

test("two SQL-store instances preserve original code and refresh reuse containment in the explicit transaction substitute", async () => {
  const api = await compiled();
  for (const kind of ["code", "refresh"]) {
    const f = sqlFixture(), v = values(api), stores = [api.createPrismaOAuthStore(f.database, f.audit), api.createPrismaOAuthStore(f.database, f.audit)];
    const services = stores.map(store => api.createPersistentOAuthTokenService(v.config, store, {
      current: async (grantId, clientId, revision, tx) => { assert.equal(store.native(tx), f.native); return structuredClone(v.grant); },
      revocationOwner: async (grantId, clientId, tx) => { assert.equal(store.native(tx), f.native); return grantId === v.grant.id && clientId === "client"; },
    }));
    await stores[0].transaction(tx => tx.insertCode(v.code), signal());
    const input = { clientId: "client", clientRevision: 1, resource, redirectUri: v.request.redirectUri, code: "original-code", codeVerifier: v.verifier };
    const before = kind === "refresh" ? await services[0].exchangeCode(input, signal()) : undefined;
    const outcomes = await Promise.allSettled(services.map(service => kind === "code" ? service.exchangeCode(input, signal())
      : service.refresh({ clientId: "client", clientRevision: 1, resource, refreshToken: before.refresh_token }, signal())));
    assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
    const rejected = outcomes.find(result => result.status === "rejected"); assert.equal(rejected.reason.code, "invalid_grant");
    assert.equal(Object.keys(f.state.families).length, 1); assert.ok(Object.values(f.state.families).every(row => row.revoked === 1));
    const verifier = api.createPersistentOAuthResourceVerifier(v.config, stores[0], { current: async () => structuredClone(v.grant) });
    await assert.rejects(() => verifier.verifyAccessToken(outcomes.find(result => result.status === "fulfilled").value.access_token));
    if (before) await assert.rejects(() => verifier.verifyAccessToken(before.access_token));
  }
});

test("MCP read accounting supplies frozen original input to its native target source", async () => {
  const api = await compiled(), f = sqlFixture();
  const authorization = { subject: 'original-user', clientId: 'client', resource, scopes: ['catalog:read'], token: 'private-test-token' };
  const original = { query: { keyword: 'private-input-fixture', limit: 1 }, filters: ['enabled'] };
  const expected = api.captureMcpReadInput(original);
  assert.equal(expected.inputHash, createHash('sha256').update(JSON.stringify({ filters: ['enabled'], query: { keyword: 'private-input-fixture', limit: 1 } })).digest('hex'));
  const target = { goalId: 'trusted-input-goal', goalRevision: 1, grantId: 'original-grant', subject: authorization.subject,
    clientId: authorization.clientId, resource, scopes: authorization.scopes, purpose: 'catalog', originalInputHash: 'b'.repeat(64), policyVersion: 'policy-1' };
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const inputs = []; let first = true, reads = 0;
  const resolver = { async resolve(call, input, native) {
    assert.equal(native, f.native);
    if (JSON.stringify(input) !== JSON.stringify(expected.input)) return undefined; // only this explicit test goal is admitted
    assert.ok(Object.isFrozen(input) && Object.isFrozen(input.query) && Object.isFrozen(input.filters));
    assert.equal(call.inputHash, expected.inputHash); inputs.push(input);
    if (first) { first = false; started.resolve(); await release.promise; }
    return structuredClone(target);
  } };
  const originalMethod = resolver.resolve, originalTransaction = f.database.$transaction;
  const accounting = api.createPrismaMcpReadAccounting(f.database, resolver);
  resolver.resolve = async () => { throw Error('redirected source'); };
  f.database.$transaction = async () => { throw Error('redirected database'); };
  const reading = accounting.withCall(authorization, 'rental_catalog_search', original, async () => { reads++; return 'ok'; }, signal());
  await started.promise; original.query.keyword = 'caller-mutated-later'; original.filters.push('changed'); release.resolve();
  assert.equal(await reading, 'ok'); assert.equal(reads, 1); assert.equal(inputs.length, 2);
  assert.notEqual(inputs[0], original); assert.deepEqual(inputs[0], expected.input); assert.equal(inputs[1], inputs[0]);
  assert.equal(original.query.keyword, 'caller-mutated-later', 'capture never freezes or rewrites the caller object');
  f.database.$transaction = originalTransaction; resolver.resolve = originalMethod;
  const rebuilt = api.createPrismaMcpReadAccounting(f.database, resolver);
  assert.equal(await rebuilt.withCall({ ...authorization, token: 'rotated-test-token' }, 'rental_catalog_search',
    { filters: ['enabled'], query: { limit: 1, keyword: 'private-input-fixture' } }, async () => { reads++; return 'ok'; }, signal()), 'ok');
  assert.equal(f.state.budgets[target.goalId].consumedCalls, 2); assert.equal(f.state.budgets[target.goalId].concurrentReads, 0);
  assert.equal(Object.keys(f.state.budgets).length, 1, 'per-call composition and refresh do not create replacement goal counters');
  const before = f.transactions; let getters = 0;
  const unsafe = {}; Object.defineProperty(unsafe, 'query', { enumerable: true, get() { getters++; return {}; } });
  await assert.rejects(() => rebuilt.withCall(authorization, 'rental_catalog_search', unsafe, async () => { reads++; }, signal()));
  assert.equal(getters, 0); assert.equal(f.transactions, before);
  await assert.rejects(() => rebuilt.withCall(authorization, 'rental_catalog_search', { goalId: target.goalId, human: true }, async () => { reads++; }, signal()));
  assert.equal(reads, 2); assert.equal(f.state.budgets[target.goalId].consumedCalls, 2);
  const stored = JSON.stringify({ state: f.state, statements: f.calls });
  for (const text of ['private-input-fixture', 'caller-mutated-later', 'private-test-token', 'rotated-test-token']) assert.ok(!stored.includes(text), 'no input body or credential enters metering SQL');
  assert.throws(() => api.createPrismaMcpReadAccounting(f.database));
});

test("MCP original goal/read bindings publish atomically and resolve only current trusted associations", async () => {
  const api = await compiled(), options = { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 };
  const authorization = { subject: 'opaque-subject', clientId: 'client', resource, scopes: ['catalog:read'], token: 'private-binding-token' };
  const input = { query: 'private-binding-input', limit: 1 }, captured = api.captureMcpReadInput(input);
  const toolName = 'rental_catalog_search', binding = { toolName, inputHash: captured.inputHash };
  const target = { goalId: 'original-binding-goal', goalRevision: 1, grantId: 'original-grant', subject: authorization.subject,
    clientId: authorization.clientId, resource, scopes: authorization.scopes, purpose: 'catalog', originalInputHash: 'b'.repeat(64), policyVersion: 'policy-1' };
  const owner = { userId: 'user-a', tenantId: 'tenant-a', workspaceId: 'space-a', grantId: target.grantId, grantRevision: 1 };
  const call = { callId: 'binding-read-1', authorization, ...binding }, sig = signal();
  function setup() {
    const f = sqlFixture(), state = { publication: { target, owner, bindings: [binding] }, located: target.goalId,
      owner: { ...owner, dataScope: 'organization' }, current: true, afterCurrent: undefined, active: true, currents: 0 };
    const subjects = { current(c) { if (!state.active) throw Error('fixture callback ended'); assert.equal(c.toolName, toolName); return state.owner; } };
    const authority = {
      async readExisting(goalId, native) { assert.equal(native, f.native); assert.ok([target.goalId, 'second-original-goal'].includes(goalId)); return state.publication; },
      async locate(c, subject, native) { assert.equal(native, f.native); assert.equal(subject.dataScope, 'organization'); return state.located; },
      async current(t, b, subject, native) {
        assert.equal(native, f.native); assert.deepEqual(b, binding); assert.equal(subject.dataScope, 'organization'); state.currents++;
        state.afterCurrent?.(); if (state.current instanceof Error) throw state.current; return state.current;
      },
      async auditPublished(goalId, keys, native) {
        assert.equal(native, f.native); assert.ok(Object.isFrozen(keys)); f.pendingAudits.push({ goalId, keys: [...keys] });
        if (f.failAudit) throw Error('fixture audit failed after insertion');
      },
    };
    const store = api.createPrismaMcpReadBindings(authority, subjects);
    return { f, state, store, authority, subjects, publish: () => f.database.$transaction(tx => store.publishIn(state.publication.target.goalId, tx, sig), options),
      resolve: (c = call, i = input) => f.database.$transaction(tx => store.source.resolve(c, i, tx, sig), options) };
  }
  const p = setup(); await p.publish(); assert.equal(Object.keys(p.f.state.readBindings).length, 1); assert.equal(p.f.audits.length, 1);
  assert.deepEqual(p.f.state.budgets, {}, 'publishing does not establish a goal or reserve calls');
  await p.publish(); assert.equal(p.f.audits.length, 1, 'identical republication adds no audit');
  assert.deepEqual(await p.resolve(), target);
  const accounting = api.createPrismaMcpReadAccounting(p.f.database, p.store.source);
  let readers = 0;
  for (const token of [authorization.token, 'private-rotated-binding-token']) {
    assert.equal(await accounting.withCall({ ...authorization, token }, toolName, input, async () => { readers++; return 'ok'; }, sig), 'ok');
  }
  assert.equal(readers, 2); assert.equal(p.f.state.budgets[target.goalId].consumedCalls, 2);
  const persisted = JSON.stringify({ state: p.f.state, calls: p.f.calls }); assert.doesNotMatch(persisted, /private-binding-input|private-binding-token|private-rotated-binding-token|dataScope/);
  assert.ok(p.f.calls.every(c => !/mcp_oauth|AuthSession|User/.test(c.text)), 'never reacquire enclosing grant/identity locks');
  const snapshot = structuredClone(p.f.state.readBindings), auditCount = p.f.audits.length;
  for (const changed of [{ ...target, policyVersion: 'policy-2' }, { ...target, goalRevision: 2 }, { ...target, originalInputHash: 'c'.repeat(64) }]) {
    p.state.publication = { target: changed, owner, bindings: [binding] }; await assert.rejects(p.publish);
    assert.deepEqual(p.f.state.readBindings, snapshot); assert.equal(p.f.audits.length, auditCount);
  }
  p.state.publication = { target, owner, bindings: [binding] };
  p.state.owner = { ...owner, dataScope: 'organization', workspaceId: 'wrong-space' }; assert.equal(await p.resolve(), undefined);
  p.state.owner = { ...owner, dataScope: 'organization', grantRevision: 2 }; assert.equal(await p.resolve(), undefined);
  p.state.owner = { ...owner, dataScope: 'organization' }; p.state.current = false; assert.equal(await p.resolve(), undefined);
  p.state.current = Error('original evidence unreadable'); await assert.rejects(p.resolve);
  p.state.current = true; p.state.afterCurrent = () => { p.state.located = 'redirected-goal'; }; await assert.rejects(p.resolve);
  p.state.afterCurrent = undefined; p.state.located = undefined; assert.equal(await p.resolve(), undefined);
  p.state.located = target.goalId;
  await assert.rejects(() => p.resolve(call, { goalId: target.goalId, human: true }));
  await assert.rejects(() => p.resolve({ ...call, authorization: { ...authorization, subject: 'wrong-subject' } }));
  p.state.active = false; const before = p.f.calls.length; await assert.rejects(p.resolve); assert.equal(p.f.calls.length, before); p.state.active = true;
  const rowKey = Object.keys(p.f.state.readBindings)[0];
  for (const column of ['goalId', 'grantId', 'grantRevision', 'userId', 'tenantId', 'workspaceId', 'toolName', 'inputHash', 'recordHash']) {
    const original = p.f.state.readBindings[rowKey][column]; p.f.state.readBindings[rowKey][column] = typeof original === 'number' ? 2 : 'corrupt';
    await assert.rejects(p.resolve); p.f.state.readBindings[rowKey][column] = original;
  }
  p.f.bindingBusy = true; await assert.rejects(p.resolve); p.f.bindingBusy = false;
  const q = setup(); q.f.failAudit = true; await assert.rejects(q.publish); assert.deepEqual(q.f.state.readBindings, {}); assert.equal(q.f.audits.length, 0);
  q.f.failAudit = false; q.state.publication.bindings = [binding, binding]; await assert.rejects(q.publish); assert.deepEqual(q.f.state.readBindings, {});
  let getters = 0; const unsafe = { ...target }; Object.defineProperty(unsafe, 'goalId', { enumerable: true, get() { getters++; return target.goalId; } });
  q.state.publication = { target: unsafe, owner, bindings: [binding] };
  // Pass the trusted goal argument directly so the test caller doesn't read the unsafe fixture getter.
  await assert.rejects(() => q.f.database.$transaction(tx => q.store.publishIn(target.goalId, tx, sig), options)); assert.equal(getters, 0);
  const cancelled = new AbortController(); cancelled.abort(); const statements = q.f.calls.length;
  await assert.rejects(() => q.store.publishIn(target.goalId, q.f.native, cancelled.signal)); assert.equal(q.f.calls.length, statements);
  const u = setup(); u.f.loseCommitOnce = true; await assert.rejects(u.publish);
  assert.equal(u.f.transactions, 1); assert.equal(Object.keys(u.f.state.readBindings).length, 1); assert.equal(u.f.audits.length, 1);
  assert.deepEqual(await u.resolve(), target, 'lost publication response is not rollback and does not replay');
  // Distinct goals with identical queries need ORIGINAL locator evidence, not a permanent grant/query monopoly.
  const nextTarget = { ...target, goalId: 'second-original-goal' };
  p.state.publication = { target: nextTarget, owner, bindings: [binding] }; await p.publish();
  p.state.located = nextTarget.goalId; assert.deepEqual(await p.resolve(), nextTarget);
  assert.equal(p.f.state.budgets[target.goalId].consumedCalls, 2); assert.equal(Object.keys(p.f.state.readBindings).length, 2);
  const many = setup(); many.state.publication.bindings = Array.from({ length: 21 }, (_, i) => ({ toolName, inputHash: api.captureMcpReadInput({ page: i }).inputHash }));
  await many.publish(); assert.equal(Object.keys(many.f.state.readBindings).length, 21); assert.deepEqual(many.f.state.budgets, {}, 'metadata batch size is not the 20-call quota');
  assert.throws(() => api.createPrismaMcpReadBindings({ ...p.authority, locate: undefined }, p.subjects));
  assert.throws(() => api.createPrismaMcpReadBindings(p.authority));
  const ddl = fs.readFileSync(path.join(root, 'packages/mcp-server/mysql-read-budget-schema.sql'), 'utf8');
  assert.match(ddl, /UNIQUE KEY mcp_read_binding_invocation \(goalId, grantId, toolName, inputHash\)/);
});

test('fixed original MCP traffic classes use shared Native buckets without caller human exemptions', async()=>{
  const api=await compiled(),f=sqlFixture(),owner={ userId:'user-a',tenantId:'tenant-a',workspaceId:'workspace-a' };
  const policy={ policyRef:'original-policy',policyRevision:1,expiresAt:Math.floor(Date.now()/1000)+60,windowSeconds:3600,limit:2 };
  let missing=false,wrongEvidence=false,lateChange=false,reads=0;
  const source={ async current(operation,who,native) {
    assert.equal(native,f.native);assert.deepEqual(who,owner);reads++;
    if(missing)return undefined;
    const classification=api.originalMcpTrafficClass(operation),kind=classification==='human_current_review' ? 'current_display_review' : classification==='original_receipt_reconciliation' ? 'original_receipt_read' : undefined;
    return { ...policy,...(lateChange && reads%2===0 ? { policyRevision:policy.policyRevision+1 } : {}),
      ...(kind || wrongEvidence ? { evidence:{ kind:kind ?? 'current_display_review',reference:'original-reference',revision:1,expiresAt:policy.expiresAt,...owner,...(wrongEvidence ? { userId:'another-user' } : {}) } } : {}) };
  } };
  const meter=api.createOriginalMcpTrafficMeter(source);
  const consume=(operation,m=meter,who=owner,stop=signal())=>f.database.$transaction(tx=>m.consumeIn(operation,who,tx,stop),{ isolationLevel:'Serializable',maxWait:2500,timeout:5000 });
  const methods=['mcp.tools.list','original.web.catalog.review','original.web.receipt.read','mcp.tools.call'];
  assert.deepEqual(methods.map(api.originalMcpTrafficClass),['protocol_discovery','human_current_review','original_receipt_reconciliation','automatic_business']);
  for(const operation of methods)await consume(operation);
  assert.equal(Object.keys(f.state.trafficBuckets).length,4);assert.ok(Object.values(f.state.trafficBuckets).every(row=>row.count===1));assert.deepEqual(f.state.budgets,{});assert.deepEqual(f.state.readCalls,{});
  const second=api.createOriginalMcpTrafficMeter(source);await consume('mcp.resources.read',second);
  assert.equal(Object.keys(f.state.trafficBuckets).length,4,'different fixed automatic operations and rebuilt adapters share the class-owner bucket');
  const before=structuredClone(f.state);await assert.rejects(()=>consume('mcp.tools.call'));assert.deepEqual(f.state,before);
  policy.policyRevision=2;await assert.rejects(()=>consume('mcp.tools.call'));assert.deepEqual(f.state,before,'policy revision is not a bucket reset suffix');
  await assert.rejects(()=>consume('mcp.tools.call',meter,{ ...owner,human:true }));assert.deepEqual(f.state,before);
  assert.throws(()=>api.originalMcpTrafficClass('tools/call'));assert.throws(()=>api.originalMcpTrafficClass('human'));assert.throws(()=>api.createOriginalMcpTrafficMeter({}));
  policy.limit=10;wrongEvidence=true;await assert.rejects(()=>consume('mcp.tools.call'));await assert.rejects(()=>consume('original.web.catalog.review'));wrongEvidence=false;assert.deepEqual(f.state,before);
  missing=true;await assert.rejects(()=>consume('original.web.receipt.read'));missing=false;assert.deepEqual(f.state,before);
  reads=0;lateChange=true;await assert.rejects(()=>consume('mcp.tools.list'));lateChange=false;assert.deepEqual(f.state,before,'late changed original policy rolls back the counter participant');
  f.badTrafficRow=true;await assert.rejects(()=>consume('mcp.tools.list'));f.badTrafficRow=false;assert.deepEqual(f.state,before,'missing counter is not zero/success');
  f.missingTrafficSchema=true;await assert.rejects(()=>consume('mcp.tools.list'));f.missingTrafficSchema=false;assert.deepEqual(f.state,before);
  const cancelled=new AbortController();cancelled.abort();await assert.rejects(()=>consume('mcp.tools.list',meter,owner,cancelled.signal));assert.deepEqual(f.state,before);
  f.loseCommitOnce=true;await assert.rejects(()=>consume('mcp.tools.list'));assert.equal(Object.values(f.state.trafficBuckets).reduce((n,row)=>n+row.count,0),6,'unknown owner commit can have consumed the same original bucket, no rollback/refund claim');
  const counters=f.calls.filter(row=>row.text.includes('client_api_rate_buckets'));assert.ok(counters.length>0);for(const row of counters)assert.doesNotMatch(JSON.stringify(row.values),/user-a|tenant-a|workspace-a|original-reference|original-policy/,'bucket SQL contains hashes/time only');
});

test('MCP read invocation keeps original holds through owner settlement and final checks', async () => {
  const api = await compiled(), auth = { subject:'original-user',clientId:'client',resource,scopes:['catalog:read'],token:'private-test-token' }, name='rental_catalog_search', input={ limit:1 };
  const target={ goalId:'original-invocation-goal',goalRevision:1,grantId:'original-grant',subject:auth.subject,clientId:auth.clientId,resource,scopes:auth.scopes,purpose:'catalog',originalInputHash:'a'.repeat(64),policyVersion:'policy-1' };
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const setup=()=>{
    const f=sqlFixture();let inOwner=false;
    const accounting=api.createPrismaMcpReadAccounting(f.database,{ async resolve(call,value,native) {
      assert.equal(inOwner,true,'target is resolved only inside the original owner callback');assert.equal(native,f.native);assert.equal(call.toolName,name);assert.deepEqual(value,input);return target;
    } });
    const read=async(stop,consume=async()=> 'ok')=>{
      inOwner=true;try{return await accounting.withCall(auth,name,input,consume,stop);}finally{inOwner=false;}
    };
    return { f,accounting,read };
  };
  const h=setup();let originalStop;
  const result=await h.accounting.withInvocation(auth,name,input,async stop=>{
    originalStop=stop;await delay(30);const result=await h.read(stop);
    assert.equal(h.f.state.budgets[target.goalId].concurrentReads,1,'read return does not release original hold');
    assert.equal(Object.values(h.f.state.readCalls)[0].state,'reserved');
    await delay(30);return result; // explicit owner/late validation substitute
  },signal());
  assert.equal(result,'ok');assert.equal(originalStop.aborted,true,'completed invocation signal cannot be reused');
  assert.equal(h.f.state.budgets[target.goalId].concurrentReads,0);assert.ok(h.f.state.budgets[target.goalId].consumedActiveMs>=50,'pre-reserve and post-read activity share the original call measurement');
  assert.equal(Object.values(h.f.state.readCalls)[0].state,'returned');
  const failed=setup();await assert.rejects(()=>failed.accounting.withInvocation(auth,name,input,async stop=>{
    await failed.read(stop);throw Error('original owner/final validation failed');
  },signal()));assert.equal(Object.values(failed.f.state.readCalls)[0].state,'failed');assert.equal(failed.f.state.budgets[target.goalId].concurrentReads,0);
  const duplicate=setup();await assert.rejects(()=>duplicate.accounting.withInvocation(auth,name,input,async stop=>{
    await duplicate.read(stop);await assert.rejects(()=>duplicate.read(stop));return 'cannot hide duplicate dispatch';
  },signal()));assert.equal(duplicate.f.state.budgets[target.goalId].consumedCalls,1);assert.equal(Object.values(duplicate.f.state.readCalls)[0].state,'failed');
  const empty=setup();await assert.rejects(()=>empty.accounting.withInvocation(auth,name,input,async()=> 'no original business call',signal()));assert.deepEqual(empty.f.state.budgets,{});
  const exhausted=setup();await exhausted.accounting.withInvocation(auth,name,input,stop=>exhausted.read(stop),signal());
  exhausted.f.state.budgets[target.goalId].consumedActiveMs=299999; // explicit remaining-allowance boundary
  let readers=0;await assert.rejects(()=>exhausted.accounting.withInvocation(auth,name,input,async stop=>{
    await delay(30);return exhausted.read(stop,async()=>{readers++;});
  },signal()));assert.equal(readers,0);assert.equal(exhausted.f.state.budgets[target.goalId].reservedActiveMs,1);assert.equal(Object.values(exhausted.f.state.readCalls).filter(r=>r.state==='unknown').length,1);
  const cancelled=setup(),cancel=new AbortController(),ready=Promise.withResolvers(),gate=Promise.withResolvers();let ended=false;
  const work=cancelled.accounting.withInvocation(auth,name,input,async stop=>{
    await cancelled.read(stop);ready.resolve();await gate.promise;return 'late private output';
  },cancel.signal);
  const rejection=assert.rejects(work).then(()=>{ended=true;});await ready.promise;cancel.abort();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ended,false,'cancel must await the ignored original owner/final work');assert.equal(cancelled.f.state.budgets[target.goalId].concurrentReads,1);
  gate.resolve();await rejection;assert.equal(Object.values(cancelled.f.state.readCalls)[0].state,'unknown');assert.equal(cancelled.f.state.budgets[target.goalId].concurrentReads,1);
  const detached=setup(),started=Promise.withResolvers(),finish=Promise.withResolvers();let detachedEnded=false;
  const detachedWork=detached.accounting.withInvocation(auth,name,input,async stop=>{
    void detached.read(stop,async()=>{started.resolve();await finish.promise;return 'not awaited';});await started.promise;return 'too early';
  },signal());
  const detachedRejection=assert.rejects(detachedWork).then(()=>{detachedEnded=true;});await started.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(detachedEnded,false);
  finish.resolve();await detachedRejection;assert.equal(Object.values(detached.f.state.readCalls)[0].state,'unknown');
  const lost=setup();await assert.rejects(()=>lost.accounting.withInvocation(auth,name,input,async stop=>{
    const value=await lost.read(stop);lost.f.loseCommitOnce=true;return value;
  },signal()));assert.equal(Object.values(lost.f.state.readCalls)[0].state,'returned','lost settlement response preserves original terminal evidence');assert.equal(lost.f.state.budgets[target.goalId].consumedCalls,1);
  assert.doesNotMatch(JSON.stringify(h.f.state),/private-test-token/);
});

test("MCP read SQL budget preserves original target limits and unknown holds across instances", async () => {
  const api = await compiled(), authorization = { subject: 'original-user', clientId: 'client', resource, scopes: ['catalog:read'], token: 'private-test-token' };
  let sequence = 0;
  const call = (token = authorization.token) => ({ callId: `read-${++sequence}`, authorization: { ...authorization, token }, toolName: 'rental_catalog_search', inputHash: 'a'.repeat(64) });
  const target = { goalId: 'trusted-original-goal', goalRevision: 1, grantId: 'original-grant', subject: authorization.subject,
    clientId: authorization.clientId, resource, scopes: authorization.scopes, purpose: 'catalog', originalInputHash: 'b'.repeat(64), policyVersion: 'policy-1' };
  const sourceFor = f => ({ async resolve(c, native) { assert.equal(native, f.native); return structuredClone(target); } }); // explicit ORIGINAL target substitute, not product authority
  const f = sqlFixture(), store = api.createPrismaMcpReadBudget(f.database, sourceFor(f));
  const withRead = (budget, callback, auth = authorization, sig = signal()) => api.createPersistentMcpReadAccounting(budget).withCall(auth, 'rental_catalog_search', { limit: 1 }, callback, sig);
  await assert.rejects(() => withRead(store, async () => { throw Error('reader failed'); }));
  assert.equal(f.state.budgets[target.goalId].consumedCalls, 1); assert.equal(f.state.budgets[target.goalId].concurrentReads, 0);
  const second = api.createPrismaMcpReadBudget(f.database, sourceFor(f));
  assert.equal(await withRead(second, async () => 'ok', { ...authorization, token: 'rotated-test-token' }), 'ok');
  assert.equal(f.state.budgets[target.goalId].consumedCalls, 2, 'rebuilding/rotating token does not reset ORIGINAL target');
  const c1 = call(), c2 = call(), reservations = await Promise.all([store.reserve(c1, signal()), second.reserve(c2, signal())]);
  await assert.rejects(() => store.reserve(call(), signal()), error => error instanceof api.OriginalMcpReadBudgetError && error.kind === 'limit');
  await store.settle(c1, reservations[0], { outcome: 'failed', activeMs: 3 }, signal());
  const charged = structuredClone(f.state.budgets[target.goalId]);
  await second.settle(c1, reservations[0], { outcome: 'failed', activeMs: 3 }, signal());
  assert.deepEqual(f.state.budgets[target.goalId], charged, 'same settlement is not charged twice');
  await store.markUnknown(c2, signal()); assert.equal(f.state.readCalls[c2.callId].state, 'unknown');
  await assert.rejects(() => store.settle(c2, reservations[1], { outcome: 'returned', activeMs: 1 }, signal()));
  assert.equal(f.state.budgets[target.goalId].concurrentReads, 1, 'unknown cannot become settled by a late claim');
  assert.equal(f.state.budgets[target.goalId].consumedCalls, 4);
  await assert.rejects(() => second.reserve(c1, signal()), error => error.kind === 'denied');
  await assert.rejects(() => api.createPrismaMcpReadBudget(f.database, { resolve: async () => ({ ...target, policyVersion: 'policy-2' }) }).reserve(call(), signal()));
  assert.equal(Object.keys(f.state.budgets).length, 1, 'revision/policy mismatch never initializes replacement quota');
  assert.throws(() => api.createPrismaMcpReadBudget(f.database));
  await assert.rejects(() => api.createPrismaMcpReadBudget(f.database, { resolve: async () => undefined }).reserve(call(), signal()), error => error.kind === 'denied');
  const wrongReservation = { ...reservations[1], consumedCalls: 1 };
  await assert.rejects(() => store.settle(c2, wrongReservation, { outcome: 'returned', activeMs: 1 }, signal()));
  const persisted = JSON.stringify(f.state), statements = JSON.stringify(f.calls);
  for (const token of [authorization.token, 'rotated-test-token']) { assert.ok(!persisted.includes(token)); assert.ok(!statements.includes(token)); }

  const uncertain = sqlFixture(), uncertainStore = api.createPrismaMcpReadBudget(uncertain.database, sourceFor(uncertain)); let consumed = 0;
  uncertain.loseCommitOnce = true;
  await assert.rejects(() => withRead(uncertainStore, async () => { consumed++; }));
  assert.equal(consumed, 0); assert.equal(uncertain.state.budgets[target.goalId].consumedCalls, 1);
  assert.equal(uncertain.state.budgets[target.goalId].concurrentReads, 1); assert.equal(Object.values(uncertain.state.readCalls)[0].state, 'unknown');
  const unavailable = sqlFixture(); unavailable.loseCommit = true;
  await assert.rejects(() => withRead(api.createPrismaMcpReadBudget(unavailable.database, sourceFor(unavailable)), async () => { consumed++; }));
  assert.equal(consumed, 0); assert.equal(unavailable.state.budgets[target.goalId].concurrentReads, 1);
  assert.equal(Object.values(unavailable.state.readCalls)[0].state, 'reserved', 'failed lookup acknowledgement cannot prove unknown marker saved, but ORIGINAL hold persists');
  const settleCall = call(), settleReservation = await uncertainStore.reserve(settleCall, signal()); uncertain.loseCommit = true;
  await assert.rejects(() => uncertainStore.settle(settleCall, settleReservation, { outcome: 'returned', activeMs: 2 }, signal()));
  uncertain.loseCommit = false; await uncertainStore.markUnknown(settleCall, signal());
  assert.equal(uncertain.state.readCalls[settleCall.callId].state, 'returned', 'lost commit acknowledgement preserves proven terminal row');
  assert.equal(uncertain.state.budgets[target.goalId].concurrentReads, 1, 'other unknown occupancy remains held');

  const cancelled = sqlFixture(), controller = new AbortController();
  await assert.rejects(() => withRead(api.createPrismaMcpReadBudget(cancelled.database, sourceFor(cancelled)), async readSignal => {
    assert.notEqual(readSignal, controller.signal); controller.abort(); assert.equal(readSignal.aborted, true, 'original cancellation reaches the allowance signal');
  }, authorization, controller.signal));
  assert.equal(cancelled.state.budgets[target.goalId].consumedCalls, 1); assert.equal(cancelled.state.budgets[target.goalId].concurrentReads, 1);
  const max = sqlFixture(), capped = api.createPrismaMcpReadBudget(max.database, sourceFor(max));
  for (let i = 0; i < 20; i++) { const c = call(), r = await capped.reserve(c, signal()); await capped.settle(c, r, { outcome: 'returned', activeMs: 1 }, signal()); }
  await assert.rejects(() => api.createPrismaMcpReadBudget(max.database, sourceFor(max)).reserve(call(), signal()), error => error.kind === 'limit');
  assert.equal(max.state.budgets[target.goalId].consumedCalls, 20);
  const active = sqlFixture(), activeStore = api.createPrismaMcpReadBudget(active.database, sourceFor(active));
  const seedCall = call(), seed = await activeStore.reserve(seedCall, signal()); await activeStore.settle(seedCall, seed, { outcome: 'returned', activeMs: 1 }, signal());
  active.state.budgets[target.goalId].consumedActiveMs = 299997; // explicit boundary fixture, not quota reset in product
  const lastCall = call(), last = await activeStore.reserve(lastCall, signal()); assert.equal(last.callAllowanceMs, 3);
  await assert.rejects(() => activeStore.reserve(call(), signal()), error => error.kind === 'limit');
  await activeStore.settle(lastCall, last, { outcome: 'returned', activeMs: 3 }, signal());
  await assert.rejects(() => activeStore.reserve(call(), signal()), error => error.kind === 'limit');
  assert.equal(active.state.budgets[target.goalId].consumedActiveMs, 300000);

  const slow = sqlFixture(), slowStore = api.createPrismaMcpReadBudget(slow.database, sourceFor(slow));
  const delayed = { ...slowStore, reserve: async (...args) => {
    const reservation = await slowStore.reserve(...args);
    await new Promise(resolve => setTimeout(resolve, 40));
    return reservation;
  } };
  assert.equal(await withRead(delayed, async () => 'ok'), 'ok');
  assert.ok(slow.state.budgets[target.goalId].consumedActiveMs >= 25, 'reservation activity is charged along with the reader');
  const exhausted = sqlFixture(), exhaustedStore = api.createPrismaMcpReadBudget(exhausted.database, sourceFor(exhausted));
  const initialCall = call(), initial = await exhaustedStore.reserve(initialCall, signal());
  await exhaustedStore.settle(initialCall, initial, { outcome: 'returned', activeMs: 1 }, signal());
  exhausted.state.budgets[target.goalId].consumedActiveMs = 299999; // fixed remaining allowance in the SQL fixture
  const slowExhausted = { ...exhaustedStore, reserve: async (...args) => {
    const reservation = await exhaustedStore.reserve(...args);
    await new Promise(resolve => setTimeout(resolve, 40));
    return reservation;
  } };
  let lateReads = 0;
  await assert.rejects(() => withRead(slowExhausted, async () => { lateReads++; }));
  assert.equal(lateReads, 0, 'expired reservation allowance must not start the reader');
  assert.equal(exhausted.state.budgets[target.goalId].concurrentReads, 1);
  assert.equal(Object.values(exhausted.state.readCalls).filter(row => row.state === 'unknown').length, 1, 'exhausted reservation remains held');

  const bounded = sqlFixture(), boundedStore = api.createPrismaMcpReadBudget(bounded.database, sourceFor(bounded));
  const boundedSeedCall = call(), boundedSeed = await boundedStore.reserve(boundedSeedCall, signal());
  await boundedStore.settle(boundedSeedCall, boundedSeed, { outcome: 'returned', activeMs: 1 }, signal());
  bounded.state.budgets[target.goalId].consumedActiveMs = 299750; // 250ms ORIGINAL remaining activity, not a fresh 15s window
  let finishBounded, notifyAbort, boundedEnded = false;
  const boundedAbort = new Promise(resolve => { notifyAbort = resolve; });
  const boundedRead = withRead(boundedStore, readSignal => {
    assert.ok(readSignal instanceof AbortSignal); assert.equal(readSignal.aborted, false);
    readSignal.addEventListener('abort', notifyAbort, { once: true });
    return new Promise(resolve => { finishBounded = resolve; }); // deliberately ignores cancellation until released
  });
  const boundedRejected = assert.rejects(boundedRead).then(() => { boundedEnded = true; });
  await boundedAbort; await new Promise(resolve => setImmediate(resolve));
  assert.equal(boundedEnded, false, 'deadline propagation must not pretend the original callback completed');
  finishBounded('private late result'); await boundedRejected;
  assert.equal(bounded.state.budgets[target.goalId].concurrentReads, 1);
  assert.equal(bounded.state.budgets[target.goalId].reservedActiveMs, 250);
  assert.equal(Object.values(bounded.state.readCalls).filter(row => row.state === 'unknown').length, 1);
  const ddl = fs.readFileSync(path.join(root, 'packages/mcp-server/mysql-read-budget-schema.sql'), 'utf8');
  assert.match(ddl, /PRIMARY KEY \(goalId\)/); assert.match(ddl, /PRIMARY KEY \(callId\)/); assert.match(ddl, /ON DELETE RESTRICT/);
});
