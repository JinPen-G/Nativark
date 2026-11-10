"use strict";
/** Actual Web consent source -> grant -> code -> token, with real original Auth.
 * SQL, reviewed notice/applicable MFA policy and audit are explicit substitutes;
 * no browser UI/human event/MFA execution, actual DB/DI or production publication. */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), { createHash } = require('node:crypto');
const { createRequire, registerHooks } = require('node:module'), { pathToFileURL } = require('node:url');
const { fixture: originalFixture, source, runtimeShared: principalShared } = require('./fixtures/mcp/original-identity.cjs');
const { createOriginalMcpCatalogReadAuthority } = source('apps/api/src/modules/auth/original-mcp-catalog-read-authority.ts');
const { createOriginalMcpAvailabilityReadAuthority } = source('apps/api/src/modules/auth/original-mcp-availability-read-authority.ts');
const { createOriginalMcpCatalogReadContext } = source('apps/api/src/modules/auth/original-mcp-read-context.ts');
const { createOriginalMcpOAuthCore } = source('apps/api/src/modules/auth/original-mcp-oauth-core.ts');
const { createOriginalMcpCatalogReadTools } = source('apps/api/src/modules/auth/original-mcp-catalog-read-tools.ts');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createOriginalMcpHost } = source('apps/api/src/modules/auth/original-mcp-host.ts');
const root = path.resolve(__dirname, '..'), signal = () => new AbortController().signal;
const installed = createRequire(path.join(root, 'clients/agent-desktop/harness/packages/mcp/mcp-client/package.json'));
const ts = require(path.join(root, 'clients/agent-desktop/harness/node_modules/typescript/lib/typescript.js'));
let artifact, registerOriginalReadTools;
async function compiled() {
  if (artifact) return artifact;
  const output = fs.mkdtempSync(path.join(root, 'output/mcp-web-consent-verification-')), packageRoot = path.join(root, 'packages/mcp-server'), staged = path.join(output, 'node_modules/@rental-os/mcp-server');
  fs.mkdirSync(staged, { recursive: true }); fs.copyFileSync(path.join(packageRoot, 'package.json'), path.join(staged, 'package.json'));
  const options = { strict: true, skipLibCheck: true, declaration: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: ['node'], typeRoots: [path.join(root, 'clients/agent-desktop/harness/node_modules/@types')], rootDir: path.join(packageRoot, 'src'), outDir: path.join(staged, 'dist'),
    paths: { '@modelcontextprotocol/server': [path.join(path.dirname(installed.resolve('@modelcontextprotocol/server')), 'index.d.mts')],
      '@rental-os/shared': [path.join(principalShared, 'dist/index.d.ts')] } };
  const check = program => { const diagnostics = ts.getPreEmitDiagnostics(program); assert.equal(diagnostics.length, 0, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')); assert.equal(program.emit().emitSkipped, false); };
  check(ts.createProgram(['original-traffic-meter.ts', 'catalog-goal-control-plane.ts', 'prisma-mcp-catalog-goal-adoptions.ts', 'prisma-mcp-read-goal-settlement.ts', 'prisma-mcp-catalog-goal-intents.ts', 'prisma-mcp-catalog-goals.ts', 'prisma-mcp-read-accounting.ts', 'persistent-read-accounting.ts', 'capability-mapping.ts', 'host-router.ts', 'service.ts', 'consent-control-plane.ts', 'review-control-plane.ts', 'grant-control-plane.ts', 'admission-control-plane.ts', 'reviewed-governance-control-plane.ts', 'subject-control-plane.ts', 'prisma-oauth-web-consent.ts', 'prisma-oauth-consent-review.ts'].map(file => path.join(packageRoot, 'src', file)), options));
  // Strictly compile only the new API context and original request-identity types.
  // Nest exception declaration is an explicit facade, not API/Prisma/DI validation.
  const nestTypes = path.join(output, 'context-nest.d.ts');
  fs.writeFileSync(nestTypes, 'export declare class ForbiddenException extends Error { constructor(message?: string); }\n');
  const nativeTypes = path.join(output, 'context-native.d.ts');
  fs.writeFileSync(nativeTypes, 'export namespace Prisma { export interface TransactionClient {} }\n');
  check(ts.createProgram([path.join(root, 'apps/api/src/modules/auth/original-mcp-read-context.ts')], {
    ...options, module: ts.ModuleKind.Node16, moduleResolution: ts.ModuleResolutionKind.Node16,
    rootDir: path.join(root, 'apps/api/src'), outDir: path.join(output, 'read-context-types'),
    paths: { ...options.paths, '@rental-os/mcp-server': [path.join(staged, 'dist/index.d.ts')],
      '@rental-os/mcp-server/*': [path.join(staged, 'dist/*.d.ts')], '@nestjs/common': [nestTypes], '@prisma/client': [nativeTypes] },
  }));
  const consumer = path.join(output, 'consumer.mts');
  fs.writeFileSync(consumer, [
    'export { createOriginalMcpTrafficMeter, originalMcpTrafficClass } from "@rental-os/mcp-server/original-traffic-meter";',
    'export { createPrismaMcpProtocolTraffic, originalMcpProtocolOperations } from "@rental-os/mcp-server/protocol-traffic";',
    'export { MCP_BUSINESS_CAPABILITIES } from "@rental-os/mcp-server/capability-mapping";',
    'export { createPrismaOAuthWebConsent } from "@rental-os/mcp-server/prisma-oauth-web-consent";',
    'export { createPrismaOAuthConsentReview } from "@rental-os/mcp-server/prisma-oauth-consent-review";',
    'export { createPrismaOAuthConsentAuthority } from "@rental-os/mcp-server/prisma-oauth-consent-authority";',
    'export { createPrismaOAuthAdmissionStore, createPrismaOAuthAdmissionReader } from "@rental-os/mcp-server/prisma-oauth-admission-store";',
    'export { createRentalMcpService } from "@rental-os/mcp-server/service";',
    'export { createMcpHostRouter } from "@rental-os/mcp-server/host-router";',
    'export { createMcpConsentControlPlane } from "@rental-os/mcp-server/consent-control-plane";',
    'export { createMcpReviewControlPlane } from "@rental-os/mcp-server/review-control-plane";',
    'export { publicClientReviewRegistrationHash } from "@rental-os/mcp-server/prisma-public-client-review";',
    'export { oauthNoticeCandidateHash, oauthNoticeScopeKey } from "@rental-os/mcp-server/prisma-oauth-notice-review";',
    'export { createMcpGrantControlPlane } from "@rental-os/mcp-server/grant-control-plane";',
    'export { createMcpAdmissionControlPlane } from "@rental-os/mcp-server/admission-control-plane";',
    'export { createMcpReviewedGovernanceControlPlane } from "@rental-os/mcp-server/reviewed-governance-control-plane";',
    'export { createMcpSubjectControlPlane } from "@rental-os/mcp-server/subject-control-plane";',
    'export { createPrismaOAuthSubjectStore, captureOAuthSubjectReceipt } from "@rental-os/mcp-server/prisma-oauth-subject-store";',
    'export { capturePersistedOAuthGrant } from "@rental-os/mcp-server/prisma-oauth-grant-authority";',
    'export { captureOAuthGrantRevocationReceipt } from "@rental-os/mcp-server/prisma-oauth-grant-management";',
    'export { captureOAuthAdmissionTarget } from "@rental-os/mcp-server/prisma-oauth-admission-store";',
    'export { createPrismaOAuthConsentPolicyStore, createPrismaOAuthConsentPolicyReader, captureOAuthConsentPolicyTarget, captureOAuthConsentPolicyReceipt } from "@rental-os/mcp-server/prisma-oauth-consent-policy-store";',
    'export { captureOAuthConsentPolicy } from "@rental-os/mcp-server/prisma-oauth-consent-review";',
    'export { captureRegisteredPublicClient, capturePublicClientRegistrationReceipt } from "@rental-os/mcp-server/prisma-public-client-registry";',
    'export { createPrismaOAuthGrantAuthority } from "@rental-os/mcp-server/prisma-oauth-grant-authority";',
    'export { createPrismaOAuthGrantUseStore } from "@rental-os/mcp-server/prisma-oauth-grant-use";',
    'export { createPrismaOAuthGrantAdmissionSource } from "@rental-os/mcp-server/prisma-oauth-grant-admission";',
    'export { createPersistentMcpReadAccounting, OriginalMcpReadBudgetError, captureMcpReadInput } from "@rental-os/mcp-server/persistent-read-accounting";',
    'export { createPrismaMcpReadAccounting } from "@rental-os/mcp-server/prisma-mcp-read-accounting";',
    'export { createPrismaMcpCatalogGoals, ORIGINAL_MCP_CATALOG_GOAL_POLICY_VERSION } from "@rental-os/mcp-server/prisma-mcp-catalog-goals";',
    'export { createPrismaMcpCatalogGoalIntents, originalCatalogGoalIntentId } from "@rental-os/mcp-server/prisma-mcp-catalog-goal-intents";',
    'export { createPrismaMcpCatalogGoalAdoptions, captureOriginalCatalogGoalAdoption } from "@rental-os/mcp-server/prisma-mcp-catalog-goal-adoptions";',
    'export { createMcpCatalogGoalControlPlane } from "@rental-os/mcp-server/catalog-goal-control-plane";',
    'export { createPrismaMcpReadBindings } from "@rental-os/mcp-server/prisma-mcp-read-bindings";',
    'export { createPersistentOAuthAccessReader } from "@rental-os/mcp-server/persistent-oauth-tokens";',
    'export { createPrismaPublicClientRegistry } from "@rental-os/mcp-server/prisma-public-client-registry";',
    'export { createPrismaOAuthStore } from "@rental-os/mcp-server/prisma-oauth-store";',
    'export { createPersistentOAuthAuthorization } from "@rental-os/mcp-server/persistent-oauth-authorization";',
    'export { createPersistentOAuthTokenService } from "@rental-os/mcp-server/persistent-oauth-tokens";',
    'import type { OriginalOAuthWebConsentPolicy } from "@rental-os/mcp-server/prisma-oauth-web-consent";',
    'import type { OAuthSqlTransaction } from "@rental-os/mcp-server/prisma-oauth-store";',
    'interface Native extends OAuthSqlTransaction { originalMarker: "original"; }',
    'export const marker = (policy: OriginalOAuthWebConsentPolicy<Native>): OriginalOAuthWebConsentPolicy<Native> => ({ ...policy,',
    ' current: async (...args) => { const marker: "original" = args[2].originalMarker; void marker; return policy.current(...args); } });',
  ].join('\n'));
  check(ts.createProgram([consumer], { ...options, rootDir: output, outDir: path.join(output, 'consumer-build') }));
  const stagedUrl = pathToFileURL(staged + path.sep).href;
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.startsWith(stagedUrl) && specifier === '@modelcontextprotocol/server') return { url: pathToFileURL(installed.resolve(specifier)).href, shortCircuit: true };
    if (context.parentURL?.startsWith(stagedUrl) && specifier === '@rental-os/shared') return { url: pathToFileURL(path.join(principalShared, 'dist/index.js')).href, shortCircuit: true };
    return next(specifier, context);
  } });
  try {
    artifact = await import(pathToFileURL(path.join(output, 'consumer-build/consumer.mjs')).href);
    // Private registration unit seam for the actual compiled SDK cancellation
    // test, not a new package export or a production deep-import consumer.
    ({ registerReadTools: registerOriginalReadTools } = await import(pathToFileURL(path.join(staged, 'dist/read-tools.js')).href));
  } finally { hooks.deregister(); }
  fs.writeFileSync(path.join(output, 'scope.json'), JSON.stringify({ strict: 'Web consent/grant/code/OAuth dependency closure and formal NodeNext/native consumer; API read-context/request-identity subset with Nest exception declaration facade',
    actual: 'original Auth Web bearer/signature/session and completed-source persistence/code consumers',
    external: 'SQL locks/transactions/audit/notice/applicable verification policy and context-native/Nest declarations are fixtures; no UI/human event/MFA/real DB/generated Prisma/full API type proof' }, null, 2));
  return artifact;
}
const resource = 'https://mcp.example.invalid/mcp', authorizationEndpoint = 'https://as.example.invalid/authorize', consentEndpoint = 'https://as.example.invalid/consent';
const scopes = ['rental.catalog.read'], verifier = 'v'.repeat(43), challenge = createHash('sha256').update(verifier).digest('base64url');
function fixture(api, requestedScopes = scopes) {
  const scopes = requestedScopes;
  const original = originalFixture(), now = Math.floor(Date.now() / 1000), input = { clientId: 'client-a', clientRevision: 1, resource, scopes, redirectUri: 'http://127.0.0.1:49501/callback', state: 'original-oauth-state', codeChallenge: challenge };
  const session = { id: 'original-session', userId: 'user-a', currentWorkspaceId: 'workspace-a', audience: 'operator', expiresAt: new Date((now + 1800) * 1000), revokedAt: null };
  const client = { clientId: input.clientId, revision: 1, enabled: true, expiresAt: now + 600, scopes, redirectUris: ['http://127.0.0.1:49152/callback'] };
  const platform = { resource, revision: 1, enabled: true, expiresAt: now + 800, clientIds: [input.clientId], scopes, clientType: 'public' };
  const workspace = { resource, revision: 1, enabled: true, expiresAt: now + 700, clientIds: [input.clientId], scopes, tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  const f = { original, session, input, audits: [], auditRows: [], transactions: 0, tail: Promise.resolve(), failAudit: false, loseCommit: false, cancelCommit: undefined, afterAudit: undefined, queryHook: undefined,
    notice: { subject: 'issuer-subject-not-user-id', noticeVersion: 'original-review-v1', noticeText: 'Reviewed external processing notice for this offline fixture.', expiresAt: now + 650,
      verification: { kind: 'satisfied', reference: 'original-verification-record', revision: 1, expiresAt: now + 620 } } };
  f.state = { mcp_catalog_goal_history: {},mcp_catalog_goal_adoptions: {},mcp_catalog_goal_intents: {}, mcp_oauth_browser_consents: {}, mcp_oauth_grants: {}, mcp_oauth_grant_authorizations: {}, mcp_oauth_codes: {}, mcp_oauth_families: {}, mcp_oauth_access: {}, mcp_oauth_refresh: {}, mcp_oauth_grant_last_use: {},
    mcp_oauth_public_clients: { 'client-a': { clientId: 'client-a', revision: 1, recordJson: JSON.stringify(client) } },
    mcp_oauth_platform_admissions: { [resource]: { resource, revision: 1, recordJson: JSON.stringify(platform) } },
    mcp_oauth_workspace_admissions: { [[resource, 'tenant-a', 'workspace-a'].join('|')]: { resource, tenantId: 'tenant-a', workspaceId: 'workspace-a', revision: 1, recordJson: JSON.stringify(workspace) } } };
  const transactionContext = new AsyncLocalStorage();
  f.database = { async $transaction(callback, options) {
    assert.deepEqual(options, { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
    const parent = transactionContext.getStore(), nested = parent !== undefined;
    assert.ok(!nested || f.catalogComposition, 'only this disjoint-budget fixture permits a nested transaction');
    let release = () => {};
    if (!nested) { const previous = f.tail; f.tail = new Promise(resolve => { release = resolve; }); await previous; }
    f.transactions++; const baseline = structuredClone(f.state), working = structuredClone(baseline), audit = [], auditRows = [];
    const transactionId = f.transactions;
    f.transactionEvents?.push(['begin', transactionId, nested ? 'budget' : 'original']);
    const tx = { ...original.tx, originalMarker: 'original', operationLog: {
      findUnique: async ({ where }) => structuredClone([...f.auditRows, ...auditRows].find(row => row.id === where.id) ?? null),
      create: async ({ data, select }) => {
        assert.equal(nested, false, 'budget source cannot repair or append original audit');
        if (data.action.startsWith('mcp.read.goal.')) {
          if (f.failAudit) throw new Error('private original audit');
          auditRows.push(structuredClone(data)); await f.afterGoalAudit?.(data); return structuredClone(data);
        }
        assert.deepEqual(select, { id: true }); if (f.failAudit) throw new Error('private original audit'); auditRows.push(structuredClone(data));
        const part = data.action.split('.').at(-1), stage = part === 'created' ? 'grant' : part === 'issued' ? 'code' : part;
        const view = { stage, revision: data.detail.metadata.revision, authorizationId: data.detail.metadata.operationKey }; audit.push(view); f.afterAudit?.(view);
        return { id: 'original-audit-' + (f.auditRows.length + auditRows.length) };
      } }, authSession: { findFirst: async query => session.revokedAt === null && session.expiresAt > new Date() && query.where.id === session.id ? structuredClone(session) : null },
      async $queryRaw(parts, ...values) { assert.ok(Array.isArray(parts.raw)); const sql = parts.join('?').replace(/\s+/g, ' ').trim(), table = /FROM (\w+)/.exec(sql)[1];
        f.sqlEvents?.push({ transactionId, table, sql });
        if (nested) assert.ok(table.startsWith('mcp_read_') || table==='client_api_rate_buckets', 'budget cannot reacquire original Auth/grant locks');
        if (table==='client_api_rate_buckets') {
          assert.match(sql,/WHERE scopeKey = \? AND bucketStart = \? LIMIT 1 FOR UPDATE$/);
          if (f.missingTrafficSchema) throw Error('explicit original rate schema unavailable');
          const row=working[table][values[0]+'|'+values[1].getTime()];return row ? [{ count:row.count }] : [];
        }
        if (['mcp_catalog_goal_history','mcp_catalog_goal_adoptions'].includes(table)) {
          assert.equal(nested,false);assert.match(sql,/FOR UPDATE NOWAIT$/);if (f.missingAdoptionSchema) throw Error('explicit missing adoption/history schema');
          const row=working[table][values[0]],rows=row ? [structuredClone(row)] : [];
          return f.queryHook ? f.queryHook(table,rows) : rows;
        }
        if (table === 'mcp_catalog_goal_intents') {
          assert.equal(nested,false); assert.match(sql,/FOR UPDATE NOWAIT$/); if (f.intentBusy) throw Error('explicit intent busy lock');
          const row = working[table][values[0]], rows = row ? [structuredClone(row)] : [];
          return f.queryHook ? f.queryHook(table,rows) : rows;
        }
        if (table.startsWith('mcp_read_')) {
          assert.ok(f.catalogComposition); assert.match(sql, /FOR UPDATE(?: NOWAIT)?$/);
          if (table === 'mcp_read_catalog_goals') {
            if (f.missingGoalSchema) throw Error('explicit missing goal schema');
            const row = sql.includes('WHERE ownerKey') ? working[table][values[0]] : Object.values(working[table]).find(row => row.goalId === values[0]);
            return row ? [structuredClone(row)] : [];
          }
          if (table === 'mcp_read_calls' && sql.includes('FORCE INDEX')) {
            assert.match(sql,/FORCE INDEX \(mcp_read_calls_goal\).*ORDER BY callId LIMIT 21 FOR UPDATE NOWAIT$/);
            return structuredClone(Object.values(working[table]).filter(row=>row.goalId===values[0]).sort((a,b)=>a.callId < b.callId ? -1 : a.callId > b.callId ? 1 : 0).slice(0,21));
          }
          if (sql.includes('FORCE INDEX')) {
            const rows = Object.values(working[table]).filter(row => table === 'mcp_read_goal_budgets' ? row.grantId === values[0]
              : row.userId === values[0] && row.tenantId === values[1] && row.workspaceId === values[2]);
            return structuredClone(rows.slice(0,1));
          }
          const row = working[table][values[0]];
          if (sql.startsWith('SELECT goalId ')) return row ? [{ goalId: row.goalId }] : [];
          return row ? [structuredClone(row)] : [];
        }
        if (table === 'mcp_oauth_grants' && sql.includes('FORCE INDEX')) {
          assert.match(sql, /LIMIT 51 FOR UPDATE NOWAIT$/);
          return Object.values(working[table]).filter(row => row.userId === values[0] && row.tenantId === values[1] && row.workspaceId === values[2])
            .sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0,51).map(({ id }) => ({ id }));
        }
        assert.match(sql, /FOR UPDATE$/);
        if (table === 'auth_sessions') { assert.deepEqual(values, [session.id]); return [{ id: session.id }]; }
        if (['mcp_oauth_consent_reviews', 'mcp_oauth_workspace_reviews', 'mcp_oauth_subject_bindings'].includes(table)) {
          if (!f.notice) return [];
          const common = { resource, revision: 1, enabled: true, expiresAt: f.notice.expiresAt, noticeVersion: f.notice.noticeVersion,
            verificationRequired: f.notice.verification.kind !== 'not_required', reviewRef: 'original-review-authority', reviewRevision: 1 };
          const policy = table === 'mcp_oauth_consent_reviews' ? { ...common, noticeText: f.notice.noticeText }
            : table === 'mcp_oauth_workspace_reviews' ? { ...common, tenantId: 'tenant-a', workspaceId: 'workspace-a' }
            : { resource, userId: 'user-a', tenantId: 'tenant-a', subject: f.notice.subject, revision: 1, enabled: true, expiresAt: f.notice.expiresAt };
          return [{ ...Object.fromEntries(Object.entries(policy).filter(([key]) => ['resource', 'revision', 'tenantId', 'workspaceId', 'userId', 'subject'].includes(key))), recordJson: JSON.stringify(policy) }];
        }
        if (table === 'mcp_oauth_grant_last_use') { const found = working[table][values[0]]; return found ? [{ ...structuredClone(found), observedAtMs: String(found.observedAtMs) }] : []; }
        if (table === 'mcp_oauth_grants' && sql.includes('WHERE resource')) return Object.values(working[table])
          .filter(row => row.resource === values[0] && row.userId === values[1] && row.tenantId === values[2] && row.workspaceId === values[3])
          .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, values.at(-1)).map(row => structuredClone(row));
        const key = table === 'mcp_oauth_workspace_admissions' ? values.join('|') : values[0];
        const found = table === 'mcp_oauth_codes' && sql.includes('WHERE authorizationId') ? Object.values(working[table]).find(row => row.authorizationId === key) : working[table][key];
        const rows = found ? [structuredClone(found)] : []; return f.queryHook ? f.queryHook(table, rows) : rows;
      },
      async $executeRaw(parts, ...values) { const sql = parts.join('?').replace(/\s+/g, ' ').trim(), table = /(?:INTO|UPDATE) (\w+)/.exec(sql)[1];
        if (nested) assert.ok(['mcp_read_goal_budgets','mcp_read_calls','client_api_rate_buckets'].includes(table), 'separate budget mutates only original budget/call/class-rate metadata');
        if (table==='client_api_rate_buckets') {
          if (f.missingTrafficSchema) throw Error('explicit original rate schema unavailable');
          const key=values[1]+'|'+values[2].getTime(),old=working[table][key];
          working[table][key]={ scopeKey:values[1],bucketStart:values[2],count:(old?.count ?? 0)+1 };return old ? 2 : 1;
        }
        if (table.startsWith('mcp_read_') && sql.startsWith('UPDATE')) {
          if (table === 'mcp_read_catalog_goals') {
            const row=working[table][values[3]];if (!row || f.adoptionZeroCas || row.goalId !== values[4] || row.recordHash !== values[5]) return 0;
            Object.assign(row,{ goalId:values[0],recordHash:values[1],recordJson:values[2] });return 1;
          }
          if (table === 'mcp_read_goal_budgets') {
            const row = working[table][values[5]]; if (!row || row.revision !== values[6] || row.bindingHash !== values[7]) return 0;
            Object.assign(row, { revision: values[0], consumedCalls: values[1], consumedActiveMs: values[2], reservedActiveMs: values[3], concurrentReads: values[4] }); return 1;
          }
          const unknown = sql.includes("SET state = 'unknown'"), row = working[table][values[unknown ? 0 : 2]];
          if (!row || row.state !== 'reserved' || row.callBindingHash !== values[unknown ? 1 : 3]) return 0;
          row.state = unknown ? 'unknown' : values[0]; row.activeMs = unknown ? null : values[1]; return 1;
        }
        if (table === 'mcp_oauth_grant_last_use') { assert.equal(f.readAuthorityHeld, false, 'observer runs after original Guard transaction settles');
          if (f.verifyInvocationHold) assert.equal(Object.values(f.state.mcp_read_goal_budgets)[0].concurrentReads,1,'original invocation is still held during final usage persistence');
          if (f.failUse) throw new Error('synthetic observation persistence failure'); }
        if (sql.startsWith('INSERT')) { const columns = /INTO \w+ \(([^)]+)\)/.exec(sql)[1].split(',').map(k => k.trim());
          const expressions = /VALUES \((.*)\)$/.exec(sql)[1].split(',').map(x => x.trim()); let cursor = 0;
          const record = Object.fromEntries(columns.map((column, i) => [column, expressions[i] === '?' ? values[cursor++] : expressions[i] === 'NULL' ? null : expressions[i] === '0' ? 0 : expressions[i] === '1' ? 1 : /^'\w+'$/.test(expressions[i]) ? expressions[i].slice(1,-1) : assert.fail('Unexpected SQL literal')]));
          assert.equal(cursor,values.length);const key=record[columns[0]];assert.ok(!working[table][key],'synthetic unique original key/digest');
          if (table === 'mcp_catalog_goal_adoptions') {
            assert.equal(working.mcp_catalog_goal_intents[record.id].state,'accepted','fixture original accepted intent FK');
            assert.ok(Object.values(working[table]).every(row=>row.oldGoalId !== record.oldGoalId && row.newGoalId !== record.newGoalId),'fixture one original closure/next ID');
          }
          if (table === 'mcp_catalog_goal_history') assert.ok(working.mcp_catalog_goal_adoptions[record.adoptionId],'fixture history RESTRICT receipt FK');
          working[table][key]=record;return 1; }
        if (table === 'mcp_catalog_goal_intents') { const row = working[table][values[3]]; if (!row || f.intentZeroCas || row.revision !== values[4] || row.state !== values[5]) return 0;
          Object.assign(row,{ revision:values[0],state:values[1],decidedAt:values[2] }); return 1; }
        if (table === 'mcp_oauth_browser_consents') { const row = working[table][values[3]]; if (!row || row.revision !== values[4] || row.state !== values[5]) return 0;
          Object.assign(row, { revision: values[0], state: values[1], decidedAt: values[2] }); return 1; }
        if (table === 'mcp_oauth_codes') { const row = working[table][values[1]]; if (!row || row.consumedFamilyId !== null) return 0; row.consumedFamilyId = values[0]; return 1; }
        throw new Error('Unexpected synthetic SQL write');
      },
    };
    if (f.catalogComposition) {
      tx.aiScope = { findFirst: async () => ({ id: 'scope-a', ...source('apps/api/src/modules/ai-native/persistence-scope.ts').aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) }) };
      tx.rentalItemGroup = { findMany: async args => {
        assert.equal(nested, false); f.transactionEvents.push(['catalog', transactionId, args.take]);
        assert.equal(args.where.tenantId, 'tenant-a'); assert.equal(args.where.workspaceId, 'workspace-a'); assert.ok(args.take <= 51);
        if (f.failCatalog) throw Error('explicit database read failure');
        await f.afterCatalog?.(); return structuredClone(f.catalogRows.filter(row => !args.where.name || row.name === args.where.name).slice(0,args.take));
      } };
      if (nested) for (const key of Object.keys(original.tx)) tx[key] = new Proxy({}, { get() { throw Error('budget attempted original identity delegate'); } });
    }
    f.native = tx; f.pendingAudit = audit;
    try {
      const value = await transactionContext.run({ native: tx }, () => callback(tx));
      // Explicit fixture commit merges ONLY changed rows. A disjoint nested budget
      // commit must not be overwritten by the later read-only Auth transaction.
      const changes = [];
      for (const [table, rows] of Object.entries(working)) for (const [key, row] of Object.entries(rows)) {
        if (JSON.stringify(row) === JSON.stringify(baseline[table][key])) continue;
        assert.deepEqual(f.state[table][key], baseline[table][key], 'fixture concurrent same-row write is not silently merged');
        changes.push([table,key,row]);
      }
      for (const [table,key,row] of changes) f.state[table][key] = row;
      f.audits.push(...audit); f.auditRows.push(...auditRows); f.cancelCommit?.abort();
      f.transactionEvents?.push(['commit', transactionId, nested ? 'budget' : 'original']);
      if (nested) await f.afterBudgetCommit?.();
      if (f.loseAdoptionCommitOnce && changes.some(([table])=>table === 'mcp_catalog_goal_adoptions')) { f.loseAdoptionCommitOnce=false;throw Error('explicit adoption commit response lost'); }
      if (f.loseIntentCommitOnce && changes.some(([table]) => table === 'mcp_catalog_goal_intents')) { f.loseIntentCommitOnce = false; throw Error('explicit intent commit response lost'); }
      if (f.loseCommit || f.losePreparedCommitOnce && audit.some(row => row.stage === 'prepared')) { f.losePreparedCommitOnce = false; throw new Error('private lost-commit fixture'); }
      return value;
    } finally { f.native = parent?.native ?? tx; release(); }
  } };
  const { PlatformService } = source('apps/api/src/modules/platform/platform.service.ts');
  original.platform.getAuthSession = (...args) => PlatformService.prototype.getAuthSession.call(original.platform, ...args);
  f.bearer = original.auth.signAccessToken({ sub: 'user-a', tid: 'tenant-a', sid: session.id, wid: session.currentWorkspaceId, aud: 'operator', iat: now, exp: now + 900 });
  f.browser = () => new Request(authorizationEndpoint, { headers: { authorization: 'Bearer ' + f.bearer } });
  f.post = (prepared, decision = 'approve', options = {}) => new Request(consentEndpoint, { method: 'POST', headers: { authorization: 'Bearer ' + f.bearer, origin: 'https://as.example.invalid', 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded', ...options.headers },
    body: options.body ?? new URLSearchParams({ authorizationId: prepared.authorizationId, expectedRevision: '1', decision, nonce: prepared.nonce }).toString() });
  const { OperationLogService } = source('apps/api/src/common/operation-log.service.ts');
  const { createOriginalMcpOAuthAudit } = source('apps/api/src/modules/auth/original-mcp-oauth-audit.ts');
  f.originalLogs = new OperationLogService({ operationLog: { create() { throw new Error('Global audit fallback forbidden'); } } });
  f.oauthAudit = createOriginalMcpOAuthAudit(f.originalLogs);
  f.store = api.createPrismaOAuthStore(f.database, { record: f.oauthAudit.code });
  f.registry = api.createPrismaPublicClientRegistry(f.database);
  f.admissions = api.createPrismaOAuthAdmissionReader({ resourceUrl: resource });
  const { createOriginalMcpBrowserIdentity } = source('apps/api/src/modules/auth/original-mcp-browser-identity.ts'), { createOriginalMcpGrantIdentity } = source('apps/api/src/modules/auth/original-mcp-grant-identity.ts');
  f.browserIdentity = createOriginalMcpBrowserIdentity(original.auth); f.identity = createOriginalMcpGrantIdentity(original.auth);
  f.review = api.createPrismaOAuthConsentReview({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, f.identity, f.verification = {
    current: async (principal, input, policyHash, authorizationHash, tx) => { assert.equal(tx, f.native); if (!f.notice) return undefined;
      return { method: f.notice.verification.kind === 'satisfied' ? 'mfa' : 'unknown', reference: f.notice.verification.reference, revision: f.notice.verification.revision,
        expiresAt: f.notice.verification.expiresAt, userId: principal.userId, tenantId: principal.tenantId, workspaceId: principal.workspaceId,
        sessionId: principal.sessionId, resource, policyHash, authorizationHash }; },
  });
  f.policy = { current: f.review.current, audit: f.oauthAudit.consent, auditGrant: f.oauthAudit.grant };
  f.web = api.createPrismaOAuthWebConsent({ authorizationEndpoint, consentEndpoint, resourceUrl: resource, allowedScopes: scopes }, f.store, f.registry, f.admissions, f.browserIdentity, f.policy);
  f.authority = api.createPrismaOAuthConsentAuthority({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, f.store, f.registry, f.admissions, f.identity, f.web.source);
  f.codes = api.createPersistentOAuthAuthorization({ enabled: true, resourceUrl: resource, allowedScopes: scopes, codeTtlSeconds: 60 }, f.store, f.authority);
  f.prepare = () => f.web.prepare(input, f.browser(), signal()); f.authorize = () => f.codes.authorize(input, f.browser(), signal());
  return f;
}

test('original catalog goal adoption closes once under trusted Web nonce preserves old ledger and resumes a new original frontier',async()=>{
  const api=await compiled();
  const make=async()=>{
    const f=fixture(api);f.catalogComposition=true;f.sqlEvents=[];f.transactionEvents=[];f.catalogRows=[];
    for(const table of ['mcp_read_catalog_goals','mcp_read_target_bindings','mcp_read_goal_budgets','mcp_read_calls'])f.state[table]={};
    const consent=await f.prepare();await f.web.decide(f.post(consent),signal());const issued=await f.authorize();
    const grantAuthority=api.createPrismaOAuthGrantAuthority({ enabled:true,resourceUrl:resource,allowedScopes:scopes },f.store,f.registry,f.identity);
    const tokens=api.createPersistentOAuthTokenService({ enabled:true,resourceUrl:resource,allowedScopes:scopes,accessTtlSeconds:60,refreshTtlSeconds:100 },f.store,grantAuthority.issuance);
    const token=await tokens.exchangeCode({ clientId:'client-a',clientRevision:1,resource,code:issued.code,codeVerifier:verifier,redirectUri:f.input.redirectUri },signal());
    const auth={ subject:f.notice.subject,clientId:'client-a',resource,scopes,token:token.access_token },original={ store:f.store,grantAuthority },context=createOriginalMcpCatalogReadContext();
    const goal=source('apps/api/src/modules/auth/original-mcp-catalog-goals.ts').createOriginalMcpCatalogGoals(api,{ enabled:true },context,f.originalLogs);
    const name=api.MCP_BUSINESS_CAPABILITIES.find(row=>row.code==='rental.catalog.search').name;
    const catalog=createOriginalMcpCatalogReadAuthority(api,{ enabled:true,resourceUrl:resource,allowedScopes:scopes },original,f.original.auth,f.original.guard,context,goal.preparation);
    let verificationAvailable=true;
    // Explicit applicable-verification fixture, not real MFA/human UI evidence.
    const verification={ async current(native,p,g,operationKey,nextInputHash,stop) { assert.equal(native,f.native);if(!verificationAvailable)return undefined;
      return { kind:'satisfied',reference:'original-adoption-verification',revision:1,expiresAt:Math.floor(f.session.expiresAt.getTime()/1000),userId:p.userId,tenantId:p.tenantId,workspaceId:p.workspaceId,sessionId:p.sessionId,operationKey,goalRecordHash:g.recordHash,nextInputHash }; } };
    const authority=source('apps/api/src/modules/auth/original-mcp-catalog-goal-intent-authority.ts').createOriginalMcpCatalogGoalIntentAuthority(api,{ requiredToolScopes:scopes,allowedScopes:scopes },original,f.original.auth,f.original.guard,f.originalLogs,verification);
    const base='https://as.example.invalid/catalog-adoption',config={ prepareEndpoint:base+'/prepare',decideEndpoint:base+'/decide',receiptEndpoint:base+'/receipt',adoptEndpoint:base+'/adopt' },intents=api.createPrismaMcpCatalogGoalIntents(config,authority);
    const post=(path,value,headers={})=>new Request(path,{ method:'POST',headers:{ authorization:'Bearer '+f.bearer,origin:'https://as.example.invalid','sec-fetch-site':'same-origin','content-type':'application/json',...headers },body:JSON.stringify(value) });
    const browser=()=>new Request(config.receiptEndpoint,{ headers:{ authorization:'Bearer '+f.bearer } });
    const prepare=async(operationKey='original-adoption-key',nextInput={ limit:2,name:'Camera' })=>({ ...await intents.prepare(post(config.prepareEndpoint,{ operationKey,nextInput }),signal()),nextInput });
    const decide=draft=>intents.decide(post(config.decideEndpoint,{ operationKey:draft.operationKey,expectedRevision:1,decision:'accept',nonce:draft.nonce }),draft.nextInput,signal());
    const adopt=draft=>intents.adopt(post(config.adoptEndpoint,{ operationKey:draft.operationKey,nextInput:draft.nextInput,expectedRevision:2,nonce:draft.nonce }),signal());
    const read=(input={ limit:2 },consume=async()=> 'explicit original catalog callback fixture',stop=signal())=>catalog.withRead(auth,name,input,()=>api.createPrismaMcpReadAccounting(f.database,goal.source).withCall(auth,name,input,consume,stop),stop);
    const history=goalId=>authority.withOwner(browser(),signal(),async(p,native,stop)=>{ const g=await authority.adoption.readHistoricalIn(goalId,native,stop);assert.equal(g.owner.userId,p.userId);return g; });
    await catalog.withRead(auth,name,{ limit:2 },async()=> 'original preparation only',signal());
    return { f,authority,intents,original,verificationSource:verification,post,config,browser,prepare,decide,adopt,read,history,verification(value){ verificationAvailable=value; } };
  };
  const h=await make();await h.read();const originalRow=structuredClone(Object.values(h.f.state.mcp_read_catalog_goals)[0]),oldGoalId=originalRow.goalId;
  const oldLedger=structuredClone({ budgets:h.f.state.mcp_read_goal_budgets,calls:h.f.state.mcp_read_calls,bindings:h.f.state.mcp_read_target_bindings }),oldAudits=structuredClone(h.f.auditRows);
  const first=await h.prepare(),other=await h.prepare('second-intent-for-same-original-goal',{ limit:2,name:'Lens' });await h.decide(first);await h.decide(other);
  assert.equal(Object.values(h.f.state.mcp_read_catalog_goals)[0].goalId,oldGoalId,'accepting an intent alone never adopts');
  const result=await h.adopt(first);assert.equal(result.state,'observed');assert.equal(result.closedGoalId,oldGoalId);assert.notEqual(result.adoptedGoalId,oldGoalId);assert.equal(result.observation,'catalog_frontier_transition_not_business_completion');
  assert.deepEqual({ budgets:h.f.state.mcp_read_goal_budgets,calls:h.f.state.mcp_read_calls,bindings:h.f.state.mcp_read_target_bindings },oldLedger,'no old counter/call/binding is reset/refunded/deleted');
  for(const audit of oldAudits)assert.ok(h.f.auditRows.some(row=>row.id===audit.id&&JSON.stringify(row)===JSON.stringify(audit)),'original audit survives');
  const archived=await h.history(oldGoalId);assert.equal(archived.recordHash,originalRow.recordHash);assert.deepEqual(archived.target,JSON.parse(originalRow.recordJson).target);
  const preserved=structuredClone(h.f.state),events=structuredClone(h.f.auditRows);assert.deepEqual(await h.adopt(first),result);assert.deepEqual(h.f.state,preserved);assert.deepEqual(h.f.auditRows,events,'duplicate POST observes the original receipt only');
  await assert.rejects(h.adopt(other));assert.deepEqual(h.f.state,preserved,'second old-goal intent cannot create another next goal');
  await h.read(first.nextInput);assert.equal(h.f.state.mcp_read_goal_budgets[result.adoptedGoalId].consumedCalls,1);assert.deepEqual(h.f.state.mcp_read_goal_budgets[oldGoalId],oldLedger.budgets[oldGoalId]);
  const second=await h.prepare('legitimate-second-adoption',{ limit:2,name:'Lens' });await h.decide(second);const next=await h.adopt(second);assert.notEqual(next.adoptedGoalId,result.adoptedGoalId);
  assert.equal(Object.keys(h.f.state.mcp_catalog_goal_history).length,2);assert.equal((await h.intents.receipt(first.operationKey,h.browser(),signal())).adoption.adoptedGoalId,result.adoptedGoalId,'historical receipt is not the latest/current frontier');
  const firstHistory=h.f.state.mcp_catalog_goal_history[oldGoalId];delete h.f.state.mcp_catalog_goal_history[oldGoalId];await assert.rejects(h.intents.receipt(first.operationKey,h.browser(),signal()));h.f.state.mcp_catalog_goal_history[oldGoalId]=firstHistory;
  const adoptionEvent=h.f.auditRows.find(row=>row.action==='mcp.read.goal.adopted'&&row.detail.metadata.oldGoalId===oldGoalId),auditIndex=h.f.auditRows.indexOf(adoptionEvent);h.f.auditRows.splice(auditIndex,1);
  const auditCount=h.f.auditRows.length;await assert.rejects(h.intents.receipt(first.operationKey,h.browser(),signal()));assert.equal(h.f.auditRows.length,auditCount,'missing adoption audit is not repaired');h.f.auditRows.splice(auditIndex,0,adoptionEvent);
  const spent=await make();for(let i=0;i<20;i++)await spent.read();await assert.rejects(spent.read());const spentId=Object.values(spent.f.state.mcp_read_catalog_goals)[0].goalId,spentBudget=structuredClone(spent.f.state.mcp_read_goal_budgets[spentId]);
  const spentIntent=await spent.prepare();await spent.decide(spentIntent);const fresh=await spent.adopt(spentIntent);assert.equal(spent.f.state.mcp_read_goal_budgets[spentId].consumedCalls,20);assert.deepEqual(spent.f.state.mcp_read_goal_budgets[spentId],spentBudget);
  await spent.read(spentIntent.nextInput);assert.equal(spent.f.state.mcp_read_goal_budgets[fresh.adoptedGoalId].consumedCalls,1,'only trusted adoption establishes a new independently metered goal');
  const pending=await make(),cancel=new AbortController();await assert.rejects(pending.read({ limit:2 },async()=>{ cancel.abort();return 'late original callback'; },cancel.signal));
  const pendingIntent=await pending.prepare();await pending.decide(pendingIntent);const held=structuredClone(pending.f.state);await assert.rejects(pending.adopt(pendingIntent));assert.deepEqual(pending.f.state,held,'reserved/unknown original calls block adoption and keep holds');
  const missing=await make();const emptyIntent=await missing.prepare();await missing.decide(emptyIntent);const emptyState=structuredClone(missing.f.state);await assert.rejects(missing.adopt(emptyIntent));assert.deepEqual(missing.f.state,emptyState,'no budget is not proof of no consumption');
  const corrupt=await make();await corrupt.read();const corruptIntent=await corrupt.prepare();await corrupt.decide(corruptIntent);delete corrupt.f.state.mcp_read_calls[Object.keys(corrupt.f.state.mcp_read_calls)[0]];const broken=structuredClone(corrupt.f.state);await assert.rejects(corrupt.adopt(corruptIntent));assert.deepEqual(corrupt.f.state,broken);
  const failed=await make();await failed.read();const failIntent=await failed.prepare();await failed.decide(failIntent);const beforeFailure=structuredClone(failed.f.state);
  failed.f.adoptionZeroCas=true;await assert.rejects(failed.adopt(failIntent));failed.f.adoptionZeroCas=false;assert.deepEqual(failed.f.state,beforeFailure,'history/receipt rollback with failed frontier CAS');
  failed.f.failAudit=true;await assert.rejects(failed.adopt(failIntent));failed.f.failAudit=false;assert.deepEqual(failed.f.state,beforeFailure,'admission/adoption audit failure rolls the whole slice back');
  failed.verification(false);await assert.rejects(failed.adopt(failIntent));failed.verification(true);assert.deepEqual(failed.f.state,beforeFailure);
  const permissions=failed.f.original.member.role.permissions;failed.f.afterGoalAudit=async row=>{ if(row.action==='mcp.read.goal.adopted')failed.f.original.member.role.permissions=[]; };
  await assert.rejects(failed.adopt(failIntent));failed.f.afterGoalAudit=undefined;failed.f.original.member.role.permissions=permissions;assert.deepEqual(failed.f.state,beforeFailure,'late original Guard loss denies pointer adoption');
  failed.f.missingAdoptionSchema=true;await assert.rejects(failed.adopt(failIntent));failed.f.missingAdoptionSchema=false;assert.deepEqual(failed.f.state,beforeFailure);
  const unknown=await make();await unknown.read();const unknownIntent=await unknown.prepare();await unknown.decide(unknownIntent);unknown.f.loseAdoptionCommitOnce=true;await assert.rejects(unknown.adopt(unknownIntent),error=>error.kind==='unknown');
  const originalUnknown=structuredClone(unknown.f.state),unknownReceipt=await unknown.intents.receipt(unknownIntent.operationKey,unknown.browser(),signal());assert.equal(unknownReceipt.adoption.state,'observed');assert.deepEqual(unknown.f.state,originalUnknown);assert.deepEqual(await unknown.adopt(unknownIntent),unknownReceipt.adoption);assert.deepEqual(unknown.f.state,originalUnknown,'lost answer never adopts another UUID');
  const beforeBad=unknown.f.transactions;await assert.rejects(unknown.intents.adopt(unknown.post(unknown.config.adoptEndpoint,{ operationKey:unknownIntent.operationKey,nextInput:unknownIntent.nextInput,expectedRevision:2,nonce:unknownIntent.nonce,actor:'self' }),signal()));
  await assert.rejects(unknown.intents.adopt(unknown.post(unknown.config.adoptEndpoint,{ operationKey:unknownIntent.operationKey,nextInput:unknownIntent.nextInput,expectedRevision:2,nonce:unknownIntent.nonce },{ origin:'https://evil.example.invalid' }),signal()));assert.equal(unknown.f.transactions,beforeBad);
  assert.throws(()=>api.createPrismaMcpCatalogGoalIntents(unknown.config,{ withCurrent:unknown.authority.withCurrent,withOwner:unknown.authority.withOwner,audit:unknown.authority.audit }),'missing original transition path never falls back to intent authority');
  // HTTP goal control uses the ACTUAL original host/Core. Identity/goal setup
  // above and SQL/MFA remain fixtures; no listener or real external HTTP runs.
  const web=await make();await web.read();const OriginalPlatform=source('apps/api/src/modules/platform/platform.service.ts').PlatformService;
  web.f.original.platform.assertTrustedWorkspaceIntegrationManagement=(...args)=>OriginalPlatform.prototype.assertTrustedWorkspaceIntegrationManagement.call(web.f.original.platform,...args);
  web.f.original.platform.assertTrustedWorkspaceSubjectManagement=(...args)=>OriginalPlatform.prototype.assertTrustedWorkspaceSubjectManagement.call(web.f.original.platform,...args);
  const issuer='https://as.example.invalid/',tokenEndpoint=issuer+'token',revocationEndpoint=issuer+'revoke',admin=issuer+'governance';
  const service={ enabled:true,resource:{ resourceUrl:resource,authorizationServerUrl:issuer,allowedOrigins:[issuer],maxRequestBytes:65536,authorizationTimeoutMs:5000 },
    authorization:{ issuer,authorizationEndpoint,tokenEndpoint,revocationEndpoint,allowedScopes:scopes,allowedOrigins:[issuer],timeoutMs:5000,maxMetadataBytes:65536 },
    tokens:{ tokenEndpoint,revocationEndpoint,resourceUrl:resource,allowedScopes:scopes,allowedOrigins:[issuer],timeoutMs:5000,maxRequestBytes:4096 },lifetimes:{ codeTtlSeconds:60,accessTtlSeconds:60,refreshTtlSeconds:100 } };
  const common={ enabled:true,resourceUrl:resource,requestTimeoutMs:5000,maxResponseBytes:65536 },goalConfig={ ...common,...web.config,allowedScopes:scopes,requiredToolScopes:scopes };
  const cfg={ core:{ consentEndpoint,service },consent:{ ...common,authorizationEndpoint,allowedScopes:scopes,prepareEndpoint:issuer+'consent/prepare',decisionEndpoint:consentEndpoint,receiptEndpoint:issuer+'consent/receipt' },
    review:{ enabled:true,requestTimeoutMs:5000,maxResponseBytes:65536,client:{ prepareEndpoint:admin+'/review/client/prepare',decisionEndpoint:admin+'/review/client/decide',receiptEndpoint:admin+'/review/client/receipt',allowedScopes:scopes,policyRevision:1,actionTtlSeconds:90,maxReviewLifetimeSeconds:900 },notice:{ resourceUrl:resource,prepareEndpoint:admin+'/review/notice/prepare',decisionEndpoint:admin+'/review/notice/decide',receiptEndpoint:admin+'/review/notice/receipt',policyRevision:1,actionTtlSeconds:90,maxReviewLifetimeSeconds:900 } },
    grant:{ ...common,listEndpoint:admin+'/grant/list',summaryEndpoint:admin+'/grant/read',revocationEndpoint:admin+'/grant/revoke',receiptEndpoint:admin+'/grant/receipt' },
    admission:{ ...common,allowedScopes:scopes,readEndpoint:admin+'/admission/read',saveEndpoint:admin+'/admission/save',receiptEndpoint:admin+'/admission/receipt' },
    governance:{ ...common,client:{ readEndpoint:admin+'/client/read',saveEndpoint:admin+'/client/save',receiptEndpoint:admin+'/client/receipt' },notice:{ readEndpoint:admin+'/notice/read',saveEndpoint:admin+'/notice/save',receiptEndpoint:admin+'/notice/receipt' } },
    subject:{ ...common,readEndpoint:admin+'/subject/read',saveEndpoint:admin+'/subject/save',receiptEndpoint:admin+'/subject/receipt' },catalogGoal:goalConfig };
  const metadata={ read:async()=>({ issuer,authorization_endpoint:authorizationEndpoint,token_endpoint:tokenEndpoint,revocation_endpoint:revocationEndpoint,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],scopes_supported:scopes }) };
  const deps={ database:web.f.database,metadata,verification:web.f.verification,catalogGoal:{ guard:web.f.original.guard,verification:web.verificationSource } };
  const host=createOriginalMcpHost(api,cfg,web.f.original.auth,web.f.original.platform,web.f.originalLogs,deps);
  assert.equal((await host.fetch(new Request(goalConfig.prepareEndpoint))).status,405);assert.equal((await host.fetch(new Request(goalConfig.receiptEndpoint+'?operationKey=http-key'))).status,403);
  const input={ limit:2,name:'Camera' },key='original-http-goal';
  const prep=await host.fetch(web.post(goalConfig.prepareEndpoint,{ operationKey:key,nextInput:input }));assert.equal(prep.status,200);assert.equal(prep.headers.get('cache-control'),'no-store');const d=await prep.json();assert.equal(d.state,'prepared');
  const decision=await host.fetch(web.post(goalConfig.decideEndpoint,{ operationKey:key,nextInput:input,expectedRevision:1,decision:'accept',nonce:d.nonce }));assert.equal(decision.status,200);assert.equal((await decision.json()).decision,'accepted');
  const adopted=await host.fetch(web.post(goalConfig.adoptEndpoint,{ operationKey:key,nextInput:input,expectedRevision:2,nonce:d.nonce }));assert.equal(adopted.status,200);const a=await adopted.json();assert.equal(a.state,'observed');
  const get=()=>host.fetch(new Request(goalConfig.receiptEndpoint+'?'+new URLSearchParams({ operationKey:key }),{ headers:{ authorization:'Bearer '+web.f.bearer } }));
  const receiptResponse=await get();assert.equal(receiptResponse.status,200);assert.deepEqual((await receiptResponse.json()).adoption,a);assert.equal(web.f.state.mcp_read_goal_budgets[a.closedGoalId].consumedCalls,1);
  assert.equal((await host.fetch(web.post(goalConfig.decideEndpoint,{ operationKey:key,nextInput:input,expectedRevision:1,decision:'accept',nonce:d.nonce,actor:'self' }))).status,400);
  assert.equal((await host.fetch(web.post(goalConfig.prepareEndpoint,{ operationKey:'bad-origin',nextInput:input },{ origin:'https://evil.example.invalid' }))).status,403);
  assert.equal((await host.fetch(new Request(goalConfig.receiptEndpoint+'?operationKey='+key+'&operationKey=duplicate',{ headers:{ authorization:'Bearer '+web.f.bearer } }))).status,400);
  const unavailable=createOriginalMcpHost(api,cfg,web.f.original.auth,web.f.original.platform,web.f.originalLogs,{ database:web.f.database,metadata,verification:web.f.verification });
  assert.equal((await unavailable.fetch(web.post(goalConfig.prepareEndpoint,{ operationKey:'missing-source',nextInput:input }))).status,503,'absent goal verification/Guard source never succeeds');await unavailable.close();
  assert.throws(()=>createOriginalMcpHost(api,{ ...cfg,catalogGoal:{ ...goalConfig,resourceUrl:'https://other.example.invalid/mcp' } },web.f.original.auth,web.f.original.platform,web.f.originalLogs,deps),/pins/);
  await web.read(input);const lost=await web.prepare('http-unknown-adoption',input);await web.decide(lost);web.f.loseAdoptionCommitOnce=true;
  const lostResponse=await host.fetch(web.post(goalConfig.adoptEndpoint,{ operationKey:lost.operationKey,nextInput:input,expectedRevision:2,nonce:lost.nonce }));assert.equal(lostResponse.status,503);assert.equal((await lostResponse.json()).error,'goal_unknown');
  const recovered=await host.fetch(new Request(goalConfig.receiptEndpoint+'?operationKey='+lost.operationKey,{ headers:{ authorization:'Bearer '+web.f.bearer } }));assert.equal(recovered.status,200);assert.equal((await recovered.json()).adoption.state,'observed');
  await web.read(input);const heldIntent=await web.prepare('http-close-pending',input);await web.decide(heldIntent);
  const short=source('apps/api/src/modules/auth/original-mcp-catalog-goal-control-plane.ts').createOriginalMcpCatalogGoalControlPlane(api,{ ...goalConfig,requestTimeoutMs:100 },web.original,web.f.original.auth,web.f.original.guard,web.f.originalLogs,web.verificationSource);
  let started,release;const entered=new Promise(resolve=>{ started=resolve; }),gate=new Promise(resolve=>{ release=resolve; });
  web.f.afterGoalAudit=async row=>{ if(row.action==='mcp.read.goal.adopted'){ started();await gate; } };
  const waiting=short.fetch(web.post(goalConfig.adoptEndpoint,{ operationKey:heldIntent.operationKey,nextInput:input,expectedRevision:2,nonce:heldIntent.nonce }));await entered;
  const timed=await waiting;assert.equal(timed.status,503);assert.equal((await timed.json()).error,'goal_unknown');let closed=false;const closing=short.close().then(()=>{ closed=true; });await Promise.resolve();assert.equal(closed,false,'close waits for original ignored-cancellation work, not just HTTP answer');release();await closing;web.f.afterGoalAudit=undefined;
  const afterClose=await short.fetch(web.post(goalConfig.prepareEndpoint,{ operationKey:'closed',nextInput:input }));assert.equal(afterClose.status,503);assert.equal((await afterClose.json()).error,'goal_closed');
  await host.close();assert.equal((await get()).status,503,'original host closes the configured goal component');
});

test('original catalog goal transition intent binds trusted Web nonce original goal input policy and history without adoption',async()=>{
  const api=await compiled(),f=fixture(api);f.catalogComposition=true;f.sqlEvents=[];f.transactionEvents=[];f.catalogRows=[];
  for(const table of ['mcp_read_catalog_goals','mcp_read_target_bindings','mcp_read_goal_budgets','mcp_read_calls'])f.state[table]={};
  const preparedConsent=await f.prepare();await f.web.decide(f.post(preparedConsent),signal());const issued=await f.authorize();
  const grantAuthority=api.createPrismaOAuthGrantAuthority({ enabled:true,resourceUrl:resource,allowedScopes:scopes },f.store,f.registry,f.identity);
  const tokens=api.createPersistentOAuthTokenService({ enabled:true,resourceUrl:resource,allowedScopes:scopes,accessTtlSeconds:60,refreshTtlSeconds:100 },f.store,grantAuthority.issuance);
  const token=await tokens.exchangeCode({ clientId:'client-a',clientRevision:1,resource,code:issued.code,codeVerifier:verifier,redirectUri:f.input.redirectUri },signal());
  const auth={ subject:f.notice.subject,clientId:'client-a',resource,scopes,token:token.access_token },original={ store:f.store,grantAuthority };
  const context=createOriginalMcpCatalogReadContext(),goal=source('apps/api/src/modules/auth/original-mcp-catalog-goals.ts').createOriginalMcpCatalogGoals(api,{ enabled:true },context,f.originalLogs);
  const name=api.MCP_BUSINESS_CAPABILITIES.find(row=>row.code==='rental.catalog.search').name;
  const catalog=createOriginalMcpCatalogReadAuthority(api,{ enabled:true,resourceUrl:resource,allowedScopes:scopes },original,f.original.auth,f.original.guard,context,goal.preparation);
  await catalog.withRead(auth,name,{ limit:2 },async()=> 'authorization-only observation',signal());
  const createAuthority=source('apps/api/src/modules/auth/original-mcp-catalog-goal-intent-authority.ts').createOriginalMcpCatalogGoalIntentAuthority;
  let verificationAvailable=true,verificationRevision=1;
  // Explicit external original applicability/MFA evidence fixture. Never a
  // production bypass or an assertion that this test exercised real human/MFA UI.
  const verification={ async current(native,p,g,operationKey,nextInputHash,stop) { assert.equal(native,f.native);assert.equal(stop.aborted,false);if(!verificationAvailable)return undefined;
    return { kind:'satisfied',reference:'original-intent-verification',revision:verificationRevision,expiresAt:Math.floor(f.session.expiresAt.getTime()/1000),userId:p.userId,tenantId:p.tenantId,workspaceId:p.workspaceId,sessionId:p.sessionId,operationKey,goalRecordHash:g.recordHash,nextInputHash }; } };
  const authority=createAuthority(api,{ requiredToolScopes:scopes,allowedScopes:scopes },original,f.original.auth,f.original.guard,f.originalLogs,verification);
  const base='https://as.example.invalid/catalog-goal-intent',config={ prepareEndpoint:base+'/prepare',decideEndpoint:base+'/decide',receiptEndpoint:base+'/receipt' };
  const intents=api.createPrismaMcpCatalogGoalIntents(config,authority),nextInput={ limit:2,name:'Camera' },operationKey='original-next-goal-intent';
  const post=(path,value,headers={})=>new Request(path,{ method:'POST',headers:{ authorization:'Bearer '+f.bearer,origin:'https://as.example.invalid','sec-fetch-site':'same-origin','content-type':'application/json',...headers },body:JSON.stringify(value) });
  const prepare=(key=operationKey,input=nextInput)=>intents.prepare(post(config.prepareEndpoint,{ operationKey:key,nextInput:input }),signal());
  const readBrowser=()=>new Request(config.receiptEndpoint,{ headers:{ authorization:'Bearer '+f.bearer } });
  const decide=(draft,decision='accept')=>intents.decide(post(config.decideEndpoint,{ operationKey:draft.operationKey,expectedRevision:1,decision,nonce:draft.nonce }),nextInput,signal());
  const preserved=structuredClone(Object.fromEntries(Object.entries(f.state).filter(([table])=>table!=='mcp_catalog_goal_intents'))),oldGoal=Object.values(f.state.mcp_read_catalog_goals)[0];
  const draft=await prepare();assert.equal(draft.state,'prepared');assert.match(draft.nonce,/^[A-Za-z0-9_-]{43}$/);assert.equal(draft.goalId,oldGoal.goalId);
  assert.equal(Object.keys(f.state.mcp_catalog_goal_intents).length,1);assert.doesNotMatch(JSON.stringify(f.state.mcp_catalog_goal_intents),new RegExp(draft.nonce+'|'+f.bearer+'|'+token.access_token+'|Camera'));
  const repeated=await prepare();assert.equal(repeated.state,'observed');assert.equal(repeated.decision,'pending');assert.equal(Object.hasOwn(repeated,'nonce'),false);
  await assert.rejects(intents.source.withAccepted(operationKey,nextInput,readBrowser(),signal(),async()=> 'not permitted'),'pending intent is not accepted evidence');
  const done=await decide(draft);assert.equal(done.decision,'accepted');const before=structuredClone(f.state),auditBefore=structuredClone(f.auditRows);
  assert.deepEqual(await decide(draft),done);assert.deepEqual(f.auditRows,auditBefore,'same original intent does not repeat audit');assert.deepEqual(f.state,before);
  let accepted=0,originalCallbackSignal;assert.equal(await intents.source.withAccepted(operationKey,nextInput,readBrowser(),signal(),async(intent,g,native,stop)=>{
    originalCallbackSignal=stop;accepted++;assert.equal(g.target.goalId,oldGoal.goalId);assert.equal(native,f.native);assert.equal(stop.aborted,false);assert.equal(intent.observation,'trusted_web_intent_not_goal_completion_or_adoption');assert.equal(Object.hasOwn(intent,'nonce'),false);assert.equal(Object.isFrozen(intent),true);return 'original intent only';
  }),'original intent only');assert.equal(accepted,1);assert.equal(originalCallbackSignal.aborted,true,'original evidence callback signal ends with its lifetime');assert.deepEqual(f.state,before,'observations do not close goals reset calls or adopt');
  assert.deepEqual(Object.fromEntries(Object.entries(f.state).filter(([table])=>table!=='mcp_catalog_goal_intents')),preserved);
  await assert.rejects(prepare(operationKey,{ limit:3 }));await assert.rejects(decide(draft,'deny'));await assert.rejects(decide({ ...draft,nonce:Buffer.alloc(32,9).toString('base64url') }));
  const denyDraft=await prepare('original-denied-goal-intent');assert.equal((await decide(denyDraft,'deny')).decision,'denied');
  await assert.rejects(intents.source.withAccepted(denyDraft.operationKey,nextInput,readBrowser(),signal(),async()=> 'not permitted'));
  const safeHistory=await intents.receipt(operationKey,readBrowser(),signal());assert.equal(safeHistory.decision,'accepted');assert.doesNotMatch(JSON.stringify(safeHistory),/nonce|subject|grantId|recordHash|nextInputHash/);
  verificationAvailable=false;await assert.rejects(prepare('missing-original-verification'));assert.deepEqual(await intents.receipt(operationKey,readBrowser(),signal()),safeHistory);verificationAvailable=true;
  verificationRevision++;await assert.rejects(intents.source.withAccepted(operationKey,nextInput,readBrowser(),signal(),async()=> 'not permitted'));verificationRevision--;
  const key=Object.keys(f.state.mcp_catalog_goal_intents).find(k=>f.state.mcp_catalog_goal_intents[k].operationKey===operationKey);
  const audit=f.auditRows.find(row=>row.action==='mcp.read.goal.intent.accepted'&&row.detail.targetId===key),index=f.auditRows.indexOf(audit);f.auditRows.splice(index,1);
  await assert.rejects(intents.receipt(operationKey,readBrowser(),signal()));assert.equal(f.auditRows.length,auditBefore.length+2-1,'missing audit is not repaired');f.auditRows.splice(index,0,audit);
  const firstAudit=f.auditRows.find(row=>row.action==='mcp.read.goal.intent.prepared'&&row.detail.targetId===key),firstIndex=f.auditRows.indexOf(firstAudit);f.auditRows.splice(firstIndex,1);
  const countWithoutFirst=f.auditRows.length;await assert.rejects(intents.source.withAccepted(operationKey,nextInput,readBrowser(),signal(),async()=> 'not permitted'));assert.equal(f.auditRows.length,countWithoutFirst);f.auditRows.splice(firstIndex,0,firstAudit);
  const casDraft=await prepare('zero-cas-intent');f.intentZeroCas=true;await assert.rejects(decide(casDraft));f.intentZeroCas=false;assert.equal((await intents.receipt(casDraft.operationKey,readBrowser(),signal())).decision,'pending');
  const permissionsBeforeLate=f.original.member.role.permissions;f.afterGoalAudit=async row=>{ if(row.action==='mcp.read.goal.intent.prepared')f.original.member.role.permissions=[]; };
  await assert.rejects(prepare('late-permission-intent'));f.afterGoalAudit=undefined;f.original.member.role.permissions=permissionsBeforeLate;
  assert.ok(!Object.values(f.state.mcp_catalog_goal_intents).some(row=>row.operationKey==='late-permission-intent'));
  f.intentBusy=true;await assert.rejects(prepare('busy-intent'));f.intentBusy=false;
  f.failAudit=true;await assert.rejects(prepare('failed-intent-audit'));f.failAudit=false;assert.ok(!Object.values(f.state.mcp_catalog_goal_intents).some(row=>row.operationKey==='failed-intent-audit'));
  f.loseIntentCommitOnce=true;await assert.rejects(prepare('unknown-intent-prepare'),error=>error.kind==='unknown');const lost=await prepare('unknown-intent-prepare');assert.equal(lost.state,'observed');assert.equal(Object.hasOwn(lost,'nonce'),false);
  const unknownDecision=await prepare('unknown-intent-decision');f.loseIntentCommitOnce=true;await assert.rejects(decide(unknownDecision),error=>error.kind==='unknown');assert.equal((await intents.receipt(unknownDecision.operationKey,readBrowser(),signal())).decision,'accepted');
  const stale=await prepare('stale-permission-intent'),permissions=f.original.member.role.permissions;f.original.member.role.permissions=[];await assert.rejects(decide(stale));assert.deepEqual(await intents.receipt(operationKey,readBrowser(),signal()),safeHistory);f.original.member.role.permissions=permissions;
  const deniedTransactions=f.transactions;await assert.rejects(intents.prepare(post(config.prepareEndpoint,{ operationKey:'illegal',nextInput,actor:'self' }),signal()));
  await assert.rejects(intents.prepare(post(config.prepareEndpoint,{ operationKey:'illegal',nextInput },{ origin:'https://evil.example.invalid' }),signal()));
  await assert.rejects(intents.prepare(post(config.prepareEndpoint,{ operationKey:'illegal',nextInput },{ cookie:'session=untrusted' }),signal()));assert.equal(f.transactions,deniedTransactions);
  const revokedGrant=Object.values(f.state.mcp_oauth_grants)[0],grant=JSON.parse(revokedGrant.recordJson);revokedGrant.revision++;revokedGrant.recordJson=JSON.stringify({ ...grant,enabled:false,revision:revokedGrant.revision });
  await assert.rejects(prepare('revoked-grant-intent'));assert.deepEqual(await intents.receipt(operationKey,readBrowser(),signal()),safeHistory,'history has independent current Web owner rights');
  f.session.revokedAt=new Date();await assert.rejects(intents.receipt(operationKey,readBrowser(),signal()));
  assert.throws(()=>createAuthority(api,{ requiredToolScopes:[],allowedScopes:scopes },original,f.original.auth,f.original.guard,f.originalLogs,verification));
  assert.throws(()=>api.createPrismaMcpCatalogGoalIntents(config,{ withOwner:authority.withOwner,audit:authority.audit }));
  assert.deepEqual(f.state.mcp_read_goal_budgets,{});assert.deepEqual(f.state.mcp_read_calls,{});assert.equal(Object.keys(f.state.mcp_read_catalog_goals).length,1,'no transition adopts a replacement goal');
});

test('original availability OAuth authority binds dedicated scopes current grant POST Guard and owner Native', async()=>{
  const api=await compiled(),availabilityScope='fixture.availability.read',catalogScope='fixture.catalog.read',allScopes=[availabilityScope,catalogScope],f=fixture(api,allScopes);
  f.original.member.role.permissions=[{ permission:{ code:'rental-os:order:create' } }];
  const issuer='https://as.example.invalid/',tokenEndpoint=issuer+'token',revocationEndpoint=issuer+'revoke';
  const config={ consentEndpoint,service:{ enabled:true,
    resource:{ resourceUrl:resource,authorizationServerUrl:issuer,allowedOrigins:[issuer],maxRequestBytes:65536,authorizationTimeoutMs:5000 },
    authorization:{ issuer,authorizationEndpoint,tokenEndpoint,revocationEndpoint,allowedScopes:allScopes,allowedOrigins:[issuer],timeoutMs:5000,maxMetadataBytes:65536 },
    tokens:{ tokenEndpoint,revocationEndpoint,resourceUrl:resource,allowedScopes:allScopes,allowedOrigins:[issuer],timeoutMs:5000,maxRequestBytes:4096 },
    lifetimes:{ codeTtlSeconds:60,accessTtlSeconds:60,refreshTtlSeconds:100 } } };
  const metadata={ read:async()=>({ issuer,authorization_endpoint:authorizationEndpoint,token_endpoint:tokenEndpoint,revocation_endpoint:revocationEndpoint,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],scopes_supported:allScopes }) };
  const core=createOriginalMcpOAuthCore(api,config,f.original.auth,f.originalLogs,{ database:f.database,metadata,verification:f.verification });
  const issue=async(scope,state)=>{
    const input={ ...f.input,scopes:[scope],state },draft=await core.webConsent.prepare(input,f.browser(),signal());await core.webConsent.decide(f.post(draft),signal());
    const url=authorizationEndpoint+'?'+new URLSearchParams({ response_type:'code',client_id:'client-a',redirect_uri:input.redirectUri,resource,scope,state,code_challenge:challenge,code_challenge_method:'S256' });
    const issued=await core.service.fetch(new Request(url,{ headers:{ authorization:'Bearer '+f.bearer } }));assert.equal(issued.status,303);
    const code=new URL(issued.headers.get('location')).searchParams.get('code'),token=await core.service.fetch(new Request(tokenEndpoint,{ method:'POST',headers:{ 'content-type':'application/x-www-form-urlencoded' },body:new URLSearchParams({ grant_type:'authorization_code',client_id:'client-a',code,code_verifier:verifier,redirect_uri:input.redirectUri,resource }).toString() }));
    assert.equal(token.status,200);return { subject:f.notice.subject,clientId:'client-a',resource,scopes:[scope],token:(await token.json()).access_token };
  };
  const auth=await issue(availabilityScope,'availability-original-request'),catalog=await issue(catalogScope,'catalog-original-request');
  const name=api.MCP_BUSINESS_CAPABILITIES.find(row=>row.code==='rental.availability.check').name,context=createOriginalMcpCatalogReadContext();
  const settings={ enabled:true,resourceUrl:resource,allowedScopes:allScopes,requiredToolScopes:[availabilityScope] },input={ locationId:'loc-a',startAt:'2026-11-07T00:00:00+08:00',endAt:'2026-11-08T00:00:00+08:00',lines:[{ itemGroupId:'group-a',quantity:1 }] };
  const call={ callId:'original-availability-observation',authorization:auth,toolName:name,inputHash:api.captureMcpReadInput(input).inputHash };
  const create=(goals)=>createOriginalMcpAvailabilityReadAuthority(api,settings,core,f.original.auth,f.original.guard,context,goals);
  const authority=create();assert.throws(()=>context.current(call));let reads=0;
  const consume=()=>context.withReadNative(call,signal(),async(native,stop)=>{
    reads++;assert.equal(native,f.native);assert.equal(stop.aborted,false);assert.equal(native.originalMarker,'original');
    const current=context.current(call);assert.equal(current.userId,'user-a');assert.equal(current.tenantId,'tenant-a');assert.equal(current.workspaceId,'workspace-a');
    assert.ok(current.permissions.includes('rental-os:order:create'));assert.equal(Object.hasOwn(current,'native'),false);assert.equal(Object.hasOwn(current,'token'),false);
    return 'original-owner-observation';
  });
  const start=f.transactions;assert.equal(await authority.withRead(auth,name,input,consume,signal()),'original-owner-observation');assert.equal(f.transactions,start+1,'one original read transaction, no Web/native fallback');assert.equal(reads,1);assert.throws(()=>context.current(call));
  await assert.rejects(()=>authority.withRead(catalog,name,input,consume,signal()));assert.equal(reads,1,'catalog scope cannot enter availability');
  await assert.rejects(()=>authority.withRead({ ...auth,token:f.bearer },name,input,consume,signal()));assert.equal(reads,1,'Web credential is not an MCP access credential');
  for(const value of [{ ...auth,subject:'other-subject' },{ ...auth,clientId:'other-client' },{ ...auth,resource:'https://other.example.invalid/mcp' }])await assert.rejects(()=>authority.withRead(value,name,input,consume,signal()));
  assert.equal(reads,1);await assert.rejects(()=>authority.withRead(auth,'rental_catalog_search',input,consume,signal()));
  const beforeInvalid=f.transactions;
  await assert.rejects(()=>authority.withRead(auth,name,{ ...input,actor:'self-authorized' },consume,signal()));
  await assert.rejects(()=>authority.withRead(auth,name,{ ...input,lines:Array.from({ length:51 },()=>input.lines[0]) },consume,signal()));assert.equal(f.transactions,beforeInvalid,'invalid full input never enters original authorization');
  await assert.rejects(()=>authority.withRead(auth,name,{ ...input,locationId:'loc-b' },consume,signal()));assert.equal(reads,1,'selected location remains original Guard data scope');
  const permissions=f.original.member.role.permissions;f.original.member.role.permissions=[{ permission:{ code:'rental-core:catalog:view' } }];await assert.rejects(()=>authority.withRead(auth,name,input,consume,signal()));f.original.member.role.permissions=permissions;
  const changed=structuredClone(input);
  await assert.rejects(()=>authority.withRead(auth,name,changed,async()=>{ changed.lines[0].quantity=2;return 'not released'; },signal()),'full input changes suppress late result');
  await assert.rejects(()=>authority.withRead(auth,name,input,async()=>{ f.original.member.role.permissions=[];return 'not released'; },signal()));f.original.member.role.permissions=permissions;
  let preparedNative,preparations=0;
  // Preparation-port observation only, NOT a goal/audit persistence producer.
  const phased=create({ async prepareIn(native,current,tool,value,stop) { preparations++;preparedNative=native;assert.deepEqual(current,auth);assert.equal(tool,name);assert.deepEqual(value,input);assert.equal(stop.aborted,false);assert.equal(context.current(call).userId,'user-a'); } });
  const beforePhases=f.transactions;await phased.withRead(auth,name,input,()=>context.withReadNative(call,signal(),async native=>{ assert.notEqual(native,preparedNative);return 'fresh-read'; }),signal());
  assert.equal(preparations,1);assert.equal(f.transactions,beforePhases+2);
  const failed=create({ async prepareIn(){ throw Error('unavailable ORIGINAL availability goal'); } });const failures=f.transactions;
  await assert.rejects(()=>failed.withRead(auth,name,input,consume,signal()));assert.equal(f.transactions,failures+1);assert.equal(reads,1,'failed preparation performs no second read');
  f.loseCommit=true;await assert.rejects(()=>phased.withRead(auth,name,input,consume,signal()));f.loseCommit=false;assert.equal(reads,1,'unknown original preparation commit does not proceed/retry');
  const cancelled=new AbortController();cancelled.abort();const beforeAbort=f.transactions;await assert.rejects(()=>authority.withRead(auth,name,input,consume,cancelled.signal));assert.equal(f.transactions,beforeAbort);
  const beforeConfig=f.transactions;
  for(const requiredToolScopes of [undefined,[],[availabilityScope,availabilityScope],['unregistered-scope']])assert.throws(()=>createOriginalMcpAvailabilityReadAuthority(api,{ ...settings,requiredToolScopes },core,f.original.auth,f.original.guard,context));
  assert.throws(()=>createOriginalMcpAvailabilityReadAuthority(api,settings,core,f.original.auth,f.original.guard,{ bind:context.bind,current:context.current }));assert.equal(f.transactions,beforeConfig);
  settings.requiredToolScopes=[catalogScope];assert.equal(await authority.withRead(auth,name,input,consume,signal()),'original-owner-observation','scope-policy method identity fixed at construction');assert.equal(reads,2);
  const grant=Object.values(f.state.mcp_oauth_grants).find(row=>JSON.parse(row.recordJson).scopes.includes(availabilityScope)),record=JSON.parse(grant.recordJson);grant.revision++;grant.recordJson=JSON.stringify({ ...record,revision:grant.revision,enabled:false });
  await assert.rejects(()=>authority.withRead(auth,name,input,consume,signal()));assert.equal(reads,2,'revoked original grant suppresses old credential');
  assert.deepEqual(f.state.mcp_oauth_grant_last_use,{},'authorization probes are not completed business use');await core.service.close();
});

test('one original core composes persisted catalog goal accounting and Native facts before approved external release', async () => {
  const api = await compiled(), f = fixture(api), name = api.MCP_BUSINESS_CAPABILITIES.find(row => row.code === 'rental.catalog.search').name;
  f.catalogComposition = true; f.transactionEvents = []; f.sqlEvents = []; f.readAuthorityHeld = false; f.verifyInvocationHold = true;
  f.state.client_api_rate_buckets = {};
  for (const table of ['mcp_read_catalog_goals','mcp_read_target_bindings','mcp_read_goal_budgets','mcp_read_calls']) f.state[table] = {};
  const now = new Date(); f.catalogRows = ['a','b','c'].map(id => ({ id: 'group-' + id, tenantId: 'tenant-a', workspaceId: 'workspace-a',
    categoryCode: 'CAMERA', code: 'camera-' + id, name: 'Camera ' + id, inventoryMode: 'SERIALIZED', unit: 'day', status: 'enabled',
    description: 'private catalog description', attributes: { privateCost: 99 }, bundleComponents: [], createdAt: now, updatedAt: now }));
  const { RentalCoreService } = source('apps/api/src/modules/rental-core/rental-core.service.ts');
  const { RentalCoreConfigRepository } = source('apps/api/src/modules/rental-core/rental-core-config.repository.ts');
  const forbidden = () => { throw Error('catalog escaped into global SQL/state'); };
  const rentalCore = Object.create(RentalCoreService.prototype); rentalCore.configStore = new RentalCoreConfigRepository({ businessWorkspace: { findFirst: forbidden }, rentalItemGroup: { findMany: forbidden } }); rentalCore.state = forbidden;
  const issuer = 'https://as.example.invalid/', tokenEndpoint = issuer + 'token', revocationEndpoint = issuer + 'revoke';
  const config = { consentEndpoint, service: { enabled: true,
    resource: { resourceUrl: resource, authorizationServerUrl: issuer, allowedOrigins: [issuer], maxRequestBytes: 65536, authorizationTimeoutMs: 5000 },
    authorization: { issuer, authorizationEndpoint, tokenEndpoint, revocationEndpoint, allowedScopes: scopes, allowedOrigins: [issuer], timeoutMs: 5000, maxMetadataBytes: 65536 },
    tokens: { tokenEndpoint, revocationEndpoint, resourceUrl: resource, allowedScopes: scopes, allowedOrigins: [issuer], timeoutMs: 5000, maxRequestBytes: 4096 },
    lifetimes: { codeTtlSeconds: 60, accessTtlSeconds: 60, refreshTtlSeconds: 100 } } };
  const metadata = { read: async () => ({ issuer, authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, revocation_endpoint: revocationEndpoint,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code','refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], scopes_supported: scopes }) };
  // Explicit publication/wire/release fixtures: this does NOT approve a production
  // catalog contract. Actual goal/SQL/audit/Guard/Core/facts run underneath them.
  const policy = { tool: { name, description: 'Offline approved-release fixture',
    inputSchema: { type: 'object', additionalProperties: false, required: ['limit'], properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } } },
    outputSchema: { type: 'object', additionalProperties: false, required: ['count'], properties: { count: { type: 'integer' } } } },
    publication: { allows: async () => !f.unpublish },
    traffic: { current: async(operation,owner,native)=>{
      assert.equal(operation,'mcp.tools.call');assert.deepEqual(owner,{ userId:'user-a',tenantId:'tenant-a',workspaceId:'workspace-a' });
      assert.equal(native,f.native);return f.missingTrafficPolicy ? undefined : { policyRef:'explicit-test-traffic-policy',policyRevision:1,expiresAt:f.notice.expiresAt,windowSeconds:3600,limit:f.trafficLimit ?? 100 };
    } },
    release: { project: async (_auth, tool, value, stop) => { assert.equal(tool,name); assert.equal(stop.aborted,false);
      assert.equal(value.items.length,2); assert.equal(value.truncated,true); assert.equal(value.source,'persisted_workspace_configuration');
      for (const item of value.items) assert.deepEqual(Object.keys(item).sort(), ['categoryCode','code','id','name','status','unit']);
      f.releases = (f.releases ?? 0) + 1; return { count: value.items.length }; } } };
  let constructions = 0, ports, providers;
  const original = { database: f.database, metadata, verification: f.verification,
    protocolTraffic:{ current:async(operation,owner,native)=>{
      assert.ok(operation.startsWith('mcp.') && operation!=='mcp.tools.call' && operation!=='mcp.resources.read');
      assert.deepEqual(owner,{ userId:'user-a',tenantId:'tenant-a',workspaceId:'workspace-a' });assert.equal(native,f.native);
      f.protocolOperations=(f.protocolOperations ?? []).concat([operation]);
      if(f.holdProtocol){f.protocolReady.resolve();await f.protocolGate.promise;}
      return f.missingProtocolPolicy ? undefined : { policyRef:'original-test-protocol-policy',policyRevision:1,expiresAt:f.notice.expiresAt,windowSeconds:3600,limit:f.protocolLimit ?? 100 };
    } },createReadTools(current) {
    constructions++; ports = current; assert.equal(Object.isFrozen(current),true);
    providers = createOriginalMcpCatalogReadTools(api, { enabled: true, resourceUrl: resource, allowedScopes: scopes },
      current, f.original.auth, f.original.guard, rentalCore, f.originalLogs, policy);
    return providers;
  } };
  const core = createOriginalMcpOAuthCore(api, config, f.original.auth, f.originalLogs, original);
  assert.equal(constructions,1); assert.equal(ports.store,core.store); assert.equal(ports.grantAuthority,core.grantAuthority); assert.equal(Object.isFrozen(ports.database),true); assert.equal(f.transactions,0,'construction performs no SQL');
  f.database.$transaction = async()=>assert.fail('replacing the external database method cannot redirect the existing core/budget');
  original.createReadTools = () => assert.fail('factory replacement cannot change existing service');
  assert.throws(() => createOriginalMcpOAuthCore(api, { ...config, service: { ...config.service, resource: { ...config.service.resource, readTools: providers } } }, f.original.auth, f.originalLogs, original), /one read-provider owner/);
  assert.throws(() => createOriginalMcpCatalogReadTools(api, { enabled:true,resourceUrl:resource,allowedScopes:scopes }, { ...ports,database:f.database }, f.original.auth,f.original.guard,rentalCore,f.originalLogs,undefined));
  assert.throws(() => createOriginalMcpOAuthCore(api,config,f.original.auth,f.originalLogs,{ ...original,createReadTools:()=>({ ...providers,usage:{ completed:async()=>{} } }) }), /owns completed-read usage/);
  assert.throws(() => createOriginalMcpOAuthCore(api,config,f.original.auth,f.originalLogs,{ ...original,createReadTools:()=>Promise.resolve(providers) }), /read providers unavailable/);
  const draft = await core.webConsent.prepare(f.input,f.browser(),signal()); await core.webConsent.decide(f.post(draft),signal());
  const authUrl = authorizationEndpoint + '?' + new URLSearchParams({ response_type:'code',client_id:'client-a',redirect_uri:f.input.redirectUri,resource,scope:scopes.join(' '),state:f.input.state,code_challenge:challenge,code_challenge_method:'S256' });
  const issued = await core.service.fetch(new Request(authUrl,{ headers:{ authorization:'Bearer '+f.bearer } })); assert.equal(issued.status,303);
  const code = new URL(issued.headers.get('location')).searchParams.get('code');
  const exchanged = await core.service.fetch(new Request(tokenEndpoint,{ method:'POST',headers:{ 'content-type':'application/x-www-form-urlencoded' },
    body:new URLSearchParams({ grant_type:'authorization_code',client_id:'client-a',code,code_verifier:verifier,redirect_uri:f.input.redirectUri,resource }).toString() }));
  assert.equal(exchanged.status,200); const token = (await exchanged.json()).access_token;
  const authorization = { subject:f.notice.subject,clientId:'client-a',resource,scopes,token };
  await assert.rejects(()=>providers.tools[0].read({ limit:2 },signal()), 'direct/out-of-accounting reader cannot borrow another call');
  const { Client, StreamableHTTPClientTransport } = installed('@modelcontextprotocol/client');
  const client = new Client({ name:'one-core-catalog-fixture',version:'1' },{ capabilities:{},versionNegotiation:{ mode:{ pin:'2026-07-28' } } });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(resource),{ fetch:async(input,init)=>{
      const request=new Request(input,init);
      if(request.method==='POST') { const body=await request.clone().json();if(body.method==='tools/list')f.sdkListTemplate={body,headers:new Headers(request.headers)};if(body.method==='tools/call')f.sdkCallTemplate={body,headers:new Headers(request.headers)}; }
      return core.service.fetch(request);
    },authProvider:{ token:async()=>token },onInsufficientScope:'throw' }));
    const owner={userId:'user-a',tenantId:'tenant-a',workspaceId:'workspace-a'},scopeKey=classification=>createHash('sha256').update(JSON.stringify({kind:'original_mcp_traffic_1',classification,owner})).digest('hex');
    const automaticBucket=()=>Object.values(f.state.client_api_rate_buckets).find(row=>row.scopeKey===scopeKey('automatic_business'));
    const protocolBucket=()=>Object.values(f.state.client_api_rate_buckets).find(row=>row.scopeKey===scopeKey('protocol_discovery'));
    assert.deepEqual((await client.listTools()).tools.map(tool=>tool.name),[name]);assert.deepEqual(f.state.mcp_read_catalog_goals,{},'discovery creates no goal');assert.equal(automaticBucket(),undefined,'discovery cannot enter the automatic business rate bucket');assert.ok(protocolBucket().count>=2);
    const batch=[{jsonrpc:'2.0',id:1,method:'tools/list'},{jsonrpc:'2.0',id:2,method:'prompts/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name,arguments:{limit:2,human:true}}},{jsonrpc:'2.0',method:'tools/list'}];
    const unchangedBatch=structuredClone(batch);assert.deepEqual(api.originalMcpProtocolOperations(batch),['mcp.tools.list','mcp.prompts.list']);assert.deepEqual(batch,unchangedBatch);
    const start = f.transactionEvents.length, result = await client.callTool({ name,arguments:{ limit:2 } }); assert.deepEqual(result.structuredContent,{ count:2 }, JSON.stringify({ result,events:f.transactionEvents.slice(start),goals:Object.keys(f.state.mcp_read_catalog_goals),budgets:Object.values(f.state.mcp_read_goal_budgets).map(row=>({ consumedCalls:row.consumedCalls,concurrentReads:row.concurrentReads })) }));
    const goal = Object.values(f.state.mcp_read_catalog_goals)[0]; assert.equal(Object.keys(f.state.mcp_read_catalog_goals).length,1);
    assert.equal(f.state.mcp_read_goal_budgets[goal.goalId].consumedCalls,1); assert.equal(f.state.mcp_read_goal_budgets[goal.goalId].concurrentReads,0);
    assert.equal(Object.values(f.state.mcp_read_calls)[0].state,'returned'); assert.equal(f.releases,1);
    const events = f.transactionEvents.slice(start), catalogIndex = events.findIndex(row=>row[0]==='catalog'), readTx = events[catalogIndex][1];
    assert.ok(catalogIndex>0); assert.ok(events.slice(0,catalogIndex).some(row=>row[0]==='commit' && row[2]==='original' && row[1]!==readTx));
    assert.ok(events.slice(0,catalogIndex).some(row=>row[0]==='commit' && row[2]==='budget'),'separate budget commit precedes real Core dispatch');
    const readCommit = events.findIndex(row=>row[0]==='commit' && row[1]===readTx);
    assert.ok(readCommit>catalogIndex); assert.ok(events.slice(readCommit+1).some(row=>row[0]==='commit' && row[2]==='original'),'completed-use observer runs after read owner');
    assert.equal(typeof providers.accounting.withInvocation,'function');
    const settlementTx=f.sqlEvents.filter(row=>row.table==='mcp_read_calls').at(-1).transactionId;
    const terminalBudget=events.findIndex(row=>row[0]==='commit' && row[1]===settlementTx);
    assert.ok(terminalBudget>readCommit,'actual SDK handler keeps original call reserved until its read owner commits');
    assert.ok(events.slice(readCommit+1,terminalBudget).some(row=>row[0]==='commit' && row[2]==='original'),'usage/final original checks run before terminal budget settlement');
    assert.doesNotMatch(JSON.stringify(result), /privateCost|tenant-a|private catalog description/);
    assert.ok(f.auditRows.some(row=>row.action==='mcp.read.goal.admitted')); assert.ok(f.auditRows.some(row=>row.action==='mcp.read.goal.bindings.published'));
    f.failCatalog = true; assert.equal((await client.callTool({ name,arguments:{ limit:2 } })).isError,true); f.failCatalog = false;
    assert.equal(f.state.mcp_read_goal_budgets[goal.goalId].consumedCalls,2); assert.ok(Object.values(f.state.mcp_read_calls).some(row=>row.state==='failed')); assert.equal(f.releases,1);
    f.unpublish = true; await assert.rejects(()=>client.callTool({ name,arguments:{ limit:2 } }), error=>error.code===-32602); f.unpublish = false;
    assert.equal(f.state.mcp_read_goal_budgets[goal.goalId].consumedCalls,2,'publication rejection never reserves a call');
    await assert.rejects(()=>providers.tools[0].read({ limit:2 },signal()));
    await providers.authority.withRead(authorization,name,{ limit:2 },()=>providers.accounting.withCall(authorization,name,{ limit:2 },async()=>{
      await assert.rejects(()=>providers.tools[0].read({ limit:1 },signal()),'different input cannot borrow the call');
      await assert.rejects(()=>providers.accounting.withCall(authorization,name,{ limit:2 },async()=>{},signal()),'nested callback cannot mint another call');
      assert.equal((await providers.tools[0].read({ limit:2 },signal())).items.length,2);
      await assert.rejects(()=>providers.tools[0].read({ limit:2 },signal()),'one reservation cannot dispatch a second original read');
      const delayed=Promise.withResolvers(), late=delayed.promise.then(()=>providers.tools[0].read({ limit:2 },signal()));
      const rejected=assert.rejects(late,'completed callback cannot borrow the Native while original authority still settles');
      f.afterBudgetCommit=async()=>{ delayed.resolve(); await rejected; f.afterBudgetCommit=undefined; };
    },signal()),signal());
    assert.equal(f.state.mcp_read_goal_budgets[goal.goalId].consumedCalls,3);
    const permissions = f.original.member.role.permissions; f.original.member.role.permissions = [];
    assert.equal((await client.callTool({ name,arguments:{ limit:2 } })).isError,true); f.original.member.role.permissions = permissions;
    assert.equal(f.state.mcp_read_goal_budgets[goal.goalId].consumedCalls,3,'original permission failure enters neither budget nor reader');
    const failures=Object.values(f.state.mcp_read_calls).filter(row=>row.state==='failed').length;
    f.failUse=true;assert.equal((await client.callTool({ name,arguments:{ limit:2 } })).isError,true);f.failUse=false;
    assert.equal(f.state.mcp_read_goal_budgets[goal.goalId].consumedCalls,4);
    assert.equal(f.state.mcp_read_goal_budgets[goal.goalId].concurrentReads,0);
    assert.equal(Object.values(f.state.mcp_read_calls).filter(row=>row.state==='failed').length,failures+1,'actual SDK final observer failure is not prematurely settled as a returned invocation');
    assert.equal(automaticBucket().count,4,'goal-source rechecks do not double-consume class rate');
    const catalogReads=f.transactionEvents.filter(row=>row[0]==='catalog').length,beforeRate=structuredClone(f.state);
    f.trafficLimit=4;assert.equal((await client.callTool({ name,arguments:{ limit:2 } })).isError,true);
    assert.equal(f.transactionEvents.filter(row=>row[0]==='catalog').length,catalogReads,'class-rate denial precedes original Core dispatch');assert.deepEqual(f.state,beforeRate);f.trafficLimit=100;
    f.missingTrafficPolicy=true;assert.equal((await client.callTool({ name,arguments:{ limit:2 } })).isError,true);f.missingTrafficPolicy=false;assert.deepEqual(f.state,beforeRate);
    f.missingTrafficSchema=true;assert.equal((await client.callTool({ name,arguments:{ limit:2 } })).isError,true);f.missingTrafficSchema=false;assert.deepEqual(f.state,beforeRate);
    const protocolRequest=(body,version='2026-07-28',method='tools/list',stop=signal())=>{
      const headers=new Headers(f.sdkListTemplate.headers);headers.set('mcp-protocol-version',version);headers.set('mcp-method',method);
      return new Request(resource,{method:'POST',signal:stop,headers,body:JSON.stringify(body)});
    };
    const listBody={...structuredClone(f.sdkListTemplate.body),id:'protocol-list-88'},protocolBefore=protocolBucket().count;
    const listed=await core.service.fetch(protocolRequest(listBody));assert.equal(listed.status,200,await listed.clone().text());assert.equal(protocolBucket().count,protocolBefore+1);assert.equal(automaticBucket().count,4);
    const countBeforeBatch=protocolBucket().count;
    const legacy=await core.service.fetch(protocolRequest([{jsonrpc:'2.0',id:91,method:'tools/list'},{jsonrpc:'2.0',id:92,method:'tools/list'}],'2025-11-25'));assert.equal(legacy.status,200);assert.equal(protocolBucket().count,countBeforeBatch+2,'legacy mixed body classification counts every discovery request, not the first item');
    const beforeSpoof=protocolBucket().count;
    const spoof=await core.service.fetch(protocolRequest({...structuredClone(f.sdkCallTemplate.body),id:'protocol-spoof-90'},'2026-07-28','tools/list'));assert.notEqual(spoof.status,200);assert.equal(protocolBucket().count,beforeSpoof,'MCP method header cannot move a business body into discovery');assert.equal(automaticBucket().count,4);
    f.protocolLimit=protocolBucket().count;assert.equal((await core.service.fetch(protocolRequest(listBody))).status,503);assert.equal(protocolBucket().count,f.protocolLimit);f.protocolLimit=100;
    f.missingProtocolPolicy=true;assert.equal((await core.service.fetch(protocolRequest(listBody))).status,503);f.missingProtocolPolicy=false;
    assert.equal((await core.service.fetch(protocolRequest({...listBody,params:{...listBody.params,padding:'x'.repeat(70000)}}))).status,413,'pre-parsed body still uses the original request byte limit');
    assert.equal(f.transactionEvents.filter(row=>row[0]==='catalog').length,catalogReads);
    f.holdProtocol=true;f.protocolReady=Promise.withResolvers();f.protocolGate=Promise.withResolvers();const cancelProtocol=new AbortController();
    const pendingProtocol=core.service.fetch(protocolRequest(listBody,'2026-07-28','tools/list',cancelProtocol.signal));await f.protocolReady.promise;cancelProtocol.abort();assert.equal((await pendingProtocol).status,503);
    let protocolClosed=false;const closingProtocol=core.service.close().then(()=>{protocolClosed=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(protocolClosed,false,'close waits for original discovery policy work, not just the raced HTTP error');
    f.protocolGate.resolve();await closingProtocol;f.holdProtocol=false;

  } finally { await client.close(); await core.service.close(); }
  assert.equal(constructions,1); assert.equal(providers.usage,undefined,'Core owns the sole observer without mutating producer');
});

test('real original browser identity + persisted nonce/decision is consumed by original grant/code/token authors', async () => {
  const api = await compiled(), f = fixture(api), prepared = await f.prepare(); assert.equal(prepared.state, 'prepared');
  assert.equal(Object.keys(f.state.mcp_oauth_grants).length, 0); assert.ok(!JSON.stringify(f.state).includes(prepared.nonce));
  await assert.rejects(() => f.authorize()); assert.equal(Object.keys(f.state.mcp_oauth_codes).length, 0, 'pending review is not consent');
  const completed = await f.web.decide(f.post(prepared), signal()); assert.equal(completed.decision, 'approved');
  const outcome = await f.authorize(); assert.equal(outcome.kind, 'code'); const grant = JSON.parse(Object.values(f.state.mcp_oauth_grants)[0].recordJson);
  assert.equal(grant.consentRef, prepared.authorizationId); assert.equal(grant.consentRevision, 2); assert.equal(grant.userId, 'user-a'); assert.equal(grant.subject, 'issuer-subject-not-user-id');
  assert.deepEqual(f.audits.map(row => row.stage), ['prepared', 'approved', 'grant', 'code']);
  assert.deepEqual(f.auditRows.map(row => row.action), ['mcp.oauth.consent.prepared', 'mcp.oauth.consent.approved', 'mcp.oauth.grant.created', 'mcp.oauth.code.issued']);
  assert.ok(f.auditRows.every(row => row.tenantId === 'tenant-a' && row.workspaceId === 'workspace-a' && row.userId === 'user-a'));
  assert.ok(!JSON.stringify(f.auditRows).includes(prepared.nonce)); assert.ok(!JSON.stringify(f.auditRows).includes(outcome.code));
  const grants = api.createPrismaOAuthGrantAuthority({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, f.store, f.registry, f.identity);
  const tokens = api.createPersistentOAuthTokenService({ enabled: true, resourceUrl: resource, allowedScopes: scopes, accessTtlSeconds: 60, refreshTtlSeconds: 100 }, f.store, grants.issuance);
  const token = await tokens.exchangeCode({ clientId: 'client-a', clientRevision: 1, resource, code: outcome.code, codeVerifier: verifier, redirectUri: f.input.redirectUri }, signal());
  assert.ok(token.access_token); assert.ok(!JSON.stringify(f.state).includes(token.access_token));
  const workspace = f.state.mcp_oauth_workspace_admissions[[resource, 'tenant-a', 'workspace-a'].join('|')];
  workspace.recordJson = JSON.stringify({ ...JSON.parse(workspace.recordJson), enabled: false }); f.notice = undefined;
  const receipt = await f.store.transaction(tx => f.authority.receipt(f.input, f.browser(), tx, signal()), signal());
  assert.equal(receipt.state, 'observed'); assert.equal(receipt.grantId, grant.id, 'independent current Web owner read survives issuance disable');
  await assert.rejects(() => f.authorize());
  f.session.revokedAt = new Date(); await assert.rejects(() => f.store.transaction(tx => f.authority.receipt(f.input, f.browser(), tx, signal()), signal()));

  const web = fixture(api), issuer = 'https://as.example.invalid/', tokenEndpoint = 'https://as.example.invalid/token', revocationEndpoint = 'https://as.example.invalid/revoke';
  const config = { consentEndpoint, service: { enabled: true,
    resource: { resourceUrl: resource, authorizationServerUrl: issuer, allowedOrigins: [issuer], maxRequestBytes: 65536, authorizationTimeoutMs: 5000 },
    authorization: { issuer, authorizationEndpoint, tokenEndpoint, revocationEndpoint, allowedScopes: scopes, allowedOrigins: [issuer], timeoutMs: 5000, maxMetadataBytes: 65536 },
    tokens: { tokenEndpoint, revocationEndpoint, resourceUrl: resource, allowedScopes: scopes, allowedOrigins: [issuer], timeoutMs: 5000, maxRequestBytes: 4096 },
    lifetimes: { codeTtlSeconds: 60, accessTtlSeconds: 60, refreshTtlSeconds: 100 } } };
  const metadata = { read: async () => ({ issuer, authorization_endpoint: authorizationEndpoint, token_endpoint: tokenEndpoint, revocation_endpoint: revocationEndpoint,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], revocation_endpoint_auth_methods_supported: ['none'], scopes_supported: scopes }) };
  const core = createOriginalMcpOAuthCore(api, config, web.original.auth, web.originalLogs, { database: web.database, metadata, verification: web.verification });
  const authUrl = authorizationEndpoint + '?' + new URLSearchParams({ response_type: 'code', client_id: 'client-a', redirect_uri: web.input.redirectUri, resource, scope: scopes.join(' '), state: web.input.state, code_challenge: challenge, code_challenge_method: 'S256' });
  const browserRequest = () => new Request(authUrl, { headers: { authorization: 'Bearer ' + web.bearer } });
  const pending = await core.webConsent.prepare(web.input, browserRequest(), signal()); assert.equal(pending.state, 'prepared');
  assert.notEqual((await core.service.fetch(browserRequest())).status, 303, 'pending consent is not a code');
  await core.webConsent.decide(web.post(pending), signal());
  const codeResponse = await core.service.fetch(browserRequest()); assert.equal(codeResponse.status, 303); const originalCode = new URL(codeResponse.headers.get('location')).searchParams.get('code'); assert.ok(originalCode);
  const exchanged = await core.service.fetch(new Request(tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'client-a', code: originalCode, code_verifier: verifier, redirect_uri: web.input.redirectUri, resource }).toString() }));
  assert.equal(exchanged.status, 200); const credential = await exchanged.json(); assert.ok(credential.access_token); assert.ok(!JSON.stringify(web.state).includes(credential.access_token));
  const storedGrant = JSON.parse(Object.values(web.state.mcp_oauth_grants)[0].recordJson);
  assert.equal((await core.store.transaction(tx => core.grantAuthority.access.current(storedGrant.id, tx, signal()), signal())).id, storedGrant.id);
  const beforeBorrow = web.transactions; let borrowed;
  const sameNativeGrant = await web.database.$transaction(native => core.store.withNative(native, async tx => {
    borrowed = tx; assert.equal(core.store.native(tx), native);
    return core.grantAuthority.access.current(storedGrant.id, tx, signal());
  }, signal()), { isolationLevel: 'Serializable', maxWait: 2500, timeout: 5000 });
  assert.equal(sameNativeGrant.id, storedGrant.id); assert.equal(web.transactions, beforeBorrow + 1, 'original current grant/Auth consumes the existing native transaction without nesting');
  assert.throws(() => core.store.native(borrowed));
  assert.deepEqual(web.audits.map(row => row.stage), ['prepared', 'approved', 'grant', 'code']);
  const historical = await core.store.transaction(tx => core.consentAuthority.receipt(web.input, browserRequest(), tx, signal()), signal()); assert.equal(historical.state, 'observed');
  const missing = fixture(api), noVerification = createOriginalMcpOAuthCore(api, config, missing.original.auth, missing.originalLogs, { database: missing.database, metadata });
  await assert.rejects(() => noVerification.webConsent.prepare(missing.input, missing.browser(), signal())); assert.deepEqual(missing.state.mcp_oauth_grants, {}, 'required real verification cannot be replaced by core wiring');
  await core.service.close(); assert.equal((await core.service.fetch(browserRequest())).status, 503); await noVerification.service.close();

  const hosted = fixture(api), { PlatformService } = source('apps/api/src/modules/platform/platform.service.ts');
  hosted.original.platform.assertTrustedWorkspaceIntegrationManagement = (...args) => PlatformService.prototype.assertTrustedWorkspaceIntegrationManagement.call(hosted.original.platform, ...args);
  hosted.original.platform.assertTrustedWorkspaceSubjectManagement = (...args) => PlatformService.prototype.assertTrustedWorkspaceSubjectManagement.call(hosted.original.platform, ...args);
  const admin = 'https://admin.example.invalid', common = { enabled: true, resourceUrl: resource, requestTimeoutMs: 5000, maxResponseBytes: 65536 };
  const readGrant = api.createPrismaOAuthGrantAuthority({ enabled: true, resourceUrl: resource, allowedScopes: scopes }, hosted.store, hosted.registry, hosted.identity);
  const catalogName = api.MCP_BUSINESS_CAPABILITIES.find(value => value.code === 'rental.catalog.search').name;
  const readContext = createOriginalMcpCatalogReadContext();
  const catalogAuthority = createOriginalMcpCatalogReadAuthority(api, { enabled: true, resourceUrl: resource, allowedScopes: scopes },
    { store: hosted.store, grantAuthority: readGrant }, hosted.original.auth, hosted.original.guard, readContext);
  // Explicit original budget/storage substitute. These counters are test evidence,
  // never a production goal source or a product-local quota implementation.
  const budgetState = { calls: 0, activeMs: 0, inFlight: 0, settled: [], unknown: [] };
  const budgetFixture = (budgetState, goalId) => ({
    reserve: async call => {
      if (budgetState.calls >= 20 || budgetState.inFlight >= 2) throw new api.OriginalMcpReadBudgetError('limit');
      budgetState.calls++; budgetState.inFlight++;
      return { state: 'reserved', callId: call.callId, goalId, goalRevision: 1, grantId: Object.keys(hosted.state.mcp_oauth_grants)[0],
        goalBindingHash: 'a'.repeat(64), inputHash: call.inputHash, subject: call.authorization.subject, clientId: call.authorization.clientId, resource: call.authorization.resource, scopes: call.authorization.scopes,
        consumedCalls: budgetState.calls, consumedActiveMs: budgetState.activeMs, reservedActiveMs: budgetState.inFlight * 15000, concurrentReads: budgetState.inFlight, callAllowanceMs: budgetState.allowanceMs ?? 15000 };
    },
    settle: async (call, ticket, evidence) => { assert.equal(ticket.callId, call.callId); budgetState.activeMs += evidence.activeMs; budgetState.inFlight--; budgetState.settled.push(evidence); },
    markUnknown: async call => { budgetState.unknown.push(call.callId); },
  });
  const originalBudget = budgetFixture(budgetState, 'original-goal-fixture');
  const persistentAccounting = api.createPersistentMcpReadAccounting(originalBudget);
  const scopedAccounting = api.createPersistentMcpReadAccounting({ ...originalBudget, reserve: async call => {
    const transactions = hosted.transactions, queries = hosted.original.calls.length;
    const subject = readContext.current(call);
    assert.equal(hosted.transactions, transactions); assert.equal(hosted.original.calls.length, queries, 'subject lookup does not reopen grant/identity SQL');
    assert.equal(subject.grantId, Object.keys(hosted.state.mcp_oauth_grants)[0]); assert.equal(subject.grantRevision, 1);
    assert.equal(subject.userId, 'user-a'); assert.equal(subject.tenantId, 'tenant-a'); assert.equal(subject.workspaceId, 'workspace-a');
    assert.notEqual(subject.userId, call.authorization.subject, 'issuer subject is not a business user ID');
    assert.equal(subject.audience, 'operator'); assert.equal(subject.dataScope, 'organization');
    assert.deepEqual(subject.locationScope, { mode: 'selected', locationIds: ['loc-a'] });
    assert.ok(subject.permissions.includes('rental-core:catalog:view'));
    assert.ok(Object.isFrozen(subject) && Object.isFrozen(subject.permissions) && Object.isFrozen(subject.locationScope.locationIds));
    assert.throws(() => subject.locationScope.locationIds.push('forged-location'));
    assert.throws(() => createOriginalMcpCatalogReadContext().current(call), 'another context instance cannot consume this frame');
    for (const wrong of [ { ...call, inputHash: 'f'.repeat(64) }, { ...call, toolName: 'rental_availability_check' },
      { ...call, authorization: { ...call.authorization, token: 'other-token' } }, { ...call, authorization: { ...call.authorization, scopes: [] } } ]) assert.throws(() => readContext.current(wrong));
    hosted.lastReadSubject = subject; hosted.lastReadCall = call;
    assert.doesNotMatch(JSON.stringify(subject), /operationToken|token|credential|issuer-subject/);
    return originalBudget.reserve(call);
  } });
  const readTools = {
    tools: [{ name: catalogName, description: 'fixture-only bounded read', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['limit'], additionalProperties: false },
      outputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false },
      read: async (input, readSignal) => {
        if (hosted.holdBudgetRead || hosted.holdBudgetRelease) hosted.budgetReadSignal = readSignal;
        if (hosted.holdBudgetRead) {
          if (!readSignal.aborted) await new Promise(resolve => readSignal.addEventListener('abort', resolve, { once: true }));
          hosted.budgetOuterAbortedAtAllowance = hosted.budgetTransportSignal.aborted;
          hosted.budgetAuthorityAbortedAtAllowance = hosted.budgetEndpointSignal.aborted;
          return { value: 'private late budget result' };
        }
        if (hosted.failRead) throw new Error('synthetic reader failure'); if (hosted.loseReadPermission) hosted.original.member.role.permissions = [];
        return readContext.withReadNative(hosted.lastReadCall, readSignal, async (native, stop) => {
          assert.equal(native.originalMarker, 'original'); assert.equal(stop.aborted, false);
          assert.equal(typeof native.businessWorkspace.findFirst, 'function');
          assert.equal(Object.hasOwn(readContext.current(hosted.lastReadCall), 'native'), false);
          return { value: 'fixture-read' }; // result/release remains an explicit external fixture
        });
      } }],
    // Publication, goal accounting and field policy are explicit external fixtures;
    // the authority below still executes original current grant/Auth/Guard/ALS.
    publication: { allows: async () => true }, accounting: scopedAccounting,
    release: { project: async (auth, name, value, readSignal) => {
      if (hosted.holdBudgetRead) assert.fail('late reader must not enter field release');
      if (hosted.holdBudgetRelease) {
        hosted.budgetReleaseSignal = readSignal;
        if (!readSignal.aborted) await new Promise(resolve => readSignal.addEventListener('abort', resolve, { once: true }));
        hosted.budgetOuterAbortedAtAllowance = hosted.budgetTransportSignal.aborted;
          hosted.budgetAuthorityAbortedAtAllowance = hosted.budgetEndpointSignal.aborted;
        return { value: 'private late release result' };
      }
      return hosted.badOutput ? { value: 123 } : value;
    } },
    authority: { withRead: async (...args) => {
      if (hosted.holdBudgetRead || hosted.holdBudgetRelease) hosted.budgetEndpointSignal = args[4];
      hosted.readAuthorityHeld = true; // Instrument settlement only; actual authority is the production adapter.
      try { return await catalogAuthority.withRead(...args); } finally { hosted.readAuthorityHeld = false; }
    } },
  };
  const hostConfig = { core: { ...config, service: { ...config.service, resource: { ...config.service.resource, readTools } } },
    consent: { ...common, authorizationEndpoint, allowedScopes: scopes, prepareEndpoint: issuer + 'consent/prepare', decisionEndpoint: consentEndpoint, receiptEndpoint: issuer + 'consent/receipt', referenceEndpoint: issuer + 'consent/reference' },
    review: { enabled: true, requestTimeoutMs: 5000, maxResponseBytes: 65536,
      client: { prepareEndpoint: admin + '/review/client/prepare', decisionEndpoint: admin + '/review/client/decide', receiptEndpoint: admin + '/review/client/receipt', allowedScopes: scopes, policyRevision: 1, actionTtlSeconds: 90, maxReviewLifetimeSeconds: 900 },
      notice: { resourceUrl: resource, prepareEndpoint: admin + '/review/notice/prepare', decisionEndpoint: admin + '/review/notice/decide', receiptEndpoint: admin + '/review/notice/receipt', policyRevision: 1, actionTtlSeconds: 90, maxReviewLifetimeSeconds: 900 } },
    grant: { ...common, listEndpoint: admin + '/grant/list', summaryEndpoint: admin + '/grant/read', revocationEndpoint: admin + '/grant/revoke', receiptEndpoint: admin + '/grant/receipt', readCallReceiptEndpoint: admin + '/grant/read-call-receipt', readCallListEndpoint: admin + '/grant/read-calls' },
    admission: { ...common, allowedScopes: scopes, readEndpoint: admin + '/admission/read', saveEndpoint: admin + '/admission/save', receiptEndpoint: admin + '/admission/receipt' },
    governance: { ...common, client: { readEndpoint: admin + '/client/read', saveEndpoint: admin + '/client/save', receiptEndpoint: admin + '/client/receipt' }, notice: { readEndpoint: admin + '/notice/read', saveEndpoint: admin + '/notice/save', receiptEndpoint: admin + '/notice/receipt' } },
    subject: { ...common, readEndpoint: admin + '/subject/read', saveEndpoint: admin + '/subject/save', receiptEndpoint: admin + '/subject/receipt' } };
  const receiptTraffic={ forRequest:()=>({ current:async()=>assert.fail('anonymous Web route cannot consult receipt policy') }) };let receiptRateForwarded=0;
  const host = createOriginalMcpHost({ ...api,createMcpGrantControlPlane:(config,original)=>{
    assert.equal(original.receiptTraffic,receiptTraffic);receiptRateForwarded++;return api.createMcpGrantControlPlane(config,original);
  } }, hostConfig, hosted.original.auth, hosted.original.platform, hosted.originalLogs, { database: hosted.database, metadata, verification: hosted.verification, receiptTraffic });
  assert.equal(receiptRateForwarded,1,'same original host forwards the explicit receipt policy factory once');
  const discovery = await host.fetch(new Request('https://as.example.invalid/.well-known/oauth-authorization-server')); assert.equal(discovery.status, 200); assert.equal((await discovery.json()).issuer, issuer);
  for (const url of [hostConfig.grant.listEndpoint, hostConfig.grant.readCallReceiptEndpoint, hostConfig.grant.readCallListEndpoint, hostConfig.admission.readEndpoint, hostConfig.governance.client.readEndpoint, hostConfig.subject.readEndpoint]) {
    assert.equal((await host.fetch(new Request(url))).status, 403, 'known Web paths stay behind original identity');
  }
  assert.equal((await host.fetch(new Request(hostConfig.review.client.prepareEndpoint, { method: 'POST', body: '{}' }))).status, 503, 'absent review verification is not a fake not-required source');
  assert.equal((await host.fetch(new Request(admin + '/unknown'))).status, 404);
  const originalConsentForm = new URL(authUrl).searchParams.toString(), consentHeaders = { authorization: 'Bearer ' + hosted.bearer, origin: issuer.slice(0, -1), 'content-type': 'application/x-www-form-urlencoded' };
  const referenceUrl = hostConfig.consent.referenceEndpoint + '?' + originalConsentForm;
  const beforeReference = JSON.stringify(hosted.state), referenceAudits = hosted.audits.length;
  assert.equal((await host.fetch(new Request(referenceUrl))).status, 403);
  assert.equal((await host.fetch(new Request(referenceUrl, { headers: { authorization: 'Bearer opaque-mcp-token' } }))).status, 403);
  assert.equal((await host.fetch(new Request(referenceUrl, { headers: { ...consentHeaders, origin: 'https://other.example.invalid' } }))).status, 403);
  assert.equal((await host.fetch(new Request(hostConfig.consent.referenceEndpoint, { method: 'POST', headers: consentHeaders }))).status, 405);
  const referenceResponse = await host.fetch(new Request(referenceUrl, { headers: consentHeaders })); assert.equal(referenceResponse.status, 200); assert.equal(referenceResponse.headers.get('cache-control'), 'no-store');
  const consentReference = await referenceResponse.json(); assert.deepEqual(Object.keys(consentReference).sort(), ['authorizationId', 'retryable', 'state']); assert.equal(consentReference.state, 'referenced'); assert.equal(consentReference.retryable, false);
  assert.equal(JSON.stringify(hosted.state), beforeReference); assert.equal(hosted.audits.length, referenceAudits, 'reference cannot prepare, write audit or issue a nonce/code/grant');
  const consentForm = originalConsentForm + '&authorizationId=' + consentReference.authorizationId;
  const prepareConsent = (form = consentForm, headers = consentHeaders) => host.fetch(new Request(hostConfig.consent.prepareEndpoint, { method: 'POST', headers, body: form }));
  assert.equal((await prepareConsent(originalConsentForm)).status, 400, 'configured reference mode requires the retained original key');
  assert.equal((await prepareConsent(consentForm + '&authorizationId=' + consentReference.authorizationId)).status, 400);
  const changedClient = hosted.state.mcp_oauth_public_clients['client-a'], oldClient = structuredClone(changedClient);
  changedClient.revision = 2; changedClient.recordJson = JSON.stringify({ ...JSON.parse(changedClient.recordJson), revision: 2 });
  assert.equal((await prepareConsent()).status, 400, 'late registration revision cannot create a different preparation key');
  hosted.state.mcp_oauth_public_clients['client-a'] = oldClient;
  const changedRequest = new URLSearchParams(consentForm); changedRequest.set('state', 'changed-original-state');
  assert.equal((await prepareConsent(changedRequest.toString())).status, 400);
  assert.equal(JSON.stringify(hosted.state), beforeReference);
  assert.equal((await host.fetch(new Request(hostConfig.consent.prepareEndpoint))).status, 405, 'GET cannot prepare a mutating consent');
  assert.equal((await prepareConsent(consentForm, { ...consentHeaders, origin: 'https://other.example.invalid' })).status, 403);
  assert.equal((await prepareConsent(consentForm + '&clientRevision=1')).status, 400, 'current revision comes from original registration');
  assert.equal((await prepareConsent(consentForm, { ...consentHeaders, authorization: 'Bearer opaque-mcp-token' })).status, 403);
  const preparedResponse = await prepareConsent(); assert.equal(preparedResponse.status, 200); assert.equal(preparedResponse.headers.get('cache-control'), 'no-store');
  const consentDraft = await preparedResponse.json(); assert.equal(consentDraft.state, 'prepared'); assert.equal(consentDraft.authorizationId, consentReference.authorizationId); assert.ok(consentDraft.nonce); assert.ok(!JSON.stringify(consentDraft).includes(hosted.notice.subject));
  assert.deepEqual(hosted.state.mcp_oauth_grants, {}); assert.deepEqual(hosted.state.mcp_oauth_codes, {});
  const receiptUrl = hostConfig.consent.receiptEndpoint + '?authorizationId=' + consentReference.authorizationId;
  const observeConsent = () => host.fetch(new Request(receiptUrl, { headers: { authorization: 'Bearer ' + hosted.bearer } }));
  // A separate original OAuth request exercises lost FIRST preparation response;
  // recovery never changes that request's state/challenge or asks for another nonce.
  const lostForm = new URLSearchParams(originalConsentForm); lostForm.set('state', 'independent-lost-prepare-fixture');
  const lostReference = await (await host.fetch(new Request(hostConfig.consent.referenceEndpoint + '?' + lostForm, { headers: consentHeaders }))).json();
  lostForm.set('authorizationId', lostReference.authorizationId); hosted.losePreparedCommitOnce = true;
  const lostPrepare = await prepareConsent(lostForm.toString()); assert.equal(lostPrepare.status, 503); assert.deepEqual(await lostPrepare.json(), { error: 'consent_unknown', retryable: false });
  assert.equal(hosted.state.mcp_oauth_browser_consents[lostReference.authorizationId].state, 'pending');
  const lostBeforeRead = JSON.stringify(hosted.state), lostAudits = hosted.audits.length;
  const recoveredPrepare = await (await host.fetch(new Request(hostConfig.consent.receiptEndpoint + '?authorizationId=' + lostReference.authorizationId, { headers: consentHeaders }))).json();
  assert.deepEqual(recoveredPrepare, { state: 'observed', authorizationId: lostReference.authorizationId, revision: 1, decision: 'pending', retryable: false });
  assert.equal(JSON.stringify(hosted.state), lostBeforeRead); assert.equal(hosted.audits.length, lostAudits); assert.equal(Object.hasOwn(recoveredPrepare, 'nonce'), false);
  assert.equal((await (await observeConsent()).json()).decision, 'pending');
  assert.equal((await host.fetch(new Request(referenceUrl + '&actorId=other-user', { headers: consentHeaders }))).status, 400);
  hosted.queryHook = (table, rows) => { if (table === 'mcp_oauth_browser_consents' && rows.length) hosted.original.member.isActive = false; return rows; };
  assert.notEqual((await host.fetch(new Request(referenceUrl, { headers: consentHeaders }))).status, 200, 'current owner lost during reference read suppresses the key'); hosted.queryHook = undefined; hosted.original.member.isActive = true;
  const legacyConsentConfig = { ...hostConfig.consent }; delete legacyConsentConfig.referenceEndpoint;
  const legacyConsent = api.createMcpConsentControlPlane(legacyConsentConfig, { webConsent: hosted.web, registrations: hosted.registry });
  const legacyPrepare = await legacyConsent.fetch(new Request(legacyConsentConfig.prepareEndpoint, { method: 'POST', headers: consentHeaders, body: originalConsentForm }));
  assert.equal(legacyPrepare.status, 200); assert.equal((await legacyPrepare.json()).state, 'observed', 'unconfigured reference route preserves original caller/transport behavior'); await legacyConsent.close();
  const withoutReference = { prepare: hosted.web.prepare, decide: hosted.web.decide, receipt: hosted.web.receipt };
  assert.throws(() => api.createMcpConsentControlPlane(hostConfig.consent, { webConsent: withoutReference, registrations: hosted.registry }), /unavailable/);
  const repeatedDraft = await (await prepareConsent()).json(); assert.equal(repeatedDraft.state, 'observed'); assert.equal(repeatedDraft.nonce, undefined);
  assert.equal((await host.fetch(new Request(authUrl, { headers: { authorization: 'Bearer ' + hosted.bearer } }))).status, 503, 'pending is not a signed code');
  const decisionForm = new URLSearchParams({ authorizationId: consentDraft.authorizationId, expectedRevision: '1', decision: 'approve', nonce: consentDraft.nonce }).toString();
  assert.equal((await host.fetch(new Request(consentEndpoint, { method: 'POST', headers: consentHeaders, body: decisionForm + '&confirmed=true' }))).status, 400);
  hosted.loseCommit = true;
  const decideResponse = await host.fetch(new Request(consentEndpoint, { method: 'POST', headers: consentHeaders, body: decisionForm })); assert.equal(decideResponse.status, 503); assert.deepEqual(await decideResponse.json(), { error: 'consent_unknown', retryable: false });
  hosted.loseCommit = false; const recoveredConsent = await (await observeConsent()).json(); assert.equal(recoveredConsent.decision, 'approved'); assert.equal(hosted.audits.filter(row => row.stage === 'approved').length, 1, 'lost commit response is recovered without resubmission');
  const hostCode = await host.fetch(new Request(authUrl, { headers: { authorization: 'Bearer ' + hosted.bearer } })); assert.equal(hostCode.status, 303);
  assert.equal(Object.keys(hosted.state.mcp_oauth_grants).length, 1); assert.equal(Object.keys(hosted.state.mcp_oauth_codes).length, 1);
  const hostCodeValue = new URL(hostCode.headers.get('location')).searchParams.get('code');
  const hostTokenResponse = await host.fetch(new Request(tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: 'client-a', code: hostCodeValue, code_verifier: verifier, redirect_uri: hosted.input.redirectUri, resource }).toString() }));
  assert.equal(hostTokenResponse.status, 200); const hostCredential = await hostTokenResponse.json();
  const grantId = Object.keys(hosted.state.mcp_oauth_grants)[0], summaryUrl = hostConfig.grant.summaryEndpoint + '?grantId=' + grantId;
  const readSummary = async () => { const response = await host.fetch(new Request(summaryUrl, { headers: { authorization: 'Bearer ' + hosted.bearer } })); assert.equal(response.status, 200); return response.json(); };
  const beforeSummary = hosted.transactions, initialSummary = await readSummary();
  assert.equal(hosted.transactions, beforeSummary + 1, 'OAuth admission borrows the management transaction instead of nesting');
  assert.deepEqual(initialSummary.oauthAdmission, { state: 'current' }); assert.equal(initialSummary.lastUse.state, 'unavailable'); assert.deepEqual(hosted.state.mcp_oauth_grant_last_use, {}, 'token exchange and Web reads create no use');
  assert.ok(!JSON.stringify(initialSummary).includes(hostCredential.access_token)); assert.ok(!JSON.stringify(initialSummary).includes(hosted.notice.subject));
  const workspacePolicy = hosted.state.mcp_oauth_workspace_admissions[[resource, 'tenant-a', 'workspace-a'].join('|')], policyBefore = structuredClone(workspacePolicy);
  workspacePolicy.revision++; workspacePolicy.recordJson = JSON.stringify({ ...JSON.parse(workspacePolicy.recordJson), revision: workspacePolicy.revision, enabled: false });
  const stoppedSummary = await readSummary(); assert.equal(stoppedSummary.revocationState, 'not_revoked'); assert.deepEqual(stoppedSummary.oauthAdmission, { state: 'not_current' }, 'not revoked is not current OAuth admission');
  hosted.state.mcp_oauth_workspace_admissions[[resource, 'tenant-a', 'workspace-a'].join('|')] = policyBefore;
  const registeredClient = hosted.state.mcp_oauth_public_clients['client-a']; delete hosted.state.mcp_oauth_public_clients['client-a'];
  assert.deepEqual((await readSummary()).oauthAdmission, { state: 'unavailable' }, 'missing linked evidence is not confirmed revocation'); hosted.state.mcp_oauth_public_clients['client-a'] = registeredClient;
  assert.equal((await host.fetch(new Request(summaryUrl + '&oauthAdmission=current', { headers: { authorization: 'Bearer ' + hosted.bearer } }))).status, 400);
  assert.deepEqual(hosted.state.mcp_oauth_grant_last_use, {}, 'all admission reads remain metadata, not use');
  const catalogAuthorization = { subject: hosted.notice.subject, clientId: 'client-a', resource, scopes, token: hostCredential.access_token }; let unauthorizedReads = 0;
  await assert.rejects(() => catalogAuthority.withRead(catalogAuthorization, 'rental_availability_check', { limit: 2 }, async () => { unauthorizedReads++; }, signal()));
  const beforeLimit = hosted.transactions;
  await assert.rejects(() => catalogAuthority.withRead(catalogAuthorization, catalogName, { limit: 51 }, async () => { unauthorizedReads++; }, signal())); assert.equal(hosted.transactions, beforeLimit, 'over-limit input never enters native authorization');
  await assert.rejects(() => catalogAuthority.withRead({ ...catalogAuthorization, subject: 'other-user-subject' }, catalogName, { limit: 2 }, async () => { unauthorizedReads++; }, signal())); assert.equal(unauthorizedReads, 0);
  const contextCall = { callId: 'context-check', authorization: catalogAuthorization, toolName: catalogName, inputHash: api.captureMcpReadInput({ limit: 2 }).inputHash };
  assert.throws(() => readContext.current(contextCall), 'no original Guard callback means no subject');
  await assert.rejects(() => readContext.withReadNative(contextCall, signal(), async () => { unauthorizedReads++; }));
  assert.equal(unauthorizedReads, 0);
  // Original preparation-port observation only; the actual goal writer/SQL/audit
  // is tested in mcp-mysql-store. Prove its transaction ends before read/accounting.
  let preparationNative, preparations = 0, phasedReads = 0;
  const phased = createOriginalMcpCatalogReadAuthority(api, { enabled: true, resourceUrl: resource, allowedScopes: scopes },
    { store: hosted.store, grantAuthority: readGrant }, hosted.original.auth, hosted.original.guard, readContext,
    { async prepareIn(native, auth, tool, input, stop) { preparations++; preparationNative = native; assert.equal(native.originalMarker, 'original');
      assert.equal(auth.token, catalogAuthorization.token); assert.equal(tool, catalogName); assert.deepEqual(input, { limit: 2 });
      assert.equal(stop.aborted, false); assert.equal(readContext.current(contextCall).userId, 'user-a'); } });
  const phaseStart = hosted.transactions;
  await phased.withRead(catalogAuthorization, catalogName, { limit: 2 }, () => readContext.withReadNative(contextCall, signal(), async native => {
    phasedReads++; assert.notEqual(native, preparationNative); assert.equal(hosted.transactions, phaseStart + 2); return 'separate-original-read';
  }), signal());
  assert.equal(preparations, 1); assert.equal(phasedReads, 1); assert.equal(hosted.transactions, phaseStart + 2);
  const prepFailure = createOriginalMcpCatalogReadAuthority(api, { enabled: true, resourceUrl: resource, allowedScopes: scopes },
    { store: hosted.store, grantAuthority: readGrant }, hosted.original.auth, hosted.original.guard, readContext,
    { async prepareIn() { throw Error('explicit unavailable original preparation'); } });
  await assert.rejects(() => prepFailure.withRead(catalogAuthorization, catalogName, { limit: 2 }, async () => { phasedReads++; }, signal()));
  assert.equal(phasedReads, 1, 'failed preparation never starts a second read/transaction');
  const legacyAuthority = createOriginalMcpCatalogReadAuthority(api, { enabled: true, resourceUrl: resource, allowedScopes: scopes },
    { store: hosted.store, grantAuthority: readGrant }, hosted.original.auth, hosted.original.guard);
  await legacyAuthority.withRead(catalogAuthorization, catalogName, { limit: 2 }, async () => { assert.throws(() => readContext.current(contextCall)); }, signal());
  assert.throws(() => createOriginalMcpCatalogReadAuthority({ MCP_BUSINESS_CAPABILITIES: api.MCP_BUSINESS_CAPABILITIES,
    createPersistentOAuthAccessReader: api.createPersistentOAuthAccessReader }, { enabled: true, resourceUrl: resource, allowedScopes: scopes },
    { store: hosted.store, grantAuthority: readGrant }, hosted.original.auth, hosted.original.guard, readContext), 'a configured context cannot omit the formal input capture producer');
  const delayedContext = Promise.withResolvers(); let inheritedContext;
  await catalogAuthority.withRead(catalogAuthorization, catalogName, { limit: 2 }, async () => {
    assert.equal(readContext.current(contextCall).userId, 'user-a');
    inheritedContext = delayedContext.promise.then(() => readContext.current(contextCall));
  }, signal());
  assert.throws(() => readContext.current(contextCall));
  const delayedRejected = assert.rejects(inheritedContext); delayedContext.resolve(); await delayedRejected;
  const contextCancel = new AbortController();
  await assert.rejects(() => catalogAuthority.withRead(catalogAuthorization, catalogName, { limit: 2 }, async () => {
    assert.equal(readContext.current(contextCall).userId, 'user-a'); contextCancel.abort(); assert.throws(() => readContext.current(contextCall));
  }, contextCancel.signal));
  const { Client, StreamableHTTPClientTransport } = installed('@modelcontextprotocol/client');
  const client = new Client({ name: 'original-host-use-fixture', version: '1' }, { capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } } });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: async (input, init) => host.fetch(new Request(input, init)),
      authProvider: { token: async () => hostCredential.access_token }, onInsufficientScope: 'throw' }));
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), [catalogName]);
    assert.deepEqual(hosted.state.mcp_oauth_grant_last_use, {}, 'official SDK discovery/token checks do not create use');
    hosted.failRead = true; assert.equal((await client.callTool({ name: catalogName, arguments: { limit: 2 } })).isError, true); hosted.failRead = false;
    hosted.badOutput = true; assert.equal((await client.callTool({ name: catalogName, arguments: { limit: 2 } })).isError, true); hosted.badOutput = false;
    const originalPermissions = hosted.original.member.role.permissions; hosted.loseReadPermission = true;
    assert.equal((await client.callTool({ name: catalogName, arguments: { limit: 2 } })).isError, true); hosted.loseReadPermission = false; hosted.original.member.role.permissions = originalPermissions;
    hosted.failUse = true; assert.equal((await client.callTool({ name: catalogName, arguments: { limit: 2 } })).isError, true); hosted.failUse = false;
    assert.deepEqual(hosted.state.mcp_oauth_grant_last_use, {}, 'failed reader/output/observation never returns a successful completed read');
    assert.equal((await client.callTool({ name: catalogName, arguments: { limit: 2 } })).structuredContent.value, 'fixture-read');
    const lastUse = (await readSummary()).lastUse; assert.equal(lastUse.kind, 'server_read_completed'); assert.ok(Number.isSafeInteger(lastUse.observedAtMs));
    const pageResponse = await host.fetch(new Request(hostConfig.grant.listEndpoint, { headers: { authorization: 'Bearer ' + hosted.bearer } })); assert.equal(pageResponse.status, 200);
    const grantedPage = await pageResponse.json(); assert.deepEqual(grantedPage.items[0].lastUse, lastUse); assert.deepEqual(grantedPage.items[0].oauthAdmission, { state: 'current' });
    assert.deepEqual((await readSummary()).lastUse, lastUse, 'Web reads do not rewrite observation');
    assert.ok(!JSON.stringify(hosted.state.mcp_oauth_grant_last_use).includes(hostCredential.access_token)); assert.equal(readTools.usage, undefined, 'Core never mutates original read providers');
  } finally { await client.close(); }
  assert.ok(budgetState.calls >= 5); assert.ok(budgetState.settled.some(row => row.outcome === 'failed'), 'failed business reads remain counted'); assert.equal(budgetState.inFlight, 0);
  const callsBeforeReload = budgetState.calls, reloadedAccounting = api.createPersistentMcpReadAccounting(originalBudget);
  await reloadedAccounting.withCall(catalogAuthorization, catalogName, { limit: 2 }, async () => 'fixed-read', signal()); assert.equal(budgetState.calls, callsBeforeReload + 1, 'adapter reload does not reset original goal');
  assert.throws(() => api.createPersistentMcpReadAccounting(undefined));
  // Independent fixed original goal fixture; never reset the preceding target's
  // consumed calls/holds to make another invocation fit its budget.
  const narrowState = { calls: 0, activeMs: 0, inFlight: 0, settled: [], unknown: [], allowanceMs: 250 };
  const narrowTools = { ...readTools, accounting: api.createPersistentMcpReadAccounting(budgetFixture(narrowState, 'independent-narrow-goal-fixture')) };
  const resourceState = { calls: 0, activeMs: 0, inFlight: 0, settled: [], unknown: [], allowanceMs: 250 };
  const resourceAccounting = api.createPersistentMcpReadAccounting(budgetFixture(resourceState, 'independent-resource-goal-fixture'));
  const resourceDescriptor = { name: 'bounded_catalog_fixture', uri: new URL('/resources/bounded-catalog-fixture', resource).href, version: 'fixture-1', description: 'explicit offline catalog fixture' };
  const resourceControl = { mode: 'normal', omitSignal: true, releaseCalls: 0 };
  // Fixed ORIGINAL catalog authority and target mapping are explicit fixtures;
  // Resources discovery/URI never creates a goal or chooses a free-read category.
  const deadlineResources = {
    list: async () => [resourceDescriptor],
    read: async (auth, descriptor, readSignal) => {
      resourceControl.readSignal = readSignal; assert.equal(descriptor.uri, resourceDescriptor.uri);
      if (resourceControl.mode === 'read') {
        if (!readSignal.aborted) await new Promise(resolve => readSignal.addEventListener('abort', resolve, { once: true }));
        resourceControl.outerAbortedAtAllowance = resourceControl.requestSignal.aborted;
      }
      return resourceControl.mode === 'read' ? 'private late resource body' : 'bounded resource fixture';
    },
    authority: { withRead: async (auth, descriptor, consume, requestSignal) => {
      resourceControl.requestSignal = requestSignal;
      return catalogAuthority.withRead(auth, catalogName, { limit: 1 }, consume, requestSignal);
    } },
    accounting: { withRead: (auth, descriptor, consume, requestSignal) => resourceAccounting.withCall(auth, catalogName,
      { uri: descriptor.uri, version: descriptor.version }, allowanceSignal => consume(resourceControl.omitSignal ? undefined : allowanceSignal), requestSignal) },
    release: { project: async (auth, descriptor, value, readSignal) => {
      resourceControl.releaseCalls++; resourceControl.releaseSignal = readSignal;
      if (resourceControl.mode === 'release') {
        if (!readSignal.aborted) await new Promise(resolve => readSignal.addEventListener('abort', resolve, { once: true }));
        resourceControl.outerAbortedAtAllowance = resourceControl.requestSignal.aborted;
      }
      return { version: descriptor.version, text: resourceControl.mode === 'release' ? 'private late resource projection' : value };
    } },
  };
  const narrowHost = createOriginalMcpHost(api, { ...hostConfig, core: { ...hostConfig.core, service: { ...hostConfig.core.service,
    resource: { ...hostConfig.core.service.resource, readTools: narrowTools, resources: deadlineResources } } } }, hosted.original.auth, hosted.original.platform, hosted.originalLogs, { database: hosted.database, metadata, verification: hosted.verification });
  const narrowClient = new Client({ name: 'original-budget-deadline-fixture', version: '1' }, { capabilities: {}, versionNegotiation: { mode: { pin: '2026-07-28' } } });
  const useBeforeDeadline = structuredClone(hosted.state.mcp_oauth_grant_last_use);
  try {
    await narrowClient.connect(new StreamableHTTPClientTransport(new URL(resource), { fetch: async (input, init) => {
      const request=new Request(input,init);hosted.budgetTransportSignal=request.signal;return narrowHost.fetch(request);
    },
      authProvider: { token: async () => hostCredential.access_token }, onInsufficientScope: 'throw' }));
    for (const flag of ['holdBudgetRead', 'holdBudgetRelease']) {
      hosted[flag] = true;
      const lateResult = await narrowClient.callTool({ name: catalogName, arguments: { limit: 2 } });
      hosted[flag] = false;
      assert.equal(lateResult.isError, true); assert.ok(!JSON.stringify(lateResult).includes('private late'));
      assert.equal((flag === 'holdBudgetRead' ? hosted.budgetReadSignal : hosted.budgetReleaseSignal).aborted, true, 'original allowance reaches reader and release');
      assert.equal(hosted.budgetOuterAbortedAtAllowance, false, 'allowance aborts before the longer original transport/request deadline');
      assert.equal(hosted.budgetAuthorityAbortedAtAllowance,true,'whole-invocation authority now shares the same shortened original allowance');
      if (flag === 'holdBudgetRelease') assert.equal(hosted.budgetReadSignal, hosted.budgetReleaseSignal, 'reader and release share the same narrowed signal');
    }
    assert.equal(narrowState.calls, 2); assert.equal(narrowState.inFlight, 2); assert.equal(narrowState.unknown.length, 2); assert.equal(narrowState.settled.length, 0);
    const listedResources = await narrowClient.listResources(); assert.deepEqual(listedResources.resources.map(item => item.uri), [resourceDescriptor.uri]);
    assert.equal(resourceState.calls, 0, 'resource discovery reads no body and consumes no business slot');
    await assert.rejects(() => narrowClient.readResource({ uri: resourceDescriptor.uri + '?human=true' })); assert.equal(resourceState.calls, 0, 'caller URI cannot select a free-read category or target');
    const ordinaryResource = await narrowClient.readResource({ uri: resourceDescriptor.uri });
    assert.ok(ordinaryResource.contents[0].text.includes('bounded resource fixture'));
    assert.equal(resourceControl.readSignal, resourceControl.requestSignal, 'older accounting may omit callback signal without losing original cancellation');
    assert.equal(resourceState.settled.length, 1); resourceControl.omitSignal = false;
    for (const mode of ['read', 'release']) {
      resourceControl.mode = mode; const releaseBefore = resourceControl.releaseCalls;
      await assert.rejects(() => narrowClient.readResource({ uri: resourceDescriptor.uri }), error => !error.message.includes('private late'));
      // Observe at allowance abort, before SDK completion can close request scope.
      assert.equal(resourceControl.readSignal.aborted, true); assert.equal(resourceControl.outerAbortedAtAllowance, false, 'original allowance expires before endpoint/protocol cancellation');
      if (mode === 'read') assert.equal(resourceControl.releaseCalls, releaseBefore, 'late resource reader never enters field release');
      else assert.equal(resourceControl.readSignal, resourceControl.releaseSignal, 'resource read/release use the same narrowed signal');
    }
    assert.equal(resourceState.calls, 3); assert.equal(resourceState.inFlight, 2); assert.equal(resourceState.unknown.length, 2); assert.equal(resourceState.settled.length, 1);
    assert.deepEqual(hosted.state.mcp_oauth_grant_last_use, useBeforeDeadline, 'deadline failures cannot record another successful completed read');
  } finally { hosted.holdBudgetRead = false; hosted.holdBudgetRelease = false; await narrowClient.close(); await narrowHost.close(); }

  // A shared actual SDK channel can cancel one protocol request without closing
  // the enclosing connection. ORIGINAL authority/accounting still own completion.
  const { McpServer, InMemoryTransport } = installed('@modelcontextprotocol/server');
  // Explicit supported 2025 shared-channel cancellation; the modern HTTP pin
  // above is unchanged. A bare Server does not supply handler's server/discover.
  const protocolServer = new McpServer({ name: 'original-protocol-cancel-fixture', version: '1' }, { supportedProtocolVersions: ['2025-11-25'] });
  const protocolClient = new Client({ name: 'original-protocol-cancel-fixture', version: '1' }, { capabilities: {}, versionNegotiation: { mode: 'legacy' } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(), endpointLifetime = new AbortController();
  const protocolState = { calls: 0, activeMs: 0, inFlight: 0, settled: [], unknown: [] };
  const protocolAccounting = api.createPersistentMcpReadAccounting(budgetFixture(protocolState, 'independent-protocol-goal-fixture'));
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve: value => resolve(value) }; };
  let protocolControl, protocolUsage = 0, protocolReleaseCalls = 0;
  const holdProtocolWork = async readSignal => {
    protocolControl.workSignal = readSignal;
    readSignal.addEventListener('abort', () => protocolControl.aborted.resolve(), { once: true });
    if (readSignal.aborted) protocolControl.aborted.resolve();
    protocolControl.entered.resolve(); await protocolControl.finish.promise;
  };
  const protocolTools = { ...readTools,
    publication: { allows: async () => { if (protocolControl?.mode === 'preflight') protocolControl.latePublications++; return true; } },
    tools: [{ ...readTools.tools[0], read: async (input, readSignal) => {
      if (protocolControl.mode === 'preflight') protocolControl.lateReads++;
      if (protocolControl.mode === 'read') await holdProtocolWork(readSignal);
      return { value: 'private late protocol body' };
    } }],
    authority: { withRead: async (...args) => {
      if (protocolControl.mode === 'preflight') protocolControl.lateAuthorities++;
      protocolControl.requestSignal = args[4]; return catalogAuthority.withRead(...args);
    } },
    accounting: { withCall: async (...args) => { try { return await protocolAccounting.withCall(...args); } finally { protocolControl.settled.resolve(); } } },
    release: { project: async (auth, name, value, readSignal) => {
      protocolReleaseCalls++; if (protocolControl.mode === 'release') await holdProtocolWork(readSignal); return value;
    } },
    usage: { completed: async () => { protocolUsage++; } },
  };
  try {
    // Registration is tested directly inside its own compiled module; no public
    // package export or production transport/identity adapter is bypassed.
    await registerOriginalReadTools(protocolServer, protocolTools, catalogAuthorization, endpointLifetime.signal, async () => {
      if (protocolControl?.mode === 'preflight') {
        protocolControl.entered.resolve(); await protocolControl.finish.promise; protocolControl.revalidated.resolve();
      }
    });
    await protocolServer.connect(serverTransport); await protocolClient.connect(clientTransport);
    protocolControl = { mode: 'preflight', entered: deferred(), finish: deferred(), revalidated: deferred(), latePublications: 0, lateAuthorities: 0, lateReads: 0 };
    const preflightCancel = new AbortController();
    const cancelledPreflight = assert.rejects(protocolClient.callTool({ name: catalogName, arguments: { limit: 2 } }, { signal: preflightCancel.signal }));
    await protocolControl.entered.promise; preflightCancel.abort(); await cancelledPreflight;
    await new Promise(resolve => setImmediate(resolve)); // Drain the actual SDK cancellation notification before releasing identity read.
    protocolControl.finish.resolve(); await protocolControl.revalidated.promise; await new Promise(resolve => setImmediate(resolve));
    assert.equal(endpointLifetime.signal.aborted, false);
    assert.equal(protocolControl.latePublications, 0, 'cancelled identity preflight cannot dispatch a late publication query');
    assert.equal(protocolControl.lateAuthorities, 0); assert.equal(protocolControl.lateReads, 0);
    assert.equal(protocolState.calls, 0); assert.equal(protocolState.unknown.length, 0, 'no budget reservation was attempted');
    for (const mode of ['read', 'release']) {
      protocolControl = { mode, entered: deferred(), aborted: deferred(), finish: deferred(), settled: deferred() };
      const clientCancel = new AbortController(), unknownBefore = protocolState.unknown.length, releasesBefore = protocolReleaseCalls;
      const pendingTool = protocolClient.callTool({ name: catalogName, arguments: { limit: 2 } }, { signal: clientCancel.signal });
      const rejectedTool = assert.rejects(pendingTool, error => !error.message.includes('private late'));
      await protocolControl.entered.promise; clientCancel.abort(); await rejectedTool; await protocolControl.aborted.promise;
      assert.equal(endpointLifetime.signal.aborted, false, 'protocol cancellation must not require connection cancellation');
      assert.equal(protocolControl.requestSignal.aborted, true, 'original authority/accounting receive protocol cancellation');
      assert.equal(protocolControl.workSignal.aborted, true);
      assert.equal(protocolState.unknown.length, unknownBefore, 'ignored cancellation cannot pretend original work settled');
      protocolControl.finish.resolve(); await protocolControl.settled.promise;
      assert.equal(protocolState.unknown.length, unknownBefore + 1); assert.equal(protocolState.settled.length, 0);
      if (mode === 'read') assert.equal(protocolReleaseCalls, releasesBefore, 'late cancelled reader never enters release');
      assert.equal(protocolUsage, 0); assert.equal((await protocolClient.listTools()).tools.length, 1, 'same connection still supports discovery');
    }
    assert.equal(protocolState.calls, 2); assert.equal(protocolState.inFlight, 2);
  } finally { protocolControl?.finish.resolve(); await protocolClient.close(); await protocolServer.close(); }
  let uncertainReads = 0, unknownMarks = 0;
  const uncertainAccounting = api.createPersistentMcpReadAccounting({ reserve: async () => { throw new Error('private lost reservation response'); }, settle: async () => assert.fail('no known ticket'), markUnknown: async () => { unknownMarks++; } });
  await assert.rejects(() => uncertainAccounting.withCall(catalogAuthorization, catalogName, { limit: 2 }, async () => { uncertainReads++; }, signal()), error => !error.message.includes('private')); assert.equal(uncertainReads, 0); assert.equal(unknownMarks, 1);
  const cancelledRead = new AbortController(); let finishCancelled, notifyStarted, cancelledFinished = false;
  const readerStarted = new Promise(resolve => { notifyStarted = resolve; });
  const cancelledWork = reloadedAccounting.withCall(catalogAuthorization, catalogName, { limit: 2 }, () => { notifyStarted(); return new Promise(resolve => { finishCancelled = resolve; }); }, cancelledRead.signal);
  const cancelledOutcome = assert.rejects(cancelledWork).then(() => { cancelledFinished = true; });
  await readerStarted; cancelledRead.abort(); await Promise.resolve(); assert.equal(cancelledFinished, false, 'abort cannot pretend original reader has settled'); finishCancelled('late-result'); await cancelledOutcome;
  assert.ok(budgetState.inFlight > 0, 'cancelled delivery keeps original occupancy unknown');
  const unknownSettlement = api.createPersistentMcpReadAccounting({ ...originalBudget, settle: async () => { throw new Error('private settlement failure'); } });
  const heldBefore = budgetState.inFlight; await assert.rejects(() => unknownSettlement.withCall(catalogAuthorization, catalogName, { limit: 2 }, async () => 'settled-reader', signal())); assert.equal(budgetState.inFlight, heldBefore + 1, 'unknown settlement cannot clear occupied resources');
  budgetState.calls = 20; let overLimitReads = 0; const unknownBeforeLimit = budgetState.unknown.length;
  await assert.rejects(() => reloadedAccounting.withCall(catalogAuthorization, catalogName, { limit: 2 }, async () => { overLimitReads++; }, signal())); assert.equal(overLimitReads, 0); assert.equal(budgetState.unknown.length, unknownBeforeLimit, 'confirmed source limit is not an unknown reservation');
  assert.throws(() => createOriginalMcpOAuthCore(api, { ...hostConfig.core, service: { ...hostConfig.core.service, resource: { ...hostConfig.core.service.resource, readTools: { ...readTools, usage: { completed: async () => {} } } } } }, hosted.original.auth, hosted.originalLogs, { database: hosted.database, metadata }), /owns completed-read usage/);
  hosted.notice = undefined; const receiptAudits = hosted.audits.length;
  const historicalConsent = await (await observeConsent()).json(); assert.deepEqual(historicalConsent, { state: 'observed', authorizationId: consentDraft.authorizationId, revision: 2, decision: 'approved', retryable: false });
  assert.equal(hosted.audits.length, receiptAudits); assert.equal(Object.hasOwn(historicalConsent, 'nonce'), false); assert.ok(!JSON.stringify(historicalConsent).includes('subject'));
  assert.deepEqual(await (await host.fetch(new Request(hostConfig.consent.receiptEndpoint + '?authorizationId=' + '0'.repeat(64), { headers: { authorization: 'Bearer ' + hosted.bearer } }))).json(), { state: 'not_observed', retryable: false });
  const workspaceBefore = hosted.session.currentWorkspaceId; hosted.session.currentWorkspaceId = 'other-space'; assert.equal((await observeConsent()).status, 403); hosted.session.currentWorkspaceId = workspaceBefore;
  assert.throws(() => createOriginalMcpHost(api, { ...hostConfig, grant: { ...hostConfig.grant, resourceUrl: 'https://other.example.invalid/mcp' } }, hosted.original.auth, hosted.original.platform, hosted.originalLogs, { database: hosted.database, metadata }), /pins/);
  assert.throws(() => createOriginalMcpHost(api, { ...hostConfig, consent: { ...hostConfig.consent, decisionEndpoint: issuer + 'unregistered-decision' } }, hosted.original.auth, hosted.original.platform, hosted.originalLogs, { database: hosted.database, metadata }), /pins/);
  const closes = host.close(); assert.equal(host.close(), closes); await closes; assert.equal((await host.fetch(new Request(hostConfig.grant.listEndpoint))).status, 503); assert.equal((await observeConsent()).status, 503);
  // Router behavior itself is exercised with inert original components: response
  // identity, fixed route collisions, late work settlement and close failure.
  let finishWork, finishClose, entered = false; const work = new Promise(resolve => { finishWork = resolve; }), closing = new Promise(resolve => { finishClose = resolve; });
  const originalResponse = new Response('native-result', { status: 202 });
  const router = api.createMcpHostRouter({ service: config.service, routes: [{ url: admin + '/wait', component: 'wait' }] },
    { service: { fetch: async () => originalResponse, close: async () => {} }, wait: { fetch: () => { entered = true; return work; }, close: () => closing } });
  assert.equal(await router.fetch(new Request(resource)), originalResponse);
  const pendingResponse = router.fetch(new Request(admin + '/wait')); await Promise.resolve(); assert.equal(entered, true);
  let ended = false; const closingRouter = router.close().then(() => { ended = true; });
  finishClose(); await new Promise(resolve => setImmediate(resolve)); assert.equal(ended, false, 'component close cannot hide original in-flight work');
  finishWork(originalResponse); assert.equal(await pendingResponse, originalResponse); await closingRouter; assert.equal(ended, true);
  assert.throws(() => api.createMcpHostRouter({ service: config.service, routes: [{ url: resource, component: 'wait' }] }, { service: { fetch: async () => originalResponse, close: async () => {} }, wait: { fetch: async () => originalResponse, close: async () => {} } }), /distinct|duplicate|conflict/);
  let failedCloses = 0; const failing = { fetch: async () => originalResponse, close: async () => { failedCloses++; throw new Error('original close failed'); } };
  const rejectingRouter = api.createMcpHostRouter({ service: config.service, routes: [] }, { service: failing, alias: failing });
  const rejectedClose = rejectingRouter.close(); assert.equal(rejectingRouter.close(), rejectedClose);
  await assert.rejects(rejectedClose, e => e instanceof AggregateError && e.errors.length === 1); assert.equal(failedCloses, 1);
});

test('only exact same-origin form/nonce can record; absent verification or caller confirmation never provides consent', async () => {
  const api = await compiled(), f = fixture(api), prepared = await f.prepare();
  for (const kind of ['origin', 'nonce', 'duplicate', 'actor', 'confirmed', 'get', 'json', 'invalid-utf8']) {
    let req = f.post(prepared);
    if (kind === 'origin') req = f.post(prepared, 'approve', { headers: { origin: 'https://evil.example.invalid' } });
    if (kind === 'nonce') req = f.post({ ...prepared, nonce: 'A'.repeat(43) });
    if (kind === 'duplicate') req = f.post(prepared, 'approve', { body: new URLSearchParams({ authorizationId: prepared.authorizationId, expectedRevision: '1', decision: 'approve', nonce: prepared.nonce }).toString() + '&decision=deny' });
    if (['actor', 'confirmed'].includes(kind)) req = f.post(prepared, 'approve', { body: new URLSearchParams({ authorizationId: prepared.authorizationId, expectedRevision: '1', decision: 'approve', nonce: prepared.nonce }).toString() + '&' + kind + '=true' });
    if (kind === 'get') req = new Request(consentEndpoint + '?confirmed=true', { headers: { authorization: 'Bearer ' + f.bearer } });
    if (kind === 'json') req = f.post(prepared, 'approve', { headers: { 'content-type': 'application/json' }, body: '{}' });
    if (kind === 'invalid-utf8') req = f.post(prepared, 'approve', { body: new Uint8Array([0xff]) });
    await assert.rejects(() => f.web.decide(req, signal())); assert.equal(f.state.mcp_oauth_browser_consents[prepared.authorizationId].state, 'pending', kind);
  }
  for (const kind of ['missing', 'unknown-verification', 'expired-verification']) {
    const missing = fixture(api); if (kind === 'missing') missing.notice = undefined; else missing.notice.verification.kind = kind === 'unknown-verification' ? 'unknown' : 'satisfied';
    if (kind === 'expired-verification') missing.notice.verification.expiresAt = 1;
    await assert.rejects(() => missing.prepare()); assert.equal(Object.keys(missing.state.mcp_oauth_browser_consents).length, 0);
  }
});

test('repeat prepare has no fresh nonce; competing decisions produce one receipt; scope/session and review changes cannot rebind', async () => {
  const api = await compiled(), f = fixture(api), prepared = await f.prepare(), repeated = await f.prepare();
  assert.equal(repeated.state, 'observed'); assert.equal(repeated.authorizationId, prepared.authorizationId); assert.equal(repeated.retryable, false); assert.equal('nonce' in repeated, false);
  const results = await Promise.allSettled([f.web.decide(f.post(prepared, 'approve'), signal()), f.web.decide(f.post(prepared, 'deny'), signal())]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1); assert.equal(f.audits.filter(row => row.revision === 2).length, 1);
  const originalDecision = f.state.mcp_oauth_browser_consents[prepared.authorizationId].state === 'approved' ? 'approve' : 'deny';
  await f.web.decide(f.post(prepared, originalDecision), signal()); assert.equal(f.audits.filter(row => row.revision === 2).length, 1);
  f.notice.noticeVersion = 'changed-review'; await assert.rejects(() => f.authorize()); assert.equal(Object.keys(f.state.mcp_oauth_grants).length, 0);
  const changed = fixture(api), draft = await changed.prepare(); changed.session.currentWorkspaceId = 'another-space'; await assert.rejects(() => changed.web.decide(changed.post(draft), signal()));
  const denied = fixture(api), deniedDraft = await denied.prepare(); await denied.web.decide(denied.post(deniedDraft, 'deny'), signal()); assert.deepEqual(await denied.authorize(), { kind: 'denied', error: 'access_denied' }); assert.equal(Object.keys(denied.state.mcp_oauth_grants).length, 0);
});

test('audit/late rights rollback, lost responses, cancellation and corrupt rows never reset the nonce or original authorization', async () => {
  const api = await compiled(), f = fixture(api); f.failAudit = true; await assert.rejects(() => f.prepare()); assert.equal(Object.keys(f.state.mcp_oauth_browser_consents).length, 0); f.failAudit = false;
  const prepared = await f.prepare(); f.afterAudit = value => { if (value.stage === 'approved') f.original.member.isActive = false; };
  await assert.rejects(() => f.web.decide(f.post(prepared), signal())); assert.equal(f.state.mcp_oauth_browser_consents[prepared.authorizationId].state, 'pending'); f.original.member.isActive = true; f.afterAudit = undefined;
  f.loseCommit = true; const before = f.transactions; await assert.rejects(() => f.web.decide(f.post(prepared), signal()), error => error.kind === 'unknown'); assert.equal(f.transactions, before + 1); assert.equal(f.state.mcp_oauth_browser_consents[prepared.authorizationId].state, 'approved');
  f.loseCommit = false; const observed = await f.prepare(); assert.equal(observed.state, 'observed'); assert.equal('nonce' in observed, false);
  const cancelled = fixture(api), originalDraft = await cancelled.prepare(), controller = new AbortController(); cancelled.cancelCommit = controller;
  await assert.rejects(() => cancelled.web.decide(cancelled.post(originalDraft), controller.signal), error => error.kind === 'unknown'); assert.equal(cancelled.state.mcp_oauth_browser_consents[originalDraft.authorizationId].state, 'approved');
  cancelled.cancelCommit = undefined; let getters = 0; cancelled.queryHook = (table, rows) => { if (table === 'mcp_oauth_browser_consents') Object.defineProperty(rows[0], 'recordJson', { enumerable: true, get() { getters++; return '{}'; } }); return rows; };
  await assert.rejects(() => cancelled.authorize()); assert.equal(getters, 0);
  const ddl = fs.readFileSync(path.join(root, 'packages/mcp-server/mysql-oauth-schema.sql'), 'utf8').split('-- Trusted Web consent preparation')[1].split('-- Original current consent review policy')[0];
  assert.equal((ddl.match(/ENGINE=InnoDB/g) || []).length, 1); assert.match(ddl, /decidedAt IS NOT NULL/); assert.match(ddl, /PRIMARY KEY \(id\)/);
});
