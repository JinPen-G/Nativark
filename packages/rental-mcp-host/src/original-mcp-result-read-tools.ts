/** Opt-in original-result Tools on the existing OAuth core. Owns callback linkage only; original owners supply business authority, goals and release. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma } from '@prisma/client';
import { getRequestIdentity, runWithRequestIdentity, type RequestIdentity } from '@rental-os/platform-server/request-identity';
import { resolveUserBusinessLocationScope } from '@rental-os/rental-core/business-location-scope';
import type { AuthService } from '@rental-os/ai-native-server/runtime/rental-adapters/auth.service';
import { originalRequestReferenceSchema } from '@rental-os/ai-native-server/runtime/task-request/original-request.validation';
import type { McpReadAuthorization, McpReadTool, McpReadTools } from '@rental-os/mcp-server' with { 'resolution-mode': 'import' };
import type { createPersistentOAuthAccessReader } from '@rental-os/mcp-server/persistent-oauth-tokens' with { 'resolution-mode': 'import' };
import type { captureMcpReadInput, OriginalMcpReadCallRef } from '@rental-os/mcp-server/persistent-read-accounting' with { 'resolution-mode': 'import' };
import type { createPrismaMcpReadAccounting } from '@rental-os/mcp-server/prisma-mcp-read-accounting' with { 'resolution-mode': 'import' };
import type { createPrismaMcpReadBindings, OriginalMcpReadBindingAuthority } from '@rental-os/mcp-server/prisma-mcp-read-bindings' with { 'resolution-mode': 'import' };
import type { createOriginalMcpTrafficMeter, OriginalMcpTrafficPolicySource } from '@rental-os/mcp-server/original-traffic-meter' with { 'resolution-mode': 'import' };
import type { OriginalMcpReadCore } from './original-mcp-oauth-core';
import { createOriginalMcpCatalogReadContext, createOriginalMcpQuoteReceiptReadContext, type OriginalMcpReadSubject } from './original-mcp-read-context';
import { captureOriginalMcpRequestCall } from './original-mcp-request-scope';
import { originalMcpResultKinds, originalMcpResultTool, type OriginalMcpResultCustody, type OriginalMcpResultKind,
  type OriginalMcpResultReaderExports, type OriginalMcpResultSources } from './original-mcp-result-readers';

export type { OriginalMcpResultCustody, OriginalMcpResultKind, OriginalMcpResultSources } from './original-mcp-result-readers';

type ResolvePrincipal = Parameters<Parameters<AuthService['withTrustedWorkspacePrincipal']>[3]>[0];
type ResultAuth = Pick<AuthService, 'withTrustedWorkspacePrincipal' | 'consumeTrustedWorkspaceAccess'>;
type GoalChecks = Pick<OriginalMcpReadBindingAuthority<Prisma.TransactionClient, OriginalMcpReadSubject>, 'locate' | 'current'>;
type Descriptor = Pick<McpReadTool, 'name' | 'description' | 'outputSchema'>;
type CurrentSubject = Omit<OriginalMcpResultCustody, 'assertCurrent'>;
type Destination = Readonly<Pick<McpReadAuthorization, 'clientId' | 'resource'>>;
export interface OriginalMcpResultReadOwner<K extends OriginalMcpResultKind> {
  tool: Descriptor;
  requiredScopes: readonly string[];
  publication: McpReadTools['publication'];
  /** Original field policy for the current destination; no token or original projection fallback. */
  release: { projectIn(custody: CurrentSubject, destination: Destination, value: unknown): Promise<Record<string, unknown>> };
  /** Current original goal/input binding and audit in the budget Native; never reacquire grant or publish a binding here. */
  goals: GoalChecks;
  /** The original fixed permission/ALS path for this exact operation. Receive fresh opaque tickets only, never Web credentials. */
  withReadIn<T>(native: Prisma.TransactionClient, input: unknown, resolve: ResolvePrincipal,
    consume: (identity: RequestIdentity) => Promise<T>, signal: AbortSignal): Promise<T>;
  /** Recheck current original object/route permission under custody, even after release awaits. */
  assertCurrentIn(custody: CurrentSubject, input: unknown): Promise<boolean>;
  /** Bind real original read ports to this Native/identity lease. Missing an owner yields no result. */
  bindIn(custody: OriginalMcpResultCustody): Promise<OriginalMcpResultSources[K] | undefined>;
}
export interface OriginalMcpResultReadPolicy {
  operations: { [K in OriginalMcpResultKind]?: OriginalMcpResultReadOwner<K> };
  traffic: OriginalMcpTrafficPolicySource<Prisma.TransactionClient>;
}
export interface OriginalMcpResultReadToolsExports extends OriginalMcpResultReaderExports {
  createPersistentOAuthAccessReader: typeof createPersistentOAuthAccessReader;
  captureMcpReadInput: typeof captureMcpReadInput;
  createPrismaMcpReadAccounting: typeof createPrismaMcpReadAccounting;
  createPrismaMcpReadBindings: typeof createPrismaMcpReadBindings;
  createOriginalMcpTrafficMeter: typeof createOriginalMcpTrafficMeter;
}

const unavailable = () => new Error('Original MCP result unavailable');
const identityFields = (identity: Partial<RequestIdentity>) => ({ tenantId: identity.tenantId, userId: identity.userId,
  workspaceId: identity.workspaceId, audience: identity.audience, permissions: identity.permissions, dataScope: identity.dataScope,
  organizationId: identity.organizationId, locationScope: identity.locationScope, staffApi: identity.staffApi,
  isSaasAdmin: identity.isSaasAdmin, isPlatformAdmin: identity.isPlatformAdmin });
function currentIdentity() {
  const identity = getRequestIdentity();
  if (!identity || identity.accessSession !== undefined || identity.operationToken !== undefined) throw unavailable();
  return identityFields(identity);
}

/** Use the same core/store as the catalog via createReadTools. No operation is advertised when its original owner is omitted. */
export function createOriginalMcpResultReadTools(mcp: OriginalMcpResultReadToolsExports,
  config: Parameters<typeof createPersistentOAuthAccessReader>[0], core: OriginalMcpReadCore,
  auth: ResultAuth, policy: OriginalMcpResultReadPolicy): McpReadTools {
  if (typeof policy?.traffic?.current !== 'function' || !policy.operations
    || Reflect.ownKeys(policy.operations).some(key => !originalMcpResultKinds.includes(key as OriginalMcpResultKind))) throw unavailable();
  const ordinaryContext = createOriginalMcpCatalogReadContext(core.coreAccess);
  const transaction = core.store.transaction.bind(core.store), nativeOf = core.store.native.bind(core.store);
  const principal = core.grantAuthority.principal.bind(core.grantAuthority), withPrincipal = auth.withTrustedWorkspacePrincipal.bind(auth);
  const consumeTicket = auth.consumeTrustedWorkspaceAccess.bind(auth);
  const capture = mcp.captureMcpReadInput.bind(mcp);
  const { enabled, resourceUrl } = config, scopeList = [...config.allowedScopes];
  const allowedScopes = new Set(scopeList);
  const issuer = mcp.createPersistentOAuthAccessReader({ enabled, resourceUrl, allowedScopes: scopeList }, core.grantAuthority.access);
  const traffic = mcp.createOriginalMcpTrafficMeter(policy.traffic), database = Object.freeze({ $transaction: core.database.$transaction.bind(core.database) });
  const operations = new Map<string, ReturnType<typeof compose>>();
  const calls = new AsyncLocalStorage<Invocation>(), authorities = new AsyncLocalStorage<Approval>();
  interface Approval { invocation: Invocation; active: boolean; signal: AbortSignal; live(): void; assertCurrent(): Promise<void> }
  interface Invocation { active: boolean; accountingStarted: boolean; reading: boolean; read: boolean; dispatched: boolean;
    observed?: { value: unknown }; releasing: boolean; released: boolean;
    name: string; input: ReturnType<typeof capture>; credential: McpReadAuthorization; signal: AbortSignal;
    call?: OriginalMcpReadCallRef; budget: McpReadTools['accounting']; verifyGoal(signal: AbortSignal): Promise<void> }

  const credential = (value: McpReadAuthorization) => captureOriginalMcpRequestCall({ callId: 'capture', toolName: 'capture',
    inputHash: '0'.repeat(64), authorization: value }).authorization;
  const approve = (entry: Invocation) => {
    const approval = authorities.getStore();
    if (!entry.active || !approval?.active || entry.signal.aborted || approval.invocation !== entry) throw unavailable();
    approval.live(); return approval;
  };
  const current = (name: string, signal: AbortSignal) => {
    const entry = calls.getStore();
    if (!entry || entry.name !== name || !entry.reading || !entry.call || signal.aborted) throw unavailable();
    const approval = approve(entry);
    return { entry, approval, call: entry.call };
  };
  function compose<K extends OriginalMcpResultKind>(kind: K, owner: OriginalMcpResultReadOwner<K>) {
    if (!owner?.tool || !/^[A-Za-z0-9_-]{1,64}$/u.test(owner.tool.name) || !owner.tool.description || owner.tool.description.length > 2000
      || owner.tool.outputSchema?.type !== 'object' || owner.tool.outputSchema.additionalProperties !== false
      || !Array.isArray(owner.requiredScopes) || !owner.requiredScopes.length || new Set(owner.requiredScopes).size !== owner.requiredScopes.length
      || owner.requiredScopes.some(scope => !allowedScopes.has(scope))) throw unavailable();
    const descriptor = { name: owner.tool.name, description: owner.tool.description, outputSchema: structuredClone(owner.tool.outputSchema) };
    // The audited kind fixes the reader at construction. The transport name,
    // locator and client cannot select the Core continuation permission.
    const context = kind === 'quoteReceipt' ? createOriginalMcpQuoteReceiptReadContext(core.coreAccess) : ordinaryContext;
    if (!context.withReadNative) throw unavailable();
    const withNative = context.withReadNative.bind(context);
    const scopes = Object.freeze([...owner.requiredScopes]);
    const withReadIn = owner.withReadIn.bind(owner), assertCurrentIn = owner.assertCurrentIn.bind(owner), bindIn = owner.bindIn.bind(owner);
    const allows = owner.publication.allows.bind(owner.publication), projectIn = owner.release.projectIn.bind(owner.release);
    const bindings = mcp.createPrismaMcpReadBindings<Prisma.TransactionClient, OriginalMcpReadSubject>({
      locate: owner.goals.locate.bind(owner.goals), current: owner.goals.current.bind(owner.goals),
      async readExisting() { throw unavailable(); }, async auditPublished() { throw unavailable(); }
    }, context).source;
    const tool = originalMcpResultTool(mcp, kind, descriptor, read => async (input, signal) => {
      const { entry, approval, call } = current(descriptor.name, signal);
      if (!entry.read || entry.dispatched) throw unavailable();
      entry.dispatched = true;
      return withNative(call, signal, async (native, stop) => {
        // A nested reader must expire with this read, even while release remains in the parent callback.
        const done = new AbortController(), readSignal = AbortSignal.any([stop, done.signal]);
        const assertCurrent = async () => {
          if (readSignal.aborted) throw unavailable();
          await approval.assertCurrent();
          if (readSignal.aborted || current(descriptor.name, readSignal).entry !== entry) throw unavailable();
        };
        try {
          await assertCurrent();
          const custody = Object.freeze({ native, subject: context.current(call), signal: readSignal, assertCurrent });
          const value = await read({ custody, call, context }, input, readSignal);
          await assertCurrent(); return value;
        } finally { done.abort(); }
      });
    }, bindIn);
    return { tool: Object.freeze({ ...tool, async read(input: unknown, signal: AbortSignal) {
      const { entry, call } = current(descriptor.name, signal);
      if (entry.read || capture(input).inputHash !== call.inputHash) throw unavailable();
      entry.read = true;
      const result = await tool.read(entry.input.input, signal);
      if (!entry.dispatched || current(descriptor.name, signal).entry !== entry) throw unavailable();
      entry.observed = { value: result };
      return result;
    } }), kind, context, withNative, scopes, withReadIn, assertCurrentIn, bindings, allows, projectIn };
  }
  for (const kind of originalMcpResultKinds) {
    if (!Object.hasOwn(policy.operations, kind)) continue;
    const owner = policy.operations[kind];
    if (owner === undefined) continue;
    const op = compose(kind, owner);
    if (operations.has(op.tool.name)) throw unavailable();
    operations.set(op.tool.name, op);
  }
  const operation = (name: string) => { const op = operations.get(name); if (!op) throw unavailable(); return op; };

  const open = (authorization: McpReadAuthorization, name: string, input: unknown, signal: AbortSignal) => {
    const op = operation(name), fixed = credential(authorization), captured = capture(input);
    if (!enabled || fixed.resource !== resourceUrl || !op.scopes.every(scope => fixed.scopes.includes(scope))) throw unavailable();
    if (op.kind === 'quoteReceipt') originalRequestReferenceSchema.parse(captured.input);
    let entry!: Invocation, counted = false, resolvedTarget: Awaited<ReturnType<typeof op.bindings.resolve>>;
    const budget = mcp.createPrismaMcpReadAccounting(database, { async resolve(raw, frozen, native, stop) {
      const approval = approve(entry), call = captureOriginalMcpRequestCall(raw);
      if (stop.aborted || call.toolName !== name || call.inputHash !== captured.inputHash
        || !isDeepStrictEqual(call.authorization, fixed) || entry.call && !isDeepStrictEqual(entry.call, call)) throw unavailable();
      entry.call = call;
      const target = await op.bindings.resolve(call, frozen, native, stop);
      resolvedTarget = target;
      if (target && !counted) {
        const { userId, tenantId, workspaceId } = op.context.current(call);
        if (!workspaceId) throw unavailable();
        await traffic.consumeIn('mcp.tools.call', { userId, tenantId, workspaceId }, native, stop); counted = true;
      }
      if (stop.aborted || approve(entry) !== approval) throw unavailable();
      return target;
    } });
    entry = { name, input: captured, credential: fixed, signal, active: true, accountingStarted: false,
      reading: false, read: false, dispatched: false, releasing: false, released: false, budget,
      async verifyGoal(stop) {
        const { call } = current(name, stop);
        await op.withNative(call, stop, async (native, scoped) => {
          const currentTarget = await op.bindings.resolve(call, captured.input, native, scoped);
          if (!currentTarget || !isDeepStrictEqual(resolvedTarget, currentTarget)) throw unavailable();
        });
      } };
    return entry;
  };
  const close = (entry: Invocation) => { entry.active = false; delete entry.call; delete entry.observed; };

  return Object.freeze({ tools: Object.freeze([...operations.values()].map(op => op.tool)),
    publication: Object.freeze({ async allows(authorization: McpReadAuthorization, tool: McpReadTool, signal: AbortSignal) {
      const op = operations.get(tool.name);
      return enabled && !!op && !signal.aborted && authorization.resource === resourceUrl
        && op.scopes.every(scope => authorization.scopes.includes(scope)) && await op.allows(authorization, tool, signal) === true && !signal.aborted;
    } }) satisfies McpReadTools['publication'],
    authority: Object.freeze({ async withRead<T>(authorization: McpReadAuthorization, name: string, input: unknown,
      consume: () => Promise<T>, signal: AbortSignal): Promise<T> {
      const op = operation(name), fixed = credential(authorization), captured = capture(input), invocation = calls.getStore();
      if (signal.aborted || authorities.getStore() || !invocation?.active || invocation.name !== name
        || invocation.input.inputHash !== captured.inputHash || !isDeepStrictEqual(invocation.credential, fixed)
        || !op.scopes.every(scope => fixed.scopes.includes(scope))) throw unavailable();
      return transaction(async tx => {
        const before = await issuer.readIn(tx, fixed.token, signal), token = before.authorization;
        if (signal.aborted || token.subject !== fixed.subject || token.clientId !== fixed.clientId || token.resource !== fixed.resource
          || !isDeepStrictEqual(token.scopes, fixed.scopes)) throw unavailable();
        const native = nativeOf(tx), enter = op.context.bind(fixed, name, captured.inputHash);
        const original = await principal(before.grantId, tx, signal);
        if (!original) throw unavailable();
        const authCurrent = async (same: Prisma.TransactionClient, stop: AbortSignal) => {
          if (same !== native || stop.aborted) throw unavailable();
          return principal(before.grantId, tx, stop);
        };
        let work: Promise<{ value: T }> | undefined, completed = false, attempted = false, violated = false, ticketIssued = false;
        const lifetime = new AbortController(), stop = AbortSignal.any([signal, lifetime.signal]);
        const invoke = (identity: RequestIdentity, resolve: ResolvePrincipal) => {
          if (attempted) { violated = true; throw unavailable(); }
          attempted = true;
          if (!ticketIssued || stop.aborted || identity.audience !== 'operator' || identity.isSaasAdmin !== false || identity.staffApi === true
            || identity.userId !== original.userId || identity.tenantId !== original.tenantId || identity.workspaceId !== original.workspaceId
            || !identity.permissions || !identity.dataScope || !identity.locationScope || identity.accessSession !== undefined || identity.operationToken !== undefined
            || !isDeepStrictEqual(currentIdentity(), identityFields(identity))) throw unavailable();
          const expected = structuredClone(identityFields(identity));
          const subject = Object.freeze({ tenantId: identity.tenantId, userId: identity.userId, workspaceId: identity.workspaceId,
            audience: identity.audience, permissions: Object.freeze([...identity.permissions]), dataScope: identity.dataScope,
            organizationId: identity.organizationId, locationScope: structuredClone(identity.locationScope),
            grantId: before.grantId, grantRevision: before.grantRevision }) satisfies OriginalMcpReadSubject;
          const live = () => {
            if (stop.aborted || !isDeepStrictEqual(currentIdentity(), expected)) throw unavailable();
          };
          const checkMember = async () => {
            live();
            const { context: access, transaction: held } = consumeTicket(await resolve()), user = access.user;
            live();
            if (held !== native || !access.workspaceValid || access.workspaceId !== subject.workspaceId || access.accessSession !== undefined
              || user.id !== subject.userId || user.tenantId !== subject.tenantId || user.isActive !== true || user.isSaasAdmin
              || user.mustChangePassword !== false || user.isPlatformAdmin !== Boolean(expected.isPlatformAdmin)
              || user.dataScope !== subject.dataScope || user.organizationId !== subject.organizationId
              || subject.permissions.some(permission => !user.permissions.includes(permission))) throw unavailable();
            const locations = await resolveUserBusinessLocationScope(user, access.workspaceId,
              user.locationScope ?? { mode: 'all', locationIds: [] }, native);
            live();
            if (locations.mode === 'selected' && (subject.locationScope.mode !== 'selected'
              || subject.locationScope.locationIds.some(location => !locations.locationIds.includes(location)))) throw unavailable();
          };
          const approval: Approval = { invocation, active: true, signal: stop, live,
            async assertCurrent() {
              live();
              const evidence = Object.freeze({ native, subject: structuredClone(subject), signal: stop });
              if (await op.assertCurrentIn(evidence, captured.input) !== true) throw unavailable();
              live();
            } };
          work = enter(before, identity, stop, async () => {
            try { return await authorities.run(approval, async () => {
              await checkMember();
              const value = await consume();
              await approval.assertCurrent();
              await checkMember();
              return Object.freeze({ value });
            }); } finally { approval.active = false; }
          }, native).finally(() => { completed = true; });
          void work.catch(() => {});
          return work;
        };
        try {
          const result = await withPrincipal(native, authCurrent, stop, resolve => {
            const resolveForOwner = async () => {
              const ticket = await resolve();
              if (stop.aborted) throw unavailable();
              ticketIssued ||= ticket !== undefined;
              return ticket;
            };
            return runWithRequestIdentity({}, () => op.withReadIn(native, captured.input, resolveForOwner, identity => invoke(identity, resolve), stop));
          });
          if (violated || !work || !completed || result !== await work || stop.aborted
            || !isDeepStrictEqual(await issuer.readIn(tx, fixed.token, stop), before) || stop.aborted) throw unavailable();
          return result.value;
        } finally {
          lifetime.abort();
          if (work && !completed) { try { await work; } catch { /* Preserve the enclosing failure after work actually stops. */ } }
        }
      }, signal);
    } }) satisfies McpReadTools['authority'],
    accounting: Object.freeze({ async withInvocation<T>(authorization: McpReadAuthorization, name: string, input: unknown,
      consume: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
      if (calls.getStore() || signal.aborted) throw unavailable();
      const entry = open(authorization, name, input, signal);
      try {
        if (!entry.budget.withInvocation) throw unavailable();
        return await calls.run(entry, () => entry.budget.withInvocation!(entry.credential, name, entry.input.input, consume, signal));
      } finally { close(entry); }
    }, async withCall<T>(authorization: McpReadAuthorization, name: string, input: unknown,
      consume: (signal?: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
      const entry = calls.getStore();
      if (!entry || entry.accountingStarted || entry.name !== name || signal.aborted
        || entry.input.inputHash !== capture(input).inputHash || !isDeepStrictEqual(entry.credential, credential(authorization))) throw unavailable();
      const approval = approve(entry);
      entry.accountingStarted = true;
      await approval.assertCurrent();
      return entry.budget.withCall(entry.credential, name, entry.input.input, async allowance => {
        if (!entry.call || !allowance || allowance.aborted) throw unavailable();
        const finished = new AbortController();
        const readSignal = AbortSignal.any([signal, allowance, approval.signal, finished.signal]);
        entry.reading = true;
        try {
          await entry.verifyGoal(readSignal);
          const result = await consume(readSignal);
          if (!entry.released || readSignal.aborted) throw unavailable();
          return result;
        } finally { entry.reading = false; finished.abort(); delete entry.call; delete entry.observed; }
      }, signal);
    } }) satisfies McpReadTools['accounting'],
    release: Object.freeze({ async project(authorization: McpReadAuthorization, name: string, value: unknown, signal: AbortSignal) {
      const { entry, approval, call } = current(name, signal);
      if (!entry.observed || !Object.is(entry.observed.value, value) || entry.releasing
        || !isDeepStrictEqual(entry.credential, credential(authorization))) throw unavailable();
      entry.releasing = true;
      await approval.assertCurrent();
      const destination = Object.freeze({ clientId: call.authorization.clientId, resource: call.authorization.resource });
      const op = operation(name);
      const result = await op.withNative(call, signal, async (native, stop) => {
        const done = new AbortController(), scoped = AbortSignal.any([stop, done.signal]);
        try {
          const projected = await op.projectIn(Object.freeze({ native, subject: op.context.current(call), signal: scoped }), destination, value);
          if (projected === value) throw unavailable();
          return projected;
        } finally { done.abort(); }
      });
      await approval.assertCurrent();
      if (current(name, signal).entry !== entry) throw unavailable();
      entry.released = true;
      return result;
    } }) satisfies McpReadTools['release']
  });
}

/** Route the same registry's read hooks by its fixed registered name. Catalog keeps its existing lifecycle and projections. */
export function combineOriginalMcpReadTools(catalog: McpReadTools, results: McpReadTools): McpReadTools {
  if (catalog.usage || results.usage || !catalog.accounting.withInvocation || !results.accounting.withInvocation) throw unavailable();
  const tools = Object.freeze([...catalog.tools, ...results.tools]);
  if (tools.length > 50 || new Set(tools.map(tool => tool.name)).size !== tools.length) throw unavailable();
  const routes = new Map([...catalog.tools.map(tool => [tool.name, catalog] as const), ...results.tools.map(tool => [tool.name, results] as const)]);
  const bindings = (name: string) => { const owner = routes.get(name); if (!owner) throw unavailable(); return owner; };
  return { tools,
    publication: { allows: (authorization, tool, signal) => bindings(tool.name).publication.allows(authorization, tool, signal) },
    authority: { withRead: (authorization, name, input, consume, signal) => bindings(name).authority.withRead(authorization, name, input, consume, signal) },
    accounting: {
      withInvocation: (authorization, name, input, consume, signal) => bindings(name).accounting.withInvocation!(authorization, name, input, consume, signal),
      withCall: (authorization, name, input, consume, signal) => bindings(name).accounting.withCall(authorization, name, input, consume, signal)
    },
    release: { project: (authorization, name, value, signal) => bindings(name).release.project(authorization, name, value, signal) }
  };
}
